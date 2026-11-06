/**
 * `TrucoRoom`: sala Colyseus da partida (mesa de 4, série `single` ou `bo3`).
 *
 * Fonte da verdade: o `SeriesState` do motor (`@trucaco/rules`), guardado SÓ em memória
 * (`this.series`), nunca no schema. Toda ação do cliente passa por `parseClientMessage`, é traduzida
 * para `HandAction` e aplicada por `applySeriesAction`; depois `projectState` recalcula o schema e
 * cada cliente recebe os eventos em visão pública (`publicEvent` por assento).
 *
 * Fluxo de uma ação: mensagem -> (assento pelo mapa do servidor) -> `parseClientMessage` -> rate
 * limit -> `HandAction` -> `applySeriesAction` -> `series` novo -> eventos a cada cliente ->
 * `projectState` + timer de turno + `turnTimer`.
 *
 * Reconexão e bot de ausência (2E): ver `onDrop`/`onReconnect`/`onLeave` e o README. API do core 0.18:
 * `onDrop` (queda sem consentimento) chama `allowReconnection`; `onReconnect` restaura o assento;
 * `onLeave` só roda na saída definitiva (consentida, janela expirada ou sem direito a janela).
 *
 * Sinais, sfx e chat (2F): ver `social`. Fora deste bloco (ver README): auth real (2G), lobby e
 * persistência (2H).
 */
import { randomInt } from 'node:crypto';
import { CloseCode, Room, ServerError } from '@colyseus/core';
import type { AuthContext, Client, Server } from '@colyseus/core';
import {
  ACTION_MIN_INTERVAL_MS,
  CHAT_COOLDOWN_MS,
  CODES_COOLDOWN_MS,
  DEFAULT_REMATCH_WINDOW_MS,
  REMATCH_MIN_HUMANS,
  RECONNECT_SECONDS,
  SFX_COOLDOWN_MS,
  SIGNAL_COOLDOWN_MS,
  SIGNAL_IDS,
  TURN_TIMEOUT_MS,
  cleanPartnerCode,
  parseClientMessage,
  validateRoomOptions,
} from '@trucaco/protocol';
import type {
  ClientMessage,
  ErrorCode,
  PresenceStatus,
  RoomOptions,
  ServerMessage,
  SignalId,
} from '@trucaco/protocol';
import {
  applySeriesAction,
  botAction,
  cancelSeries,
  isSeriesOver,
  legalActions,
  mulberry32,
  nextSeat,
  pendingSeat,
  publicEvent,
  startHand,
  startSeries,
  teamOf,
  variantById,
} from '@trucaco/rules';
import type {
  BotProfile,
  GameEvent,
  HandAction,
  PublicGameEvent,
  Rng,
  Seat,
  SeriesState,
} from '@trucaco/rules';
import { pendingSeats, projectState } from '../game/projection';
import {
  TABLE_SEATS,
  createSeatView,
  createTableState,
  setCancelVotes,
  setPlayer,
  setRematchVotes,
} from '../game/schema';
import type { TableState } from '../game/schema';
import { log } from '../logger';
import { metrics } from '../metrics';
import { AuthError, bearerFromHeader } from '../auth/authService';
import { InvalidInputError, PersistenceError } from '../db/types';
import type {
  FinishedMatchInput,
  JsonValue,
  MatchRepository,
  ProgressionRepository,
  UserRepository,
} from '../db/types';
import type { ProgressionPolicy } from '../progression/achievements';
import { applyMatchProgression } from '../progression/service';
import { GRANT_KEY, getLobby } from '../lobby/lobby';
import { onBlockChange, onUserDeleted } from '../social/blockBus';
import type { Grant } from '../lobby/lobby';
import { randomRoomCode } from '../lobby/roomCode';
import { pickBotIdentity } from './botRoster';
import { DISPOSE_FLUSH_MS, MatchRecorder, flushWithin } from './matchRecorder';
import type { EndReason } from './matchRecorder';
import { devReconnectUserId, getRoomAuth, USER_ID_MAX } from './roomAuth';

export { devReconnectUserId };

export const TRUCO_ROOM_NAME = 'truco';

type Timer = ReturnType<Room['clock']['setTimeout']>;

/** Código de política do WebSocket (RFC 6455, 1008) usado ao expulsar quem insiste em payload inválido. */
export const POLICY_CLOSE_CODE = 1008;
/** Destinatário de chat: `table` todos; `partner` o remetente (eco) e quem é da mesma dupla (`teamOf`). */
export function isChatRecipient(scope: 'partner' | 'table', from: Seat, to: Seat): boolean {
  return scope === 'table' || to === from || teamOf(to) === teamOf(from);
}

/** `INVALID_PAYLOAD` repetido: este número dentro desta janela expulsa o cliente. */
export const INVALID_PAYLOAD_LIMIT = 5;
export const INVALID_PAYLOAD_WINDOW_MS = 10_000;
/** No máximo 1 `warn` de mensagem inválida por assento nesta janela (o resto vira contador). */
export const INVALID_WARN_WINDOW_MS = 5_000;
/** Atraso padrão entre o fim da série e o fechamento da sala. */
export const DEFAULT_FINISH_DELAY_MS = 15_000;
/** Máximo de mensagens por segundo por conexão (piso do Colyseus: acima disso desconecta). */
export const MAX_MESSAGES_PER_SECOND = 30;
/** Atraso de "pensar" do bot de ausência (para a jogada não ser instantânea). */
export const DEFAULT_BOT_THINK_MS = 600;
/** Atraso de "pensar" do bot de VAGA: sorteado nesta faixa (ms), para a jogada parecer humana. */
export const VACANCY_BOT_THINK_MIN_MS = 900;
export const VACANCY_BOT_THINK_MAX_MS = 1800;
/** Séries por sala com bot de vaga (a 1ª mais as revanches); depois, `REMATCH_NOT_AVAILABLE`. */
export const MAX_BOT_TABLE_MATCHES = 5;
/** Reconexões (e retomadas por novo join) por assento na partida; acima disso o bot fica com a cadeira. */
export const DEFAULT_MAX_RECONNECTS = 20;
/**
 * Teto do `eventLog` (replay de reconexão). DECISÃO: o log é descartável, só serve a reenviar eventos
 * perdidos; acima do teto descartam-se os mais antigos e `eventsEvicted` conta quantos. Se o replay
 * pedido já foi descartado (lacuna), nada é reenviado: o cliente já recebeu o estado completo e trata
 * o salto de `seq` como resincronização. A gravação em `matches` (2H) NÃO usa este log: o `MatchRecorder`
 * tem buffer próprio (`recordEvent`, ponto único em `emitEvents`) com teto e marca de "log truncado". Uma
 * bo3 medida (300 sementes, bots) fica em <= 883 eventos / 112 KB; o pior caso teórico (com apostas) é
 * ~1800 eventos / ~270 KB, então 5000 aqui também cobre uma bo3 com folga.
 */
export const DEFAULT_EVENT_LOG_MAX = 5000;
/** Chance de cada bot dar um sinal no início de uma mão (a mesa com bot não fica morta). */
export const DEFAULT_BOT_SIGNAL_CHANCE = 0.3;
/** Expirações de turno seguidas que marcam o assento como ausente (`away`). */
export const IDLE_TIMEOUTS = 2;

/**
 * Parâmetros do SERVIDOR/teste (nunca vêm de opções do cliente): injetados por `defineTrucoRoom`.
 */
export interface TrucoRoomConfig {
  /** Semente do RNG (`mulberry32`). Padrão: `crypto.randomInt` por sala. */
  readonly rngSeed?: number;
  /** Prazo do turno. Padrão `TURN_TIMEOUT_MS`. */
  readonly turnTimeoutMs?: number;
  /** Intervalo mínimo entre ações do mesmo assento. Padrão `ACTION_MIN_INTERVAL_MS`. */
  readonly actionMinIntervalMs?: number;
  /** Atraso para fechar a sala após o fim da série. Padrão `DEFAULT_FINISH_DELAY_MS`. */
  readonly finishDelayMs?: number;
  /**
   * Janela de "Jogar de novo" depois de uma série COM vencedor; expirando sem revanche a sala fecha.
   * Padrão `DEFAULT_REMATCH_WINDOW_MS`. Série cancelada/abandonada não abre janela (usa `finishDelayMs`).
   */
  readonly rematchWindowMs?: number;
  /** Intervalo de patch do estado em ms (padrão do Colyseus: 50). */
  readonly patchRateMs?: number;
  /** Teto de mensagens por segundo por conexão (acima disso o Colyseus desconecta). Padrão 30. */
  readonly maxMessagesPerSecond?: number;
  /** Placar inicial do 1º jogo (só para teste de mão de onze/dez/ferro). */
  readonly initialScores?: readonly [number, number];
  /** Janela de reconexão em segundos (aceita fração, para teste). Padrão `RECONNECT_SECONDS`. */
  readonly reconnectSeconds?: number;
  /** Atraso do bot de ausência antes de jogar. Padrão `DEFAULT_BOT_THINK_MS`. */
  readonly botThinkMs?: number;
  /**
   * Tempo sem NENHUM humano conectado até cancelar a série. Padrão: a janela de reconexão
   * (`reconnectSeconds * 1000`).
   */
  readonly abandonMs?: number;
  /** Teto de reconexões/retomadas por assento. Padrão `DEFAULT_MAX_RECONNECTS`. */
  readonly maxReconnects?: number;
  /** Teto do `eventLog`. Padrão `DEFAULT_EVENT_LOG_MAX`. */
  readonly eventLogMax?: number;
  /** Intervalo mínimo entre sinais do mesmo assento. Padrão `SIGNAL_COOLDOWN_MS`. */
  readonly signalCooldownMs?: number;
  /**
   * Chance (0 a 1) de um bot dar 1 sinal aleatório quando uma mão começa. Padrão
   * `DEFAULT_BOT_SIGNAL_CHANCE`. O bot NUNCA pede nem aumenta aposta; sinal é só decoração.
   */
  readonly botSignalChance?: number;
  /** Fonte de aleatoriedade do sinal do bot. Separada do RNG da partida (não altera sorteios). */
  readonly botSignalRandom?: () => number;
  /** Intervalo mínimo entre sfx do mesmo assento. Padrão `SFX_COOLDOWN_MS`. */
  readonly sfxCooldownMs?: number;
  /** Intervalo mínimo entre mensagens de chat do mesmo assento. Padrão `CHAT_COOLDOWN_MS`. */
  readonly chatCooldownMs?: number;
  /** Onde gravar a partida ao terminar (2H). Ausente: nada é gravado. Nunca vem do cliente. */
  readonly matches?: MatchRepository;
  /**
   * Progressão (Fase 6): conquistas, missões e estatísticas aplicadas depois de gravar a partida. Ausente: não
   * há progressão. Nunca vem do cliente.
   */
  readonly progression?: ProgressionRepository;
  /** Limites anti-farm da progressão (padrão: `DEFAULT_PROGRESSION_POLICY`). Só os testes de sala trocam. */
  readonly progressionPolicy?: ProgressionPolicy;
  /**
   * Combinado de sinais da dupla (Fase 5): lê e grava `partner_codes`. Ausente: o combinado vive só na
   * sala (nada é lido nem gravado). Nunca vem do cliente.
   */
  readonly users?: Pick<
    UserRepository,
    'getPartnerCodes' | 'savePartnerCodes' | 'havePlayedTogether'
  >;
  /** Intervalo mínimo entre `setCode` do mesmo assento. Padrão `CODES_COOLDOWN_MS`. */
  readonly codesCooldownMs?: number;
}

/** Combinado de uma dupla nesta mesa (em memória da sala; o texto nunca vai a log, estado nem replay). */
interface PairCodes {
  /** Par de `userId` ordenado: muda quando o ocupante de um dos dois assentos muda (espera). */
  readonly key: string;
  readonly a: string;
  readonly b: string;
  readonly codes: Partial<Record<SignalId, string>>;
  /** Sinais editados nesta mesa (a leitura do banco, assíncrona, não pode sobrescrevê-los). */
  readonly touched: Set<SignalId>;
  loaded: boolean;
  /** A leitura do banco falhou: nunca gravar (o upsert do mapa inteiro apagaria o combinado salvo). */
  loadFailed: boolean;
  /** O par já jogou junto uma partida finalizada: edições são gravadas na hora. */
  linked: boolean;
  /** Há edição ainda não gravada. */
  dirty: boolean;
  /** Gravação em voo (no máximo uma por par); edições seguintes só marcam `dirty`. */
  flushing: Promise<void> | null;
  /** Último assento que editou: recebe o aviso `CODE_NOT_SAVED` se a gravação falhar. */
  lastEditor: Seat | null;
}

/** Dados de identidade do jogador (vêm do `onAuth`: JWT + banco; nunca do payload do cliente). */
export interface JoinAuth {
  readonly userId: string;
  readonly nickname: string;
  /** JSON das partes do avatar (do banco). Ausente em `devAuth`. */
  readonly avatar?: string;
  /** `userId`s que ESTE usuário bloqueou (do banco, no `onAuth`). Ausente em `devAuth`. */
  readonly blocked?: readonly string[];
  /** `userId`s que bloquearam ESTE usuário. */
  readonly blockers?: readonly string[];
}

export interface LoggedEvent {
  readonly seq: number;
  readonly at: number;
  /** Visão pública: carta coberta sem identidade. */
  readonly event: PublicGameEvent;
}

const NICKNAME_MAX = 24;
/** Intervalo mínimo entre `ready` atendidos do mesmo assento (não afeta `allowAction`). */
const READY_MIN_INTERVAL_MS = 500;
const CONTROL = /[\p{C}]/u;

/**
 * Identidade SEM prova, só para testes e `pnpm dev`: aceita `{userId, nickname}` das opções de join.
 * Falha FECHADO: só `development` e `test` EXPLÍCITOS passam (e `onAuth` só a chama com a flag
 * `allowDevAuth`, ver `roomAuth.ts`); `production`, qualquer outro valor e `NODE_ENV` AUSENTE
 * rejeitam tudo.
 */
export function devAuth(options: unknown, nodeEnv: string | undefined): JoinAuth {
  if (nodeEnv !== 'development' && nodeEnv !== 'test') {
    throw new ServerError(401, 'UNAUTHORIZED');
  }
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new ServerError(401, 'UNAUTHORIZED');
  }
  const { userId, nickname } = options as Record<string, unknown>;
  if (typeof userId !== 'string' || userId.length === 0 || userId.length > USER_ID_MAX) {
    throw new ServerError(401, 'UNAUTHORIZED');
  }
  if (typeof nickname !== 'string') throw new ServerError(401, 'UNAUTHORIZED');
  const nick = nickname.trim();
  if (nick.length === 0 || nick.length > NICKNAME_MAX || CONTROL.test(nick)) {
    throw new ServerError(401, 'UNAUTHORIZED');
  }
  return { userId, nickname: nick };
}

/** Falha de dependência (Redis/banco) no `onAuth`: 503 genérico, sem a mensagem do erro original. */
function unavailable(err: unknown): ServerError {
  log.error('truco: dependência indisponível no onAuth', {
    name: err instanceof Error ? err.name : 'unknown',
  });
  return new ServerError(503, 'SERVICE_UNAVAILABLE');
}

/**
 * Monta o objeto que o parser valida a partir do par (tipo, payload) do Colyseus. O `type` do
 * Colyseus manda; se o payload trouxer um `type` próprio diferente, é rejeitado.
 */
function buildRaw(type: string | number, payload: unknown): unknown {
  if (typeof type !== 'string') return null;
  if (payload === undefined || payload === null) return { type };
  if (typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const rec = payload as Record<string, unknown>;
  if (Object.hasOwn(rec, 'type') && rec.type !== type) return null;
  return { ...rec, type };
}

type EventPayload = Omit<Extract<ServerMessage, { type: 'event' }>, 'type'>;

export class TrucoRoom extends Room<{ state: TableState }> {
  override maxClients = TABLE_SEATS;

  /** Verdade da partida. Só em memória; `null` até o 4º jogador entrar. Não alterar fora da sala. */
  series: SeriesState | null = null;
  /** Log de eventos em visão pública, para o bloco 2H gravar em `matches`. */
  readonly eventLog: LoggedEvent[] = [];
  /** Quantos eventos antigos saíram do `eventLog` pelo teto (ver `DEFAULT_EVENT_LOG_MAX`). */
  eventsEvicted = 0;
  /** Semente do RNG desta sala (gravada em `matches` pelo 2H para reprodução). */
  seed = 0;

  private options: RoomOptions | null = null;
  private rng: Rng = Math.random;
  private seq = 0;
  /** sessionId -> assento. Fica SÓ no servidor; o assento nunca vem da mensagem. */
  private readonly seatBySession = new Map<string, Seat>();
  /**
   * assento -> `userId`. SÓ em memória do servidor: o `userId` nunca entra no estado compartilhado
   * (a mesa toda o receberia). Para a UI a identidade pública é `nickname` + `seat`.
   */
  private readonly userBySeat = new Map<Seat, string>();
  private readonly warnState = new Map<Seat, { at: number; suppressed: number }>();
  private startTimer: Timer | null = null;
  private readonly lastActionAt = new Map<Seat, number>();
  /** Último `ready` atendido por assento: limite próprio, separado de `lastActionAt`. */
  private readonly lastReadyAt = new Map<Seat, number>();
  private readonly invalidAt = new Map<Seat, number[]>();
  /**
   * Último sinal/sfx/chat aceito por assento. Mapas por ASSENTO que sobrevivem a queda, reconexão e
   * retomada (sair e voltar não zera o cooldown); nem a saída em `waiting` os limpa (o próximo
   * ocupante herda no máximo alguns segundos, e quem sai e reentra não burla o limite).
   */
  private readonly lastSignalAt = new Map<Seat, number>();
  private readonly lastSfxAt = new Map<Seat, number>();
  private readonly lastChatAt = new Map<Seat, number>();
  private readonly lastCodeAt = new Map<Seat, number>();
  /** Combinado por time (0 e 1); existe só com os dois assentos ocupados por humanos distintos. */
  private readonly pairs = new Map<number, PairCodes>();
  /**
   * Expirações de turno seguidas por assento. Ao chegar a `IDLE_TIMEOUTS` o assento aparece como
   * `away`; qualquer ação aceita zera.
   */
  readonly timeouts = new Map<Seat, number>();
  private readonly cancelVotes = new Set<Seat>();
  private turnTimer: Timer | null = null;
  private closeTimer: Timer | null = null;
  /** Assentos cujo humano saiu de vez: o bot joga. Persiste até o dono voltar (mesmo `userId`). */
  private readonly botSeats = new Set<Seat>();
  /** Bots de AUSÊNCIA (humano que caiu): não sinalizam; o assento mantém apelido/avatar do humano. */
  private readonly absenceBotSeats = new Set<Seat>();
  /**
   * Bots de VAGA (mesa privada, escolhidos pelo host na espera): também estão em `botSeats`, mas nunca em
   * `absenceBotSeats` nem em `userBySeat` (não têm `userId`). Sinalizam, aceitam ou correm pela força da mão.
   */
  private readonly vacancyBotSeats = new Set<Seat>();
  /** Assento do host (muda bots na espera); -1 = sem host. Passa ao menor assento humano se ele sair. */
  private hostSeat = -1;
  /** Assentos com socket caído e janela de reconexão aberta (`allowReconnection`). */
  private readonly droppedSeats = new Set<Seat>();
  /** Assentos expulsos por abuso (strikes): a queda seguinte NÃO abre janela de reconexão. */
  private readonly expelledSeats = new Set<Seat>();
  /** `userId`s expulsos desta sala: não reentram (ban por sala, só em memória). */
  private readonly bannedUsers = new Set<string>();
  /**
   * Bloqueios dirigidos `blocker>blocked` conhecidos desta sala (de quem entrou, e atualizados ao vivo
   * por `blockBus`). Só em memória; nunca vai ao estado nem ao log.
   */
  private readonly blockEdges = new Set<string>();
  /** Contas apagadas com assento aqui: o assento é gravado sem `userId` (a FK deixou de existir). */
  private readonly deletedUsers = new Set<string>();
  private readonly unsubscribers: (() => void)[] = [];
  /** Último `seq` de evento enviado ao socket do assento (base do replay na reconexão). */
  private readonly lastSeq = new Map<Seat, number>();
  /** Reconexões e retomadas por assento (teto `maxReconnects`). */
  private readonly reconnectCount = new Map<Seat, number>();
  private readonly seatPresence = new Map<Seat, PresenceStatus>();
  private currentTurn: { seat: Seat; deadlineAt: number } | null = null;
  private botTimer: Timer | null = null;
  private abandonTimer: Timer | null = null;
  private closing = false;
  /** Concessão do lobby (mesa privada/fila). `null` = sala fora do lobby (testes, uso interno). */
  private grant: Grant | null = null;
  private waitTimer: Timer | null = null;
  private creatorTimer: Timer | null = null;
  /** O criador da mesa privada chegou a sentar (vale para sempre; cancela o prazo do criador). */
  private creatorSeated = false;
  /** userId -> fim da reserva de assento ainda não consumida (um humano não segura mais de um assento). */
  private readonly pendingReservations = new Map<string, number>();
  private recorder: MatchRecorder | null = null;
  /** Sinais usados por assento HUMANO na partida em curso (alimenta `sinaleiro` e a missão de sinais). */
  private readonly signalsBySeat = new Map<Seat, number>();
  private endReason: EndReason | null = null;
  /** Assentos que votaram por revanche na janela atual. */
  private readonly rematchVotes = new Set<Seat>();
  /** Fim da janela de revanche (epoch ms); 0 = sem janela. */
  private rematchDeadlineAt = 0;
  /** 1 na primeira partida da sala, +1 por revanche. */
  private matchNumber = 1;
  /** Gravações de todas as partidas da sala (o `onDispose` espera por todas). */
  private readonly pendingSaves: Promise<boolean>[] = [];

  constructor(private readonly config: TrucoRoomConfig = {}) {
    super();
    this.installReservationGuard();
  }

  /**
   * Admissão ANTES de reservar assento. O `static onAuth` não sabe qual sala será alvo (`joinById`
   * não passa o id), então a checagem de "quem pode ocupar" fica aqui, no `_reserveSeat` do core (a
   * única porta de reserva, também usada por `allowReconnection`, que passa direto). Recusa, sem
   * gastar vaga nem prender timeout de reserva: banido; dono de assento que não está com bot; estranho
   * com a série em andamento (inclusive assento de bot). O dono do assento do bot retoma pelo MESMO
   * `userId`. `onJoin` repete as regras como segunda barreira.
   */
  private installReservationGuard(): void {
    type Reserve = (
      sessionId: string,
      joinOptions: unknown,
      authData: unknown,
      seconds?: number,
      allowReconnection?: boolean,
      devModeReconnectionToken?: string,
    ) => Promise<boolean>;
    const host = this as unknown as { _reserveSeat: Reserve };
    const original = host._reserveSeat.bind(this);
    host._reserveSeat = async (
      sessionId,
      joinOptions,
      authData,
      seconds,
      allowReconnection,
      devToken,
    ) => {
      if (allowReconnection === true) {
        return original(sessionId, joinOptions, authData, seconds, allowReconnection, devToken);
      }
      if (!this.mayReserve(authData, joinOptions)) return false;
      // Marca ANTES do await: duas reservas simultâneas do mesmo usuário não passam as duas.
      const userId = (authData as JoinAuth).userId;
      const until = Date.now() + (seconds ?? this.seatReservationTimeout) * 1000;
      this.pendingReservations.set(userId, until);
      let ok = false;
      try {
        ok = await original(sessionId, joinOptions, authData, seconds, allowReconnection, devToken);
      } finally {
        if (!ok && this.pendingReservations.get(userId) === until) {
          this.pendingReservations.delete(userId);
        }
      }
      return ok;
    };
  }

  private mayReserve(authData: unknown, joinOptions: unknown): boolean {
    const auth = authData as Partial<JoinAuth> | undefined;
    if (auth === undefined || auth === null || typeof auth.userId !== 'string') return false;
    if (this.bannedUsers.has(auth.userId)) return false;
    // Lobby: um `userId`, uma mesa; fila só para os sorteados; privada com criador primeiro e código.
    if (getLobby()?.admit(auth.userId, this.roomId, joinOptions) === false) return false;
    const pending = this.pendingReservations.get(auth.userId);
    if (pending !== undefined) {
      if (pending > Date.now()) return false;
      this.pendingReservations.delete(auth.userId);
    }
    for (const [seat, userId] of this.userBySeat) {
      if (userId !== auth.userId) continue;
      return (
        this.series !== null &&
        this.botSeats.has(seat) &&
        (this.reconnectCount.get(seat) ?? 0) < this.maxReconnects()
      );
    }
    if (this.series !== null) return false;
    // Bots de vaga ocupam assento sem contar no `maxClients`: assentos ocupados + reservas pendentes
    // nunca passam de 4, para o convidado extra ser recusado já na reserva.
    const now = Date.now();
    let pendingCount = 0;
    for (const until of this.pendingReservations.values()) if (until > now) pendingCount++;
    return this.occupiedSeats() + pendingCount < TABLE_SEATS;
  }

  override onCreate(rawOptions: unknown): void {
    let options = rawOptions;
    let grant: Grant | null = null;
    const lobby = getLobby();
    if (typeof rawOptions === 'object' && rawOptions !== null && GRANT_KEY in rawOptions) {
      // Concessão do lobby: token aleatório que só o servidor conhece. Token desconhecido = forjado.
      const { [GRANT_KEY]: token, ...rest } = rawOptions as Record<string, unknown>;
      const found = typeof token === 'string' ? lobby?.consumeGrant(token) : undefined;
      if (found === undefined) {
        log.warn('truco: concessão de lobby inválida');
        throw new ServerError(403, 'FORBIDDEN');
      }
      grant = found;
      options = rest;
    }
    const valid = validateRoomOptions(options);
    if (!valid.ok) {
      log.warn('truco: opções de sala inválidas', { error: valid.error });
      throw new ServerError(400, valid.error);
    }
    this.options = valid.options;
    this.maxMessagesPerSecond = this.config.maxMessagesPerSecond ?? MAX_MESSAGES_PER_SECOND;
    this.seed = this.config.rngSeed ?? randomInt(0, 2 ** 32);
    this.rng = mulberry32(this.seed);
    const code = grant?.code ?? lobby?.newCode() ?? randomRoomCode();
    this.setState(createTableState(code, valid.options));
    this.grant = grant;
    lobby?.registerRoom(this.roomId, code, valid.options.visibility, grant);
    if (grant !== null) this.armGrantTimers(grant);
    if (this.config.patchRateMs !== undefined) this.setPatchRate(this.config.patchRateMs);
    this.unsubscribers.push(
      metrics.registerRoom(this.roomId, () => ({
        visibility: this.options?.visibility === 'private' ? 'private' : 'public',
        seatsOccupied: this.userBySeat.size,
        playersConnected: this.connectedHumans().length,
      })),
      onBlockChange((c) => {
        const edge = `${c.blockerId}>${c.blockedId}`;
        const seated = new Set(this.userBySeat.values());
        if (!c.active) this.blockEdges.delete(edge);
        else if (seated.has(c.blockerId) || seated.has(c.blockedId)) this.blockEdges.add(edge);
      }),
      onUserDeleted((userId) => this.dropDeletedUser(userId)),
    );
    // Única rota de entrada de mensagens do cliente.
    this.onMessage('*', (client, type, message) => this.handleMessage(client, type, message));
  }

  /**
   * Autenticação ESTÁTICA, não de instância: no `@colyseus/core` 0.18 o `onAuth` de instância só roda
   * DEPOIS de `onCreate`, então `create`/`joinOrCreate` criariam a sala sem credencial. O `static
   * onAuth(token, options, context)` roda no matchmaker ANTES de criar a sala ou reservar assento
   * (`create`, `join`, `joinById`, `joinOrCreate`). O que ele devolve vira `client.auth` e chega ao
   * `onJoin(client, options, auth)`. Lançar `ServerError` aborta a requisição sem criar sala.
   *
   * A credencial é SÓ o cabeçalho `Authorization: Bearer <JWT de acesso>` do POST de matchmaking (lido
   * de `context.headers`; o `token` do core pode vir da query do WebSocket e é ignorado). Usuário,
   * apelido e avatar vêm do banco. O `onAuth` do core NÃO é chamado sem contexto de requisição
   * (reserva criada por fora do matchmaker HTTP): `onJoin` recusa `auth` ausente.
   */
  static override async onAuth(
    _token: string | undefined,
    options: unknown,
    context?: AuthContext,
  ): Promise<JoinAuth> {
    const deps = getRoomAuth();
    if (deps === null) throw new ServerError(401, 'UNAUTHORIZED');
    const bearer = bearerFromHeader(context?.headers?.get('authorization'));
    if (bearer === undefined) {
      if (deps.allowDevAuth) return devAuth(options, process.env.NODE_ENV);
      throw new ServerError(401, 'UNAUTHORIZED');
    }
    if (deps.auth === null || deps.users === null) throw new ServerError(401, 'UNAUTHORIZED');
    let userId: string;
    try {
      userId = (await deps.auth.authenticateAccess(bearer)).userId;
    } catch (err) {
      if (err instanceof AuthError) throw new ServerError(401, 'UNAUTHORIZED');
      throw unavailable(err);
    }
    try {
      const user = await deps.users.findById(userId);
      if (user === null) throw new ServerError(401, 'UNAUTHORIZED');
      const avatar = await deps.users.getAvatar(user.id);
      const [blocked, blockers] = await Promise.all([
        deps.users.listBlockedIds(user.id),
        deps.users.listBlockerIds(user.id),
      ]);
      return {
        userId: user.id,
        nickname: user.nickname,
        avatar: avatar === null ? '{}' : JSON.stringify(avatar),
        blocked,
        blockers,
      };
    } catch (err) {
      if (err instanceof ServerError) throw err;
      if (err instanceof InvalidInputError) throw new ServerError(401, 'UNAUTHORIZED');
      throw unavailable(err);
    }
  }

  override onJoin(client: Client, _options: unknown, auth: JoinAuth | undefined): void {
    // Sem dado do `onAuth` estático (reserva criada por fora do matchmaker HTTP): recusa.
    if (auth === undefined || typeof auth.userId !== 'string') {
      throw new ServerError(401, 'UNAUTHORIZED');
    }
    if (this.bannedUsers.has(auth.userId)) throw new ServerError(403, 'BANNED');
    // Só guarda o par se o outro já está sentado (ou é o próprio entrante, que sentará): o resto nunca
    // seria consultado e o conjunto cresceria com a lista inteira de bloqueios de cada entrante.
    const seated = new Set(this.userBySeat.values());
    for (const other of auth.blocked ?? []) {
      if (seated.has(other)) this.blockEdges.add(`${auth.userId}>${other}`);
    }
    for (const other of auth.blockers ?? []) {
      if (seated.has(other)) this.blockEdges.add(`${other}>${auth.userId}`);
    }
    // Quem já tem assento só volta ao PRÓPRIO assento, e só se o bot o ocupa (saída definitiva).
    for (const [owned, userId] of this.userBySeat) {
      if (userId === auth.userId) {
        this.reclaimSeat(client, owned);
        return;
      }
    }
    if (this.series !== null) throw new ServerError(409, 'ROOM_FULL');
    // Mesa privada: bloqueio (qualquer sentido) com quem já sentou = o mesmo erro de mesa inexistente (a
    // fila pública já evitou o encontro ao formar o grupo; aqui é a barreira da entrada direta).
    if (this.grant?.kind !== 'queue') {
      for (const other of this.userBySeat.values()) {
        if (this.isBlockedPair(auth.userId, other)) throw new ServerError(404, 'TABLE_UNAVAILABLE');
      }
    }
    const seat = this.seatFor(auth.userId);
    if (seat === null) throw new ServerError(409, 'ROOM_FULL');
    this.bindToTable(auth.userId);
    this.seatBySession.set(client.sessionId, seat);
    this.userBySeat.set(seat, auth.userId);
    if (this.hostSeat === -1) this.setHost(seat);
    this.lastSeq.set(seat, this.seq);
    this.seatPresence.set(seat, 'online');
    setPlayer(this.state, seat, {
      nickname: auth.nickname,
      avatar: auth.avatar ?? '{}',
      status: 'connected',
      isBot: false,
    });
    // O core NÃO cria `client.view`: sem isto o cliente receberia o estado sem o bloco privado.
    client.view = createSeatView(this.state, seat);
    log.info('truco: jogador sentou', { room: this.roomId, seat });
    this.syncPairs();
    this.afterOccupancyChange();
  }

  /** Assentos com gente OU bot de vaga (um assento de ausência continua em `userBySeat`). */
  private occupiedSeats(): number {
    let n = this.userBySeat.size;
    for (const s of this.vacancyBotSeats) if (!this.userBySeat.has(s)) n++;
    return n;
  }

  private isOccupied(seat: Seat): boolean {
    return this.userBySeat.has(seat) || this.vacancyBotSeats.has(seat);
  }

  private setHost(seat: Seat): void {
    this.hostSeat = seat;
    this.state.hostSeat = seat;
  }

  /** Menor assento humano (o novo host quando o anterior sai na espera), ou -1. */
  private lowestHumanSeat(): Seat {
    const seats = this.humanSeats().sort((a, b) => a - b);
    return seats[0] ?? -1;
  }

  /**
   * Na espera, depois de entrar gente ou mudar bots: com os 4 assentos ocupados (humano ou bot) tranca a
   * sala e agenda o início; senão cancela o início agendado e destranca.
   */
  private afterOccupancyChange(): void {
    if (this.series !== null || this.closing) return;
    if (this.occupiedSeats() === TABLE_SEATS) {
      if (!this.locked) {
        this.lock().catch((err: unknown) => log.error('truco: lock falhou', { err: String(err) }));
      }
      // Adiado para o próximo tick do relógio: o 4º cliente já terminou de entrar e recebe os
      // primeiros eventos da partida (mensagens enviadas durante o `onJoin` chegam antes de o
      // cliente registrar os handlers). Cancelável: se alguém sai antes do tick, a sala destranca.
      if (this.startTimer === null) {
        this.startTimer = this.clock.setTimeout(() => this.startGame(), 0);
      }
      return;
    }
    if (this.startTimer !== null) {
      this.startTimer.clear();
      this.startTimer = null;
    }
    if (this.locked) {
      this.unlock().catch((err: unknown) =>
        log.error('truco: unlock falhou', { err: String(err) }),
      );
    }
  }

  /**
   * Queda SEM consentimento (core 0.18: `onDrop`). Antes da partida o assento é liberado pelo
   * `onLeave` que o core chama logo depois. Durante a partida o assento fica `away`, o timer normal
   * joga por ele e abre-se a janela de reconexão (`allowReconnection`). Sem retorno, o core chama
   * `onLeave` e o bot assume.
   */
  override onDrop(client: Client, code?: number): void {
    const seat = this.seatBySession.get(client.sessionId);
    if (seat === undefined) return;
    if (this.state.phase === 'waiting' || this.closing) return;
    if (this.expelledSeats.has(seat)) {
      // Expulso por abuso: sem janela (o core segue para `onLeave` e o bot assume).
      log.info('truco: expulso, sem janela de reconexão', { room: this.roomId, seat });
      return;
    }
    if ((this.reconnectCount.get(seat) ?? 0) >= this.maxReconnects()) {
      // Sem direito a janela: o core segue direto para `onLeave` (bot imediato).
      log.warn('truco: teto de reconexões, sem janela', { room: this.roomId, seat });
      return;
    }
    log.info('truco: jogador desconectou', { room: this.roomId, seat, code: code ?? 0 });
    this.droppedSeats.add(seat);
    this.refreshPresence(seat);
    this.afterRosterChange();
    // Não aguardar: o core espera a promessa; o retorno cai em `onReconnect` e a expiração em `onLeave`.
    const reconnection = this.allowReconnection(
      client,
      this.config.reconnectSeconds ?? RECONNECT_SECONDS,
    );
    reconnection.catch(() => undefined);
  }

  /**
   * O jogador voltou pelo token de reconexão (o core já validou o token DESTA sessão e o
   * `reconnectUpgradeGuard` já exigiu o mesmo `userId` do assento). A `sessionId` é a mesma de antes;
   * o `Client` é novo e herda `auth`/`userData` e a `view` ANTIGA, que é descartada aqui.
   */
  override onReconnect(client: Client): void {
    const seat = this.seatBySession.get(client.sessionId);
    const auth = client.auth as JoinAuth | undefined;
    if (seat === undefined || auth === undefined || this.userBySeat.get(seat) !== auth.userId) {
      // Não deveria ocorrer (o guard do upgrade confere o dono): trata como violação. Marca o assento
      // como expulso (sem nova janela; o bot assume) e bane do recinto quem se apresentou como outro.
      log.error('truco: reconexão com assento inconsistente', { room: this.roomId });
      if (seat !== undefined) this.expelledSeats.add(seat);
      const owner = seat === undefined ? undefined : this.userBySeat.get(seat);
      if (typeof auth?.userId === 'string' && auth.userId !== owner) {
        this.bannedUsers.add(auth.userId);
      }
      client.leave(POLICY_CLOSE_CODE);
      return;
    }
    log.info('truco: jogador reconectou', { room: this.roomId, seat });
    this.resume(client, seat);
  }

  /** Saída DEFINITIVA: consentida, janela expirada, sem direito a janela ou reconexão falha. */
  override onLeave(client: Client, code?: number): void {
    const seat = this.seatBySession.get(client.sessionId);
    if (seat === undefined) return;
    client.view?.dispose();
    if (this.state.phase === 'waiting') {
      // Antes da partida o assento volta a ficar livre.
      this.seatBySession.delete(client.sessionId);
      const leaver = this.userBySeat.get(seat);
      // Mesa da fila ainda em espera: sair depois de sentar custa o cooldown de reentrada na fila.
      if (leaver !== undefined) {
        getLobby()?.unseat(leaver, this.roomId, this.grant?.kind === 'queue' && !this.closing);
      }
      this.userBySeat.delete(seat);
      // Nada do ocupante anterior pode ser herdado pelo próximo (strikes, contadores). EXCEÇÃO de
      // propósito: cooldowns de sinal/sfx/chat (`lastSignalAt`, `lastSfxAt`, `lastChatAt`) ficam por
      // assento, para sair e voltar na espera não zerar o rate limit.
      this.invalidAt.delete(seat);
      this.lastActionAt.delete(seat);
      this.lastReadyAt.delete(seat);
      this.warnState.delete(seat);
      this.timeouts.delete(seat);
      this.lastSeq.delete(seat);
      this.seatPresence.delete(seat);
      this.reconnectCount.delete(seat);
      // Quem sentar depois não herda a expulsão (o ban por `userId` continua em `bannedUsers`).
      this.expelledSeats.delete(seat);
      setPlayer(this.state, seat, { nickname: '', avatar: '', status: 'empty' });
      if (this.hostSeat === seat) this.setHost(this.lowestHumanSeat());
      this.syncPairs();
      this.afterOccupancyChange();
      return;
    }
    // Partida em curso: o humano não volta pela janela. O bot assume AGORA (sem esperar 60 s).
    this.seatBySession.delete(client.sessionId);
    this.droppedSeats.delete(seat);
    if (this.closing) return;
    log.info('truco: bot assumiu o assento', {
      room: this.roomId,
      seat,
      consented: code === CloseCode.CONSENTED,
    });
    this.becomeBot(seat);
  }

  override async disconnect(closeCode?: number): Promise<void> {
    this.closing = true;
    await super.disconnect(closeCode);
  }

  override onDispose(): Promise<void> | void {
    this.closing = true;
    this.startTimer?.clear();
    this.turnTimer?.clear();
    this.closeTimer?.clear();
    this.botTimer?.clear();
    this.abandonTimer?.clear();
    this.waitTimer?.clear();
    this.creatorTimer?.clear();
    for (const off of this.unsubscribers.splice(0)) off();
    getLobby()?.releaseRoom(this.roomId);
    // Sala fechada com a série em andamento (desligamento do servidor): grava como abandonada.
    const series = this.series;
    if (series !== null && !isSeriesOver(series)) this.persistMatch(series, 'abandoned');
    if (this.pendingSaves.length > 0) {
      const all = Promise.all(this.pendingSaves.map((p) => p.catch(() => false))).then(() => true);
      return flushWithin(all, DISPOSE_FLUSH_MS);
    }
    return undefined;
  }

  /**
   * Prazos da mesa criada pelo lobby: o criador da privada tem `creatorMs` para sentar; a mesa tem um
   * prazo para a partida começar (fila: `fillMs`, e quem sentou volta à fila na posição original;
   * privada: `waitMs`). Sala vazia fecha pelo `autoDispose` do core.
   */
  private armGrantTimers(grant: Grant): void {
    this.setPrivate(true).catch((err: unknown) =>
      log.error('truco: setPrivate falhou', { err: String(err) }),
    );
    if (grant.kind === 'private') {
      this.creatorTimer = this.clock.setTimeout(() => {
        this.creatorTimer = null;
        // Só vale "nunca sentou". Quem sentou e saiu depois não fecha a mesa: ela segue aberta enquanto
        // houver gente (sala vazia fecha pelo `autoDispose`; o resto, pelo `waitMs`).
        if (this.creatorSeated || this.closing) return;
        log.info('truco: criador não sentou, mesa fechada', { room: this.roomId });
        this.disconnect().catch((err: unknown) =>
          log.error('truco: disconnect falhou', { err: String(err) }),
        );
      }, grant.creatorMs);
    }
    const waitMs = grant.kind === 'queue' ? grant.fillMs : grant.waitMs;
    this.waitTimer = this.clock.setTimeout(() => {
      this.waitTimer = null;
      if (this.series !== null || this.closing) return;
      log.info('truco: mesa não encheu no prazo', { room: this.roomId, kind: grant.kind });
      if (grant.kind === 'queue') getLobby()?.failFill(this.roomId);
      this.disconnect().catch((err: unknown) =>
        log.error('truco: disconnect falhou', { err: String(err) }),
      );
    }, waitMs);
  }

  /**
   * Verificação da identidade de uma RECONEXÃO, chamada pelo `reconnectUpgradeGuard` antes do upgrade
   * do WebSocket: a sessão tem de ter assento e o `userId` apresentado tem de ser o do assento.
   * (O token de reconexão em si é validado pelo core, por sessão.)
   */
  authorizeReconnect(sessionId: string, userId: string | undefined): boolean {
    const seat = this.seatBySession.get(sessionId);
    if (seat === undefined || userId === undefined) return false;
    // Conta apagada ou assento expulso nunca retomam (o bot já assumiu ou vai assumir).
    if (this.deletedUsers.has(userId) || this.expelledSeats.has(seat)) return false;
    return this.userBySeat.get(seat) === userId;
  }

  /**
   * Dono do token de reconexão: a identidade do `POST /matchmake/reconnect` (JWT já validado pelo
   * wrapper em `server.ts`, que o core não repassa à sala) tem de ser a do assento da sessão a que o
   * token pertence. Token desconhecido/de cliente conectado: `false`.
   */
  authorizeReconnectionToken(reconnectionToken: string, userId: string): boolean {
    const reconnections = (
      this as unknown as { _reconnections?: Record<string, [string, unknown] | undefined> }
    )._reconnections;
    const sessionId = reconnections?.[reconnectionToken]?.[0];
    return sessionId !== undefined && this.authorizeReconnect(sessionId, userId);
  }

  /**
   * `POST /matchmake/reconnect` chega aqui SEM identidade e, no core, token de um cliente CONECTADO
   * faz `forciblyClose` dele (derrubar a vítima com um token vazado). Aqui só vale token de janela
   * aberta (`allowReconnection`); cliente conectado nunca é derrubado por esta via. Escolhido em vez de
   * interceptar a rota HTTP porque vale por qualquer caminho que chegue à sala e não depende do
   * formato do request nem de reescrever o roteador do core. Custo: socket zumbi (queda ainda não
   * detectada pelo ping) só reconecta depois que o servidor notar a queda. A reserva gerada aqui ainda
   * passa pelo `reconnectUpgradeGuard` no upgrade do WebSocket.
   */
  override checkReconnectionToken(reconnectionToken: string): string {
    // O tipo do core é `string`, mas o valor "sem direito" é `undefined` (ver `matchMaker.reconnect`).
    if (this.clients.some((c) => c.reconnectionToken === reconnectionToken)) {
      return undefined as unknown as string;
    }
    return super.checkReconnectionToken(reconnectionToken);
  }

  // ---------------------------------------------------------------- presença e bot

  private maxReconnects(): number {
    return this.config.maxReconnects ?? DEFAULT_MAX_RECONNECTS;
  }

  /** Humano do assento tem socket vivo e não é bot. */
  private connectedHumans(): Seat[] {
    return [...this.userBySeat.keys()].filter(
      (s) => !this.botSeats.has(s) && !this.droppedSeats.has(s),
    );
  }

  /** Assentos de humanos (conectados ou na janela de reconexão). */
  private humanSeats(): Seat[] {
    return [...this.userBySeat.keys()].filter((s) => !this.botSeats.has(s));
  }

  private presenceOf(seat: Seat): PresenceStatus {
    if (this.botSeats.has(seat)) return 'bot';
    if (this.droppedSeats.has(seat) || (this.timeouts.get(seat) ?? 0) >= IDLE_TIMEOUTS) {
      return 'away';
    }
    return 'online';
  }

  /** Recalcula a presença do assento; se mudou, atualiza o schema e avisa a mesa. */
  private refreshPresence(seat: Seat): void {
    const status = this.presenceOf(seat);
    if (this.seatPresence.get(seat) === status) return;
    this.seatPresence.set(seat, status);
    setPlayer(this.state, seat, {
      status: status === 'online' ? 'connected' : status,
      isBot: status === 'bot',
    });
    const msg: Omit<Extract<ServerMessage, { type: 'presence' }>, 'type'> = { seat, status };
    this.broadcast('presence', msg);
  }

  /** Efeitos de mudar quem está presente: votos, abandono. */
  private afterRosterChange(): void {
    this.pruneVotes();
    this.pruneRematchVotes();
    this.checkVotes();
    this.checkRematch();
    this.checkAbandon();
  }

  private becomeBot(seat: Seat): void {
    this.botSeats.add(seat);
    this.absenceBotSeats.add(seat);
    // O humano saiu de vez: o vínculo global é liberado (pode jogar em outra mesa); o assento dele
    // segue reservado ao bot e ele só volta com o código (mesa privada) ou pelo próprio `userId`.
    const owner = this.userBySeat.get(seat);
    if (owner !== undefined) getLobby()?.unseat(owner, this.roomId);
    this.recorder?.noteBot(seat, this.seq);
    this.refreshPresence(seat);
    const series = this.series;
    if (series !== null && !isSeriesOver(series)) {
      // O core só deixa entrar de novo (mesmo `userId`) numa sala destrancada.
      if (this.locked) {
        this.unlock().catch((err: unknown) =>
          log.error('truco: unlock falhou', { err: String(err) }),
        );
      }
    }
    this.afterRosterChange();
    const now = this.series;
    // Só agenda o bot: o prazo do turno em andamento NÃO é reiniciado.
    if (now !== null && !isSeriesOver(now) && pendingSeats(now).includes(seat)) this.rearmBot(now);
  }

  /** Dono do assento que o bot ocupa voltando por um novo join (mesmo `userId`). */
  private reclaimSeat(client: Client, seat: Seat): void {
    if (this.series === null || !this.botSeats.has(seat)) {
      throw new ServerError(409, 'ALREADY_SEATED');
    }
    if ((this.reconnectCount.get(seat) ?? 0) >= this.maxReconnects()) {
      throw new ServerError(409, 'ROOM_FULL');
    }
    const owner = this.userBySeat.get(seat);
    if (owner !== undefined) this.bindToTable(owner);
    this.seatBySession.set(client.sessionId, seat);
    log.info('truco: dono retomou o assento do bot', { room: this.roomId, seat });
    this.resume(client, seat);
  }

  /**
   * Devolve o assento ao humano (reconexão ou novo join): vista própria nova, presença, replay dos
   * eventos perdidos, relógio do turno. Cancela o bot do turno (nunca duas ações no mesmo turno).
   */
  private resume(client: Client, seat: Seat): void {
    metrics.inc('reconnections');
    this.reconnectCount.set(seat, (this.reconnectCount.get(seat) ?? 0) + 1);
    this.botSeats.delete(seat);
    this.absenceBotSeats.delete(seat);
    this.droppedSeats.delete(seat);
    this.timeouts.set(seat, 0);
    // O core copia a view ANTIGA para o novo `Client`; ela é descartada e recriada.
    client.view?.dispose();
    client.view = createSeatView(this.state, seat);
    this.refreshPresence(seat);
    this.sendCatchUp(client, seat);
    for (const [other, status] of this.seatPresence) {
      if (other === seat) continue;
      const msg: Omit<Extract<ServerMessage, { type: 'presence' }>, 'type'> = {
        seat: other,
        status,
      };
      client.send('presence', msg);
    }
    // Cancela o bot agendado SEM reiniciar o prazo: o `turnTimer` e o `deadlineAt` originais seguem
    // valendo (reconectar não estende o turno). Ele já está armado para qualquer dono do turno.
    const series = this.series;
    if (series !== null && !isSeriesOver(series) && pendingSeats(series).includes(seat)) {
      this.botTimer?.clear();
      this.botTimer = null;
      // Onze/dez: o outro decisor pode ser bot e seguir esperando.
      this.rearmBot(series);
    }
    if (this.currentTurn !== null) client.send('turnTimer', this.currentTurn);
    this.sendCodesTo(client, seat);
    this.afterRosterChange();
  }

  /**
   * Reenvia os eventos com `seq` maior que o último enviado ao socket anterior, em ordem, na visão
   * pública sem assento (`eventLog`). A identidade da PRÓPRIA carta coberta NÃO vem daqui: está em
   * `privates[seat].ownCovered` do estado completo. Eventos enviados a um socket já morto, antes de o
   * servidor notar a queda, contam como entregues: o cliente deve tratar salto de `seq` como pedido
   * de resincronização pelo estado.
   */
  private sendCatchUp(client: Client, seat: Seat): void {
    const from = this.lastSeq.get(seat) ?? this.seq;
    const oldest = this.eventLog[0];
    // Lacuna (eventos já descartados pelo teto): sem replay parcial; vale o estado completo.
    if (oldest !== undefined && oldest.seq > from + 1) {
      this.lastSeq.set(seat, this.seq);
      return;
    }
    for (const e of this.eventLog) {
      if (e.seq <= from) continue;
      const payload: EventPayload = { seq: e.seq, at: e.at, event: e.event };
      client.send('event', payload);
    }
    this.lastSeq.set(seat, this.seq);
  }

  /** Série cancelada porque nenhum humano está conectado por `abandonMs`. */
  private checkAbandon(): void {
    const series = this.series;
    if (series === null || isSeriesOver(series) || this.closing) {
      this.clearAbandon();
      return;
    }
    if (this.connectedHumans().length > 0) {
      this.clearAbandon();
      return;
    }
    if (this.abandonTimer !== null) return;
    if (this.humanSeats().length === 0) {
      // Todos os humanos saíram de vez: ninguém volta pela janela.
      this.abandon();
      return;
    }
    const ms = this.config.abandonMs ?? (this.config.reconnectSeconds ?? RECONNECT_SECONDS) * 1000;
    this.abandonTimer = this.clock.setTimeout(() => this.abandon(), ms);
  }

  private clearAbandon(): void {
    this.abandonTimer?.clear();
    this.abandonTimer = null;
  }

  private abandon(): void {
    this.abandonTimer = null;
    const series = this.series;
    if (series === null || isSeriesOver(series) || this.closing) return;
    if (this.connectedHumans().length > 0) return;
    log.info('truco: série cancelada por abandono', { room: this.roomId });
    this.endReason = 'abandoned';
    this.cancelNow(series);
  }

  private cancelNow(series: SeriesState): ErrorCode | null {
    const r = cancelSeries(series);
    if (!r.ok) return r.error.code;
    this.series = r.state;
    this.emitEvents(r.events);
    this.sync();
    return null;
  }

  // ---------------------------------------------------------------- partida

  /** Vínculo global "um usuário, uma mesa" (lobby). Lança se o usuário já está em outra mesa ou fila. */
  private bindToTable(userId: string): void {
    this.pendingReservations.delete(userId);
    if (getLobby()?.seat(userId, this.roomId) === false) {
      throw new ServerError(409, 'ALREADY_IN_TABLE');
    }
    if (this.grant?.kind === 'private' && this.grant.creator === userId) {
      this.creatorSeated = true;
      this.creatorTimer?.clear();
      this.creatorTimer = null;
    }
  }

  /**
   * Assento de quem entra. Mesa da fila: o SORTEADO pelo lobby para este `userId` (a ordem de chegada não
   * conta); sem assento sorteado ou ocupado, recusa. Demais mesas: o primeiro livre.
   */
  private seatFor(userId: string): Seat | null {
    const seats = this.grant?.kind === 'queue' ? this.grant.seats : null;
    if (seats === null) return this.firstFreeSeat();
    const seat = seats.get(userId);
    return seat !== undefined && !this.isOccupied(seat) ? seat : null;
  }

  private firstFreeSeat(): Seat | null {
    for (let s = 0; s < TABLE_SEATS; s++) if (!this.isOccupied(s)) return s;
    return null;
  }

  private startGame(pe: Seat = 0): void {
    this.startTimer = null;
    const options = this.options;
    if (options === null || this.series !== null || this.occupiedSeats() !== TABLE_SEATS) return;
    const variant = variantById(options.variant);
    const ironHand = options.ironHand;
    const started = startSeries({
      variant,
      config: { format: options.format, ironHand },
      pe,
      rng: this.rng,
    });
    let series = started.state;
    let events: readonly GameEvent[] = started.events;
    const scores = this.config.initialScores;
    // Placar forçado vale só na 1ª partida da sala (a revanche começa sempre do zero).
    if (this.matchNumber === 1 && scores !== undefined && (scores[0] !== 0 || scores[1] !== 0)) {
      // Só teste/servidor: refaz a 1ª mão já com o placar forçado (onze, dez, ferro).
      const hand = startHand({ variant, pe, scores, ironHand, rng: this.rng });
      series = { ...series, match: { ...series.match, scores, hand } };
      events = events.map((e) =>
        e.type === 'handStarted' ? { ...e, scores, special: hand.special } : e,
      );
    }
    this.series = series;
    this.signalsBySeat.clear();
    this.recorder = new MatchRecorder({
      options,
      roomCode: this.state.roomCode,
      seed: this.seed,
      startedAt: new Date(),
      matchNumber: this.matchNumber,
    });
    // Quem já é bot ao começar (inclusive na revanche) conta como bot desde o início da partida.
    for (const s of this.botSeats) this.recorder.noteBot(s, this.seq);
    this.waitTimer?.clear();
    this.waitTimer = null;
    // Em série a sala não pode voltar à lista pública (o `unlock` do bot a reexporia a estranhos para
    // `joinOrCreate`, que daria ROOM_FULL). `joinById` ignora `private`: o dono ainda reentra.
    this.setPrivate(true).catch((err: unknown) =>
      log.error('truco: setPrivate falhou', { err: String(err) }),
    );
    this.emitEvents(events);
    this.sync();
    log.info('truco: partida iniciada', { room: this.roomId, format: options.format });
  }

  // ---------------------------------------------------------------- mensagens

  private reject(client: Client, code: ErrorCode): void {
    client.send('error', { code });
  }

  private handleMessage(client: Client, type: string | number, payload: unknown): void {
    try {
      this.route(client, type, payload);
    } catch (err) {
      // Nunca deixa exceção escapar: estado intacto, cliente avisado, causa só no log.
      log.error('truco: falha ao tratar mensagem', { room: this.roomId, err: String(err) });
      this.reject(client, 'INVALID_PAYLOAD');
    }
  }

  private route(client: Client, type: string | number, payload: unknown): void {
    const seat = this.seatBySession.get(client.sessionId);
    if (seat === undefined) {
      this.reject(client, 'NOT_SEATED');
      return;
    }
    const parsed = parseClientMessage(buildRaw(type, payload));
    if (!parsed.ok) {
      if (parsed.code === 'CHAT_BLOCKED' && type === 'setCode') {
        // Significado recusado pela limpeza: não é abuso (sem strike), mas custa o cooldown do combinado.
        const cooldown = this.config.codesCooldownMs ?? CODES_COOLDOWN_MS;
        this.reject(
          client,
          this.cooldownPassed(this.lastCodeAt, seat, cooldown) ? parsed.code : 'RATE_LIMITED',
        );
        return;
      }
      if (parsed.code === 'CHAT_BLOCKED') {
        // Texto recusado pela limpeza (ex.: emoji com ZWJ) não é abuso: sem strike nem expulsão.
        // Mas custa cooldown de chat (o MESMO de `social`, inclusive para quem acerta depois), para
        // que rejeições não sejam spam grátis.
        const cooldown = this.config.chatCooldownMs ?? CHAT_COOLDOWN_MS;
        this.reject(
          client,
          this.cooldownPassed(this.lastChatAt, seat, cooldown) ? parsed.code : 'RATE_LIMITED',
        );
        return;
      }
      this.reject(client, parsed.code);
      this.countInvalid(client, seat, parsed.code);
      return;
    }
    const msg = parsed.message;
    switch (msg.type) {
      case 'signal':
      case 'sfx':
      case 'chat':
        this.social(client, seat, msg);
        return;
      case 'setCode':
        this.setCode(client, seat, msg);
        return;
      case 'ready':
        // A partida começa quando o 4º jogador entra: `ready` não a inicia. Serve de "já registrei os
        // handlers": reenvia o combinado da dupla a este assento (o baseline enviado no `onJoin` pode
        // chegar antes de o cliente ligar o handler de `codes`).
        // Limite próprio (1 por READY_MIN_INTERVAL_MS por assento): NÃO consome nem é barrado pela janela
        // de ação, para o `ready` da entrada não dar `RATE_LIMITED` na primeira jogada. Excesso é ignorado.
        if (this.allowReady(seat)) this.sendCodesTo(client, seat);
        return;
      default:
        break;
    }
    if (!this.allowAction(seat)) {
      this.reject(client, 'RATE_LIMITED');
      return;
    }
    if (msg.type === 'botSeat' || msg.type === 'fillBots') {
      const code = this.changeBots(seat, msg);
      if (code !== null) this.reject(client, code);
      return;
    }
    if (msg.type === 'voteCancel') {
      const code = this.voteCancel(seat);
      if (code !== null) this.reject(client, code);
      return;
    }
    if (msg.type === 'voteRematch') {
      const code = this.voteRematch(seat);
      if (code !== null) this.reject(client, code);
      return;
    }
    const series = this.series;
    if (series === null) {
      this.reject(client, 'NOT_YOUR_TURN');
      return;
    }
    const action = this.toAction(series, msg, seat);
    if (typeof action === 'string') {
      this.reject(client, action);
      return;
    }
    const code = this.applyAndPublish(action);
    if (code !== null) {
      this.reject(client, code);
      return;
    }
    this.timeouts.set(seat, 0);
    this.refreshPresence(seat);
  }

  /**
   * Bots de vaga (`botSeat` e `fillBots`). Ordem das recusas: mesa da fila (`BOTS_NOT_ALLOWED`), quem não é o
   * host (`NOT_HOST`), fora da espera (`BOTS_NOT_ALLOWED`), assento com humano (`SEAT_OCCUPIED`). Estado
   * intocado em qualquer recusa. Pôr bot em assento que já é de bot, ou tirar de assento vazio, não faz nada.
   */
  private changeBots(
    seat: Seat,
    msg: Extract<ClientMessage, { type: 'botSeat' | 'fillBots' }>,
  ): ErrorCode | null {
    // Permissão explícita: só mesa privada concedida pelo lobby (nunca por exclusão).
    if (this.grant?.kind !== 'private' || this.options?.visibility !== 'private') {
      return 'BOTS_NOT_ALLOWED';
    }
    if (seat !== this.hostSeat) return 'NOT_HOST';
    if (this.series !== null || this.state.phase !== 'waiting' || this.closing) {
      return 'BOTS_NOT_ALLOWED';
    }
    if (msg.type === 'fillBots') {
      for (let s = 0; s < TABLE_SEATS; s++) if (!this.isOccupied(s)) this.addVacancyBot(s);
    } else {
      if (this.userBySeat.has(msg.target)) return 'SEAT_OCCUPIED';
      if (msg.enabled) {
        if (!this.vacancyBotSeats.has(msg.target)) this.addVacancyBot(msg.target);
      } else if (this.vacancyBotSeats.has(msg.target)) {
        this.removeVacancyBot(msg.target);
      }
    }
    log.info('truco: bots de vaga', { room: this.roomId, bots: this.vacancyBotSeats.size });
    this.syncPairs();
    this.afterOccupancyChange();
    return null;
  }

  private addVacancyBot(seat: Seat): void {
    const taken = new Set<string>();
    for (const s of this.vacancyBotSeats) taken.add(this.state.players[s]?.nickname ?? '');
    const identity = pickBotIdentity(taken);
    this.vacancyBotSeats.add(seat);
    this.botSeats.add(seat);
    // Sem mensagem `presence` nem entrada em `seatPresence`: o estado já traz `status: 'bot'` e `isBot`.
    // (`presence 'bot'` é só para bot de AUSÊNCIA, que tinha um humano.)
    setPlayer(this.state, seat, {
      nickname: identity.nickname,
      avatar: identity.avatar,
      status: 'bot',
      isBot: true,
    });
  }

  private removeVacancyBot(seat: Seat): void {
    this.vacancyBotSeats.delete(seat);
    this.botSeats.delete(seat);
    this.seatPresence.delete(seat);
    setPlayer(this.state, seat, { nickname: '', avatar: '', status: 'empty', isBot: false });
  }

  /** Cooldown por assento: se já passou, registra o instante e devolve true. */
  private cooldownPassed(last: Map<Seat, number>, seat: Seat, ms: number): boolean {
    const now = Date.now();
    const prev = last.get(seat);
    if (prev !== undefined && now - prev < ms) return false;
    last.set(seat, now);
    return true;
  }

  /**
   * Decide se o chat de `from` pode chegar a `to`. Exige humano com socket vivo (bot e assento caído nunca
   * recebem, e nada é enfileirado para quando voltarem). No chat da MESA, bloqueio entre os dois (em
   * qualquer sentido) descarta a mensagem nos dois sentidos, em silêncio (o remetente não sabe). O chat da
   * DUPLA não é filtrado: bloquear o próprio parceiro não o cala nem o expulsa da dupla (limite
   * conhecido; quem não quer jogar com ele sai da mesa ou o silencia no aparelho).
   */
  private canReceiveChat(from: Seat, to: Seat, scope: 'table' | 'partner'): boolean {
    if (this.botSeats.has(to) || this.droppedSeats.has(to)) return false;
    if (scope === 'table') {
      const a = this.userBySeat.get(from);
      const b = this.userBySeat.get(to);
      if (a !== undefined && b !== undefined && this.isBlockedPair(a, b)) return false;
    }
    return true;
  }

  private isBlockedPair(a: string, b: string): boolean {
    return this.blockEdges.has(`${a}>${b}`) || this.blockEdges.has(`${b}>${a}`);
  }

  /** Assentos por `userId` para gravar a partida, sem as contas apagadas (viram anônimas). */
  private persistableUsers(): Map<Seat, string> {
    if (this.deletedUsers.size === 0) return this.userBySeat;
    return new Map([...this.userBySeat].filter(([, userId]) => !this.deletedUsers.has(userId)));
  }

  /**
   * Conta apagada: se há assento aqui, o socket cai e o bot assume já (sem janela de reconexão). O
   * `userId` sai dos dados gravados. Na espera o assento simplesmente é liberado pelo `onLeave`.
   */
  private dropDeletedUser(userId: string): void {
    for (const [seat, owner] of this.userBySeat) {
      if (owner !== userId) continue;
      this.deletedUsers.add(userId);
      this.expelledSeats.add(seat);
      for (const c of this.clients) {
        if (this.seatBySession.get(c.sessionId) === seat) c.leave(POLICY_CLOSE_CODE);
      }
    }
  }

  /** Broadcast público de um sinal (humano ou bot) aos 4 assentos, com o assento do servidor. */
  private broadcastSignal(seat: Seat, signalId: SignalId, at: number): void {
    const payload: Omit<Extract<ServerMessage, { type: 'signal' }>, 'type'> = {
      seat,
      signalId,
      at,
    };
    this.broadcast('signal', payload);
    log.info('truco: sinal', { room: this.roomId, seat, signalId });
  }

  /**
   * Sinais dos bots de verdade (vagas de bot desde o início; bot de ausência NÃO sinaliza): ao começar
   * uma mão, cada assento de bot sorteia (chance `botSignalChance`) 1 sinal
   * do catálogo. Respeita o MESMO cooldown dos humanos (`lastSignalAt`) e só vale com a série em jogo.
   * Usa aleatoriedade própria: nunca consome o RNG da partida (sorteio e replay seguem iguais).
   */
  private botSignals(): void {
    const series = this.series;
    if (this.closing || series === null || isSeriesOver(series)) return;
    const chance = this.config.botSignalChance ?? DEFAULT_BOT_SIGNAL_CHANCE;
    if (chance <= 0) return;
    const random = this.config.botSignalRandom ?? Math.random;
    const cooldown = this.config.signalCooldownMs ?? SIGNAL_COOLDOWN_MS;
    for (const seat of [...this.botSeats].sort((a, b) => a - b)) {
      if (this.absenceBotSeats.has(seat)) continue;
      if (random() >= chance) continue;
      const signalId =
        SIGNAL_IDS[Math.min(SIGNAL_IDS.length - 1, Math.floor(random() * SIGNAL_IDS.length))];
      if (signalId === undefined) continue;
      if (!this.cooldownPassed(this.lastSignalAt, seat, cooldown)) continue;
      this.broadcastSignal(seat, signalId, Date.now());
    }
  }

  /**
   * Sinais, sfx e chat (2F). O assento é SEMPRE o do servidor (`seatBySession`); a mensagem de saída
   * leva `seat` do remetente. Decisões:
   * - Fora de `playing` (espera, série encerrada/cancelada): `signal`/`sfx` são IGNORADOS em silêncio
   *   (sem erro, sem gastar cooldown); o chat da dupla só existe na espera (Fase 5: a sala de espera é a
   *   preparação da dupla) e é ignorado com a série em andamento ou encerrada. Chat da mesa vale em
   *   qualquer fase.
   * - Dentro do cooldown: `RATE_LIMITED` ao remetente, nada é enviado (igual ao rate limit de ações);
   *   não gera strike.
   * - `signal`/`sfx`: broadcast PÚBLICO aos 4 (é o design: adversários também veem).
   * - `chat` `partner`: só à dupla (`isChatRecipient`) e eco ao remetente; `table`: aos 4. Parceiro bot ou
   *   com socket caído: descartado em silêncio. Chat NUNCA entra em `eventLog`, estado, replay,
   *   persistência nem log (só metadados em debug: assento, escopo, tamanho).
   * - Bot sinaliza por `botSignals` (início de mão), reusando `broadcastSignal` e o cooldown.
   */
  private social(
    client: Client,
    seat: Seat,
    msg: Extract<ClientMessage, { type: 'signal' | 'sfx' | 'chat' }>,
  ): void {
    if (
      this.closing ||
      this.expelledSeats.has(seat) ||
      this.botSeats.has(seat) ||
      this.droppedSeats.has(seat)
    ) {
      return;
    }
    const series = this.series;
    const playing = series !== null && !isSeriesOver(series);
    const at = Date.now();
    if (msg.type === 'chat') {
      // Chat da dupla só existe na espera (série ainda nula). Com a série em andamento ou encerrada,
      // é ignorado em silêncio (durante a partida o chat é só da mesa).
      if (msg.scope === 'partner' && series !== null) return;
      if (
        !this.cooldownPassed(this.lastChatAt, seat, this.config.chatCooldownMs ?? CHAT_COOLDOWN_MS)
      ) {
        this.reject(client, 'RATE_LIMITED');
        return;
      }
      const base = { scope: msg.scope, seat, at };
      const payload =
        'text' in msg ? { ...base, text: msg.text } : { ...base, phraseId: msg.phraseId };
      for (const c of this.clients) {
        const to = this.seatBySession.get(c.sessionId);
        if (to === undefined) continue;
        if (!isChatRecipient(msg.scope, seat, to)) continue;
        if (to !== seat && !this.canReceiveChat(seat, to, msg.scope)) continue;
        c.send('chat', payload);
      }
      log.debug('truco: chat', {
        room: this.roomId,
        seat,
        scope: msg.scope,
        length: 'text' in msg ? msg.text.length : 0,
      });
      return;
    }
    if (!playing) return;
    if (msg.type === 'signal') {
      if (
        !this.cooldownPassed(
          this.lastSignalAt,
          seat,
          this.config.signalCooldownMs ?? SIGNAL_COOLDOWN_MS,
        )
      ) {
        this.reject(client, 'RATE_LIMITED');
        return;
      }
      this.broadcastSignal(seat, msg.signalId, at);
      this.signalsBySeat.set(seat, (this.signalsBySeat.get(seat) ?? 0) + 1);
      return;
    }
    if (!this.cooldownPassed(this.lastSfxAt, seat, this.config.sfxCooldownMs ?? SFX_COOLDOWN_MS)) {
      this.reject(client, 'RATE_LIMITED');
      return;
    }
    const payload: Omit<Extract<ServerMessage, { type: 'sfx' }>, 'type'> = {
      seat,
      sfxId: msg.sfxId,
      at,
    };
    this.broadcast('sfx', payload);
    log.info('truco: sfx', { room: this.roomId, seat, sfxId: msg.sfxId });
  }

  /** Limite do `ready` (reenvio de `codes`), independente de `allowAction`. */
  private allowReady(seat: Seat): boolean {
    const now = Date.now();
    const last = this.lastReadyAt.get(seat);
    if (last !== undefined && now - last < READY_MIN_INTERVAL_MS) return false;
    this.lastReadyAt.set(seat, now);
    return true;
  }

  /** Rate limit por assento (em memória da sala). */
  private allowAction(seat: Seat): boolean {
    const now = Date.now();
    const min = this.config.actionMinIntervalMs ?? ACTION_MIN_INTERVAL_MS;
    const last = this.lastActionAt.get(seat);
    if (last !== undefined && now - last < min) return false;
    this.lastActionAt.set(seat, now);
    return true;
  }

  /** `warn` limitado: 1 por assento por janela, com o total suprimido na linha seguinte. */
  private warnInvalid(seat: Seat, code: ErrorCode, now: number): void {
    const st = this.warnState.get(seat);
    if (st !== undefined && now - st.at < INVALID_WARN_WINDOW_MS) {
      st.suppressed++;
      return;
    }
    log.warn('truco: mensagem inválida', {
      room: this.roomId,
      seat,
      code,
      suppressed: st?.suppressed ?? 0,
    });
    this.warnState.set(seat, { at: now, suppressed: 0 });
  }

  /** Conta payload inválido (`INVALID_PAYLOAD`, `INVALID_SIGNAL`, `INVALID_SFX`) e expulsa o abuso. */
  private countInvalid(client: Client, seat: Seat, code: ErrorCode): void {
    const now = Date.now();
    this.warnInvalid(seat, code, now);
    const recent = (this.invalidAt.get(seat) ?? []).filter(
      (t) => now - t < INVALID_PAYLOAD_WINDOW_MS,
    );
    recent.push(now);
    this.invalidAt.set(seat, recent);
    if (recent.length >= INVALID_PAYLOAD_LIMIT) {
      log.warn('truco: expulso por payload inválido repetido', { room: this.roomId, seat });
      // Marca ANTES do `leave`: a queda cai em `onDrop`, que não pode abrir janela para o expulso.
      this.expelledSeats.add(seat);
      const userId = this.userBySeat.get(seat);
      if (userId !== undefined) this.bannedUsers.add(userId);
      client.leave(POLICY_CLOSE_CODE);
    }
  }

  /** Tradução mensagem -> `HandAction`. Devolve `ErrorCode` se não há ação possível. */
  private toAction(series: SeriesState, msg: ClientMessage, seat: Seat): HandAction | ErrorCode {
    switch (msg.type) {
      case 'play':
        return msg.covered === true
          ? { type: 'playCard', seat, card: msg.card, covered: true }
          : { type: 'playCard', seat, card: msg.card };
      case 'playBlind':
        return { type: 'playBlindCard', seat, index: msg.index };
      case 'accept':
        return { type: 'acceptBet', seat };
      case 'run':
        return { type: 'runBet', seat };
      case 'special':
        return msg.decision === 'play'
          ? { type: 'playSpecial', seat }
          : { type: 'runSpecial', seat };
      case 'bet': {
        // `callBet` (pedir) ou `raiseBet` (aumentar) conforme o que o motor permite agora.
        const legal = legalActions(series, seat).find(
          (a) => a.type === 'callBet' || a.type === 'raiseBet',
        );
        if (legal !== undefined) return legal;
        // Nada legal: deixa o motor explicar (BET_PENDING, BET_NOT_ALLOWED, NOT_YOUR_TURN...).
        const guess: HandAction =
          series.match.hand.phase === 'betPending'
            ? { type: 'raiseBet', seat }
            : { type: 'callBet', seat };
        // RNG descartável: a tentativa nunca consome o sorteio da sala.
        const trial = applySeriesAction(series, guess, mulberry32(0));
        // Se o motor (inesperadamente) aceitar algo fora de `legalActions`, a trial é descartada.
        return trial.ok ? 'NOT_YOUR_TURN' : trial.error.code;
      }
      default:
        return 'INVALID_PAYLOAD';
    }
  }

  /**
   * Aplica a ação no motor. Sucesso: atualiza `series`, envia eventos, projeta o schema e rearma o
   * timer; devolve `null`. Falha: devolve o código do motor e não toca em nada.
   */
  private applyAndPublish(action: HandAction): ErrorCode | null {
    const series = this.series;
    if (series === null) return 'NOT_YOUR_TURN';
    // Ação recusada não consome sorteio (o motor só embaralha ao aceitar e fechar a mão).
    const r = applySeriesAction(series, action, this.rng);
    if (!r.ok) return r.error.code;
    this.series = r.state;
    this.emitEvents(r.events);
    this.sync();
    return null;
  }

  /**
   * Voto de cancelamento: vale a UNANIMIDADE dos humanos conectados (bots não votam; ausente não
   * conta). O voto vale só dentro da mão: zera a cada `handStarted` e some quando o votante cai.
   */
  private voteCancel(seat: Seat): ErrorCode | null {
    const series = this.series;
    if (series === null) return 'NOT_YOUR_TURN';
    if (isSeriesOver(series)) return 'SERIES_FINISHED';
    this.cancelVotes.add(seat);
    this.publishVotes();
    return this.checkVotes();
  }

  private publishVotes(): void {
    setCancelVotes(
      this.state,
      [...this.cancelVotes].sort((a, b) => a - b),
    );
  }

  /** Descarta voto de quem não é humano conectado (caiu, virou bot). */
  private pruneVotes(): void {
    const voters = new Set(this.connectedHumans());
    let changed = false;
    for (const s of [...this.cancelVotes]) {
      if (!voters.has(s)) {
        this.cancelVotes.delete(s);
        changed = true;
      }
    }
    if (changed) this.publishVotes();
  }

  private checkVotes(): ErrorCode | null {
    const series = this.series;
    if (series === null || isSeriesOver(series) || this.cancelVotes.size === 0) return null;
    const voters = this.connectedHumans();
    if (voters.length === 0 || !voters.every((s) => this.cancelVotes.has(s))) return null;
    return this.cancelNow(series);
  }

  // ---------------------------------------------------------------- revanche

  private rematchWindowOpen(): boolean {
    const s = this.series;
    return (
      s !== null &&
      s.winner !== null &&
      !s.cancelled &&
      this.rematchDeadlineAt > 0 &&
      Date.now() < this.rematchDeadlineAt &&
      !this.closing
    );
  }

  /** Abre a janela de "Jogar de novo": o fechamento da sala passa a ser o fim da janela. */
  private openRematchWindow(): void {
    if (this.rematchDeadlineAt > 0 || this.closeTimer !== null) return;
    const ms = this.config.rematchWindowMs ?? DEFAULT_REMATCH_WINDOW_MS;
    this.rematchDeadlineAt = Date.now() + ms;
    this.state.rematchDeadlineAt = this.rematchDeadlineAt;
    this.scheduleClose(ms);
  }

  /**
   * Voto de revanche: só com a janela aberta (série com vencedor) e pelo menos `REMATCH_MIN_HUMANS`
   * humanos conectados. Idempotente, sem "desvoto". Unanimidade dos humanos conectados inicia a revanche.
   */
  private voteRematch(seat: Seat): ErrorCode | null {
    if (!this.rematchWindowOpen() || this.rematchBlockedByBots()) return 'REMATCH_NOT_AVAILABLE';
    const voters = this.connectedHumans();
    if (voters.length < this.rematchMinHumans() || !voters.includes(seat)) {
      return 'REMATCH_NOT_AVAILABLE';
    }
    if (!this.rematchVotes.has(seat)) {
      this.rematchVotes.add(seat);
      this.publishRematchVotes();
    }
    this.checkRematch();
    return null;
  }

  /** Com bots de vaga na mesa basta 1 humano conectado; sem eles, `REMATCH_MIN_HUMANS`. */
  private rematchMinHumans(): number {
    return this.vacancyBotSeats.size > 0 ? 1 : REMATCH_MIN_HUMANS;
  }

  /**
   * Mesa com bot de vaga: sem revanche se algum humano SAIU (assento em bot de ausência, com o `userId` dele)
   * ou se a sala já jogou `MAX_BOT_TABLE_MATCHES` séries (limita gravação em `matches` por abuso). A
   * primeira partida nunca é bloqueada. Uso de `REMATCH_NOT_AVAILABLE` (sem código novo).
   */
  private rematchBlockedByBots(): boolean {
    if (this.vacancyBotSeats.size === 0) return false;
    return this.absenceBotSeats.size > 0 || this.matchNumber >= MAX_BOT_TABLE_MATCHES;
  }

  private publishRematchVotes(): void {
    setRematchVotes(
      this.state,
      [...this.rematchVotes].sort((a, b) => a - b),
    );
  }

  /** Descarta voto de quem não é humano conectado (caiu, virou bot). */
  private pruneRematchVotes(): void {
    if (this.rematchVotes.size === 0) return;
    const voters = new Set(this.connectedHumans());
    let changed = false;
    for (const s of [...this.rematchVotes]) {
      if (!voters.has(s)) {
        this.rematchVotes.delete(s);
        changed = true;
      }
    }
    if (changed) this.publishRematchVotes();
  }

  private checkRematch(): void {
    if (this.rematchVotes.size === 0 || !this.rematchWindowOpen()) return;
    if (this.rematchBlockedByBots()) return;
    const voters = this.connectedHumans();
    if (voters.length < this.rematchMinHumans()) return;
    if (!voters.every((s) => this.rematchVotes.has(s))) return;
    this.startRematch();
  }

  /**
   * Nova partida na mesma sala, assentos e duplas. Semente nova, placares zerados, `seq`/`eventLog`
   * contínuos e o pé gira (`nextSeat` do pé da última mão). A partida anterior já foi gravada.
   */
  private startRematch(): void {
    const prev = this.series;
    if (prev === null || prev.winner === null || this.closing) return;
    const pe = nextSeat(prev.match.hand.pe, prev.seats);
    this.closeTimer?.clear();
    this.closeTimer = null;
    this.rematchVotes.clear();
    this.publishRematchVotes();
    this.rematchDeadlineAt = 0;
    this.state.rematchDeadlineAt = 0;
    this.endReason = null;
    this.series = null;
    this.matchNumber += 1;
    this.state.matchNumber = this.matchNumber;
    this.seed =
      this.config.rngSeed !== undefined
        ? this.config.rngSeed + this.matchNumber - 1
        : randomInt(0, 2 ** 32);
    this.rng = mulberry32(this.seed);
    this.timeouts.clear();
    this.reconnectCount.clear(); // cada partida tem o seu teto de reconexões
    for (const s of this.userBySeat.keys()) this.refreshPresence(s);
    // Quem virou bot na janela segue com a cadeira reservada: o dono só reentra em sala destrancada.
    // Bot de vaga não tem dono: não destranca.
    if (this.absenceBotSeats.size > 0 && this.locked) {
      this.unlock().catch((err: unknown) =>
        log.error('truco: unlock falhou', { err: String(err) }),
      );
    }
    log.info('truco: revanche iniciada', { room: this.roomId, matchNumber: this.matchNumber });
    this.startGame(pe);
  }

  // ---------------------------------------------------------------- eventos

  /** Um `event` por cliente (não `broadcast`): a carta coberta é vista só pelo dono. */
  private emitEvents(events: readonly GameEvent[]): void {
    for (const ev of events) {
      const seq = ++this.seq;
      const at = Date.now();
      const logged: LoggedEvent = { seq, at, event: publicEvent(ev) };
      this.eventLog.push(logged);
      this.recordEvent(logged, ev);
      const max = this.config.eventLogMax ?? DEFAULT_EVENT_LOG_MAX;
      if (this.eventLog.length > max) {
        const drop = this.eventLog.length - max;
        this.eventLog.splice(0, drop);
        this.eventsEvicted += drop;
      }
      for (const client of this.clients) {
        const seat = this.seatBySession.get(client.sessionId);
        if (seat === undefined) continue;
        const payload: EventPayload = { seq, at, event: publicEvent(ev, seat) };
        client.send('event', payload);
        this.lastSeq.set(seat, seq);
      }
    }
    // Voto de cancelamento vale só dentro da mão.
    if (this.cancelVotes.size > 0 && events.some((e) => e.type === 'handStarted')) {
      this.cancelVotes.clear();
      this.publishVotes();
    }
    if (events.some((e) => e.type === 'handStarted')) this.botSignals();
  }

  // ---------------------------------------------------------------- registro da partida (2H)

  /**
   * Único ponto de entrada do registro: eventos do MOTOR em visão pública (nunca chat, sinal nem sfx) e,
   * a cada mão, o sorteio de todos para auditoria (`deals`, jamais exposto). `this.series` já é o estado
   * DEPOIS da transição que gerou os eventos.
   */
  private recordEvent(logged: LoggedEvent, ev: GameEvent): void {
    const recorder = this.recorder;
    if (recorder === null) return;
    recorder.addEvent(logged);
    const series = this.series;
    if (ev.type === 'handStarted' && series !== null) {
      const hand = series.match.hand;
      recorder.addDeal({
        seq: logged.seq,
        game: series.gameNumber,
        hand: ev.handNumber,
        vira: hand.vira === null ? null : { rank: hand.vira.rank, suit: hand.vira.suit },
        hands: hand.hands.map((h) => h.map((c) => ({ rank: c.rank, suit: c.suit }))),
      } satisfies JsonValue);
    }
  }

  /**
   * Fecha o registro e grava (uma vez só, também se `onDispose` chegar depois). Falha do banco NÃO pára
   * a sala: a gravação roda em segundo plano, com tentativas limitadas, e só loga sem PII.
   */
  private persistMatch(series: SeriesState, reason?: EndReason): void {
    const recorder = this.recorder;
    if (recorder === null || recorder.isFinalized) return;
    const finished = series.winner !== null && !series.cancelled;
    const input = recorder.finalize({
      status: finished ? 'finished' : 'cancelled',
      winnerTeam: finished ? series.winner : null,
      endReason: reason ?? this.endReason ?? (finished ? 'finished' : 'cancelled'),
      endedAt: new Date(),
      users: this.persistableUsers(),
    });
    const repo = this.config.matches;
    if (input === null || repo === undefined) return;
    // Par novo: o combinado só é gravado depois que a 1ª partida finalizada do par foi gravada
    // (`savePartnerCodes` exige o vínculo). Série cancelada não grava.
    // Sinais por assento desta partida (copiados já: a revanche zera o contador).
    const signals = new Map(this.signalsBySeat);
    const saving = recorder.save(repo, input, this.roomId).then(async (ok) => {
      metrics.inc(ok ? 'matchesSaved' : 'matchesSaveFailed');
      if (ok && finished) await this.persistNewPairs();
      if (ok) await this.persistProgression(recorder.matchId, input, signals);
      return ok;
    });
    this.track(saving);
  }

  /** Conquistas, missões e estatísticas. Falha daqui só vira log: a partida já está gravada. */
  private async persistProgression(
    matchId: string | null,
    input: FinishedMatchInput,
    signals: ReadonlyMap<number, number>,
  ): Promise<void> {
    const progression = this.config.progression;
    if (progression === undefined || matchId === null) return;
    try {
      const result = await applyMatchProgression(
        progression,
        matchId,
        input,
        signals,
        this.config.progressionPolicy,
      );
      if (result === null) metrics.inc('progressionInvalid');
      else metrics.inc(result.applied ? 'progressionApplied' : 'progressionDuplicate');
      if (result?.applied === true) {
        log.info('truco: progressão aplicada', {
          room: this.roomId,
          unlocked: result.unlocked.length,
          missionsCompleted: result.missionsCompleted.length,
        });
      }
    } catch (err) {
      metrics.inc('progressionFailed');
      // Só nome e código: o erro bruto do Prisma pode carregar dados.
      log.error('truco: falha ao aplicar progressão', {
        room: this.roomId,
        name: err instanceof Error ? err.name : 'unknown',
        code: err instanceof PersistenceError ? err.code : null,
      });
    }
  }

  private track(p: Promise<boolean>): void {
    this.pendingSaves.push(p);
    void p.finally(() => {
      const i = this.pendingSaves.indexOf(p);
      if (i >= 0) this.pendingSaves.splice(i, 1);
    });
  }

  // ---------------------------------------------------------------- combinado da dupla (Fase 5)

  private teamSeats(team: number): Seat[] {
    const out: Seat[] = [];
    for (let s = 0; s < TABLE_SEATS; s++) if (teamOf(s) === team) out.push(s);
    return out;
  }

  /** Reavalia os dois times: par novo (ou desfeito) recarrega o combinado do banco. */
  private syncPairs(): void {
    for (const team of [0, 1]) {
      const [s1, s2] = this.teamSeats(team);
      const a = s1 === undefined ? undefined : this.userBySeat.get(s1);
      const b = s2 === undefined ? undefined : this.userBySeat.get(s2);
      const key = a !== undefined && b !== undefined && a !== b ? [a, b].sort().join('|') : null;
      const cur = this.pairs.get(team);
      if (cur?.key === key) continue;
      if (cur !== undefined) this.pairs.delete(team);
      if (a === undefined || b === undefined || key === null) {
        // Par desfeito: o parceiro que ficou volta a ver o combinado vazio.
        if (cur !== undefined) this.sendEmptyCodes(team);
        continue;
      }
      const state: PairCodes = {
        key,
        a,
        b,
        codes: {},
        touched: new Set(),
        loaded: false,
        loadFailed: false,
        linked: false,
        dirty: false,
        flushing: null,
        lastEditor: null,
      };
      this.pairs.set(team, state);
      void this.loadPair(team, state);
    }
  }

  private async loadPair(team: number, state: PairCodes): Promise<void> {
    const users = this.config.users;
    let stored: Readonly<Record<string, string>> | null = null;
    let linked = false;
    let failed = false;
    if (users !== undefined) {
      try {
        [stored, linked] = await Promise.all([
          users.getPartnerCodes(state.a, state.b),
          users.havePlayedTogether(state.a, state.b),
        ]);
      } catch (err) {
        // Sem ids nem texto no log: o combinado começa vazio e a mesa segue, mas sem gravar.
        failed = true;
        log.warn('truco: combinado não carregado', {
          room: this.roomId,
          name: err instanceof Error ? err.name : 'unknown',
        });
      }
    }
    if (this.closing || this.pairs.get(team) !== state) return;
    for (const [id, meaning] of Object.entries(stored ?? {})) {
      if (!(SIGNAL_IDS as readonly string[]).includes(id) || typeof meaning !== 'string') continue;
      // Legado recusado pela limpeza do chat (bidi, ZWJ, controle, acima do limite): descartado.
      const cleaned = cleanPartnerCode(meaning);
      if (cleaned === null || cleaned === '') continue;
      if (state.touched.has(id as SignalId)) continue;
      state.codes[id as SignalId] = cleaned;
    }
    state.linked = linked;
    state.loadFailed = failed;
    state.loaded = true;
    this.sendCodes(team, -1);
    if (failed && state.touched.size > 0) this.notifyNotSaved(state);
    else if (linked && state.touched.size > 0) this.persistPair(state);
  }

  /** Destino SÓ pelo time do servidor: sockets vivos dos 2 assentos; bot e assento caído não recebem. */
  private codesRecipients(team: number): Client[] {
    const out: Client[] = [];
    for (const c of this.clients) {
      const to = this.seatBySession.get(c.sessionId);
      if (to === undefined || teamOf(to) !== team) continue;
      if (this.botSeats.has(to) || this.droppedSeats.has(to)) continue;
      out.push(c);
    }
    return out;
  }

  private codesPayload(
    codes: Partial<Record<SignalId, string>>,
    by: Seat | -1,
  ): Omit<Extract<ServerMessage, { type: 'codes' }>, 'type'> {
    return { codes: { ...codes }, by, at: Date.now() };
  }

  private sendCodes(team: number, by: Seat | -1): void {
    const state = this.pairs.get(team);
    if (state === undefined) return;
    const payload = this.codesPayload(state.codes, by);
    for (const c of this.codesRecipients(team)) c.send('codes', payload);
  }

  private sendEmptyCodes(team: number): void {
    const payload = this.codesPayload({}, -1);
    for (const c of this.codesRecipients(team)) c.send('codes', payload);
  }

  /** Reenvio na retomada/reconexão: só ao próprio assento e só com o combinado já carregado. */
  private sendCodesTo(client: Client, seat: Seat): void {
    const state = this.pairs.get(teamOf(seat));
    if (state === undefined || !state.loaded) return;
    client.send('codes', this.codesPayload(state.codes, -1));
  }

  /** `setCode`: o assento é o do servidor; o time (e portanto o destino) deriva dele, nunca da mensagem. */
  private setCode(
    client: Client,
    seat: Seat,
    msg: Extract<ClientMessage, { type: 'setCode' }>,
  ): void {
    if (
      this.closing ||
      this.expelledSeats.has(seat) ||
      this.botSeats.has(seat) ||
      this.droppedSeats.has(seat)
    ) {
      return;
    }
    const team = teamOf(seat);
    const state = this.pairs.get(team);
    // Sem parceiro humano sentado não há com quem combinar: ignorado em silêncio, sem gastar cooldown.
    if (state === undefined) return;
    if (
      !this.cooldownPassed(this.lastCodeAt, seat, this.config.codesCooldownMs ?? CODES_COOLDOWN_MS)
    ) {
      this.reject(client, 'RATE_LIMITED');
      return;
    }
    if (msg.meaning === '') delete state.codes[msg.signalId];
    else state.codes[msg.signalId] = msg.meaning;
    state.touched.add(msg.signalId);
    // Só metadados: o texto do combinado nunca vai a log.
    log.debug('truco: combinado', {
      room: this.roomId,
      seat,
      signalId: msg.signalId,
      length: [...msg.meaning].length,
    });
    this.sendCodes(team, seat);
    state.lastEditor = seat;
    if (this.config.users === undefined) return;
    if (state.loadFailed) this.notifyNotSaved(state);
    else if (state.linked) this.persistPair(state);
  }

  /** Avisa o último assento que editou: o combinado vale só nesta mesa (sem detalhe do banco). */
  private notifyNotSaved(state: PairCodes): void {
    const seat = state.lastEditor;
    if (seat === null || this.botSeats.has(seat) || this.droppedSeats.has(seat)) return;
    for (const c of this.clients) {
      if (this.seatBySession.get(c.sessionId) === seat) this.reject(c, 'CODE_NOT_SAVED');
    }
  }

  /**
   * Grava em segundo plano (falha só loga, sem ids nem texto). No máximo UMA gravação em voo por par:
   * edições durante a gravação só marcam `dirty` e a rodada seguinte grava o estado mais recente.
   */
  private persistPair(state: PairCodes): void {
    if (this.config.users === undefined || state.loadFailed) return;
    state.dirty = true;
    if (state.flushing !== null) return;
    state.flushing = this.flushPair(state);
    this.track(state.flushing.then(() => true));
  }

  private async flushPair(state: PairCodes): Promise<void> {
    const users = this.config.users;
    if (users === undefined) return;
    try {
      while (state.dirty) {
        state.dirty = false;
        try {
          // Só as chaves editadas nesta mesa: lê o mapa atual do banco e aplica por cima, para não
          // desfazer um PUT feito por REST durante a partida.
          const merged: Record<string, string> = {};
          // Legado sujo no banco (recusado pela limpeza) é descartado: senão a gravação inteira falharia.
          for (const [id, v] of Object.entries(
            (await users.getPartnerCodes(state.a, state.b)) ?? {},
          )) {
            const cleaned = cleanPartnerCode(v);
            if (cleaned !== null && cleaned !== '') merged[id] = cleaned;
          }
          for (const id of state.touched) {
            const value = state.codes[id];
            if (value === undefined) delete merged[id];
            else merged[id] = value;
          }
          await users.savePartnerCodes(state.a, state.b, merged);
        } catch (err) {
          log.warn('truco: combinado não gravado', {
            room: this.roomId,
            name: err instanceof Error ? err.name : 'unknown',
          });
          this.notifyNotSaved(state);
        }
      }
    } finally {
      state.flushing = null;
    }
  }

  /** Depois da 1ª partida finalizada gravada: grava o combinado dos pares ainda não vinculados. */
  private async persistNewPairs(): Promise<void> {
    for (const [team, state] of this.pairs) {
      if (state.linked || !state.loaded || state.loadFailed) continue;
      const [s1, s2] = this.teamSeats(team);
      const a = s1 === undefined ? undefined : this.userBySeat.get(s1);
      const b = s2 === undefined ? undefined : this.userBySeat.get(s2);
      if (a === undefined || b === undefined || a === b) continue;
      if (this.deletedUsers.has(a) || this.deletedUsers.has(b)) continue;
      // A partida finalizada vincula o par no banco: edições seguintes gravam na hora.
      state.linked = true;
      if (Object.keys(state.codes).length === 0) continue;
      this.persistPair(state);
      await state.flushing;
    }
  }

  // ---------------------------------------------------------------- timer e projeção

  /** Projeta o schema e (re)arma o timer do turno (e o do bot), ou encerra a sala se a série acabou. */
  private sync(): void {
    const series = this.series;
    if (series === null) return;
    this.turnTimer?.clear();
    this.turnTimer = null;
    this.botTimer?.clear();
    this.botTimer = null;
    const seat = isSeriesOver(series) ? null : pendingSeat(series);
    if (seat === null) {
      this.currentTurn = null;
      projectState(series, this.state);
      if (isSeriesOver(series)) {
        this.persistMatch(series);
        if (series.winner !== null && !series.cancelled) this.openRematchWindow();
        else this.scheduleClose();
      } else log.error('truco: série em andamento sem assento pendente', { room: this.roomId });
      return;
    }
    const timeoutMs = this.config.turnTimeoutMs ?? TURN_TIMEOUT_MS;
    const deadlineAt = Date.now() + timeoutMs;
    this.turnTimer = this.clock.setTimeout(() => this.onTurnTimeout(seat), timeoutMs);
    this.rearmBot(series);
    projectState(series, this.state, { turnDeadlineAt: deadlineAt });
    this.currentTurn = { seat, deadlineAt };
    const msg: Omit<Extract<ServerMessage, { type: 'turnTimer' }>, 'type'> = { seat, deadlineAt };
    this.broadcast('turnTimer', msg);
  }

  /** Arma o bot do primeiro decisor-bot pendente (na decisão de onze/dez podem ser dois). */
  private rearmBot(series: SeriesState): void {
    const botSeat = pendingSeats(series).find((s) => this.botSeats.has(s));
    if (botSeat !== undefined) this.armBot(botSeat, series);
  }

  /** Bot de ausência: age logo (com um pequeno "pensar"); o `turnTimer` é só a rede de segurança. */
  private armBot(seat: Seat, scheduled: SeriesState): void {
    if (!this.botSeats.has(seat)) return;
    this.botTimer?.clear();
    this.botTimer = this.clock.setTimeout(
      () => this.onBotTurn(seat, scheduled),
      this.thinkMs(seat),
    );
  }

  /** Atraso de pensar: teste/servidor fixa por `botThinkMs`; senão vaga sorteia 900 a 1800 ms, ausência 600. */
  private thinkMs(seat: Seat): number {
    if (this.config.botThinkMs !== undefined) return this.config.botThinkMs;
    if (!this.vacancyBotSeats.has(seat)) return DEFAULT_BOT_THINK_MS;
    const span = VACANCY_BOT_THINK_MAX_MS - VACANCY_BOT_THINK_MIN_MS;
    return VACANCY_BOT_THINK_MIN_MS + Math.floor(Math.random() * (span + 1));
  }

  /** Perfil do motor: bot de vaga decide aposta pela mão; ausência e jogada por prazo sempre correm. */
  private profileOf(seat: Seat): BotProfile {
    return this.vacancyBotSeats.has(seat) ? 'vacancy' : 'absence';
  }

  /**
   * Vez do bot de ausência. Só age se AINDA é o mesmo estado agendado, o assento ainda é bot e é a
   * vez dele; usa `botAction` (nunca pede nem aumenta aposta) e a mesma porta das ações humanas.
   */
  private onBotTurn(seat: Seat, scheduled: SeriesState): void {
    this.botTimer = null;
    const series = this.series;
    if (this.closing || series === null || series !== scheduled || isSeriesOver(series)) return;
    if (!this.botSeats.has(seat) || !pendingSeats(series).includes(seat)) return;
    const action = botAction(series, seat, this.rng, this.profileOf(seat));
    if (action === null) {
      log.error('truco: bot sem ação', { room: this.roomId, seat });
      return;
    }
    const code = this.applyAndPublish(action);
    if (code !== null) log.error('truco: jogada do bot recusada', { seat, code });
  }

  /** Prazo estourado: o motor joga POR ele (`botAction`: nunca pede nem aumenta aposta). */
  private onTurnTimeout(seat: Seat): void {
    this.turnTimer = null;
    const series = this.series;
    if (series === null || isSeriesOver(series) || pendingSeat(series) !== seat) return;
    // Onze/dez: o prazo vale para os dois decisores; quem ainda não decidiu é jogado pelo motor (jogar).
    // Aposta pendente: só o respondedor (`pendingSeat`) tem ação. Vez normal: um só.
    const seats = series.match.hand.phase === 'specialDecision' ? pendingSeats(series) : [seat];
    for (const s of seats) this.autoPlay(s);
  }

  /** Jogada automática por prazo estourado para `seat` (re-lê o estado: a anterior pode ter mudado). */
  private autoPlay(seat: Seat): void {
    const series = this.series;
    if (series === null || isSeriesOver(series)) return;
    const action = botAction(series, seat, this.rng, this.profileOf(seat));
    if (action === null) {
      log.error('truco: bot sem ação no timeout', { room: this.roomId, seat });
      return;
    }
    const isBot = this.botSeats.has(seat);
    const consecutive = isBot ? 0 : (this.timeouts.get(seat) ?? 0) + 1;
    if (!isBot) this.timeouts.set(seat, consecutive);
    log.info('truco: turno expirou, jogada automática', {
      room: this.roomId,
      seat,
      consecutive,
      action: action.type,
    });
    const code = this.applyAndPublish(action);
    if (code !== null) log.error('truco: jogada automática recusada', { seat, code });
    else if (!isBot) this.refreshPresence(seat);
  }

  private scheduleClose(delayMs?: number): void {
    if (this.closeTimer !== null) return;
    const delay = delayMs ?? this.config.finishDelayMs ?? DEFAULT_FINISH_DELAY_MS;
    this.closeTimer = this.clock.setTimeout(() => {
      this.disconnect().catch((err: unknown) =>
        log.error('truco: disconnect falhou', { err: String(err) }),
      );
    }, delay);
  }
}

/**
 * Registra a sala `truco` no servidor com parâmetros do SERVIDOR (semente, prazos, placar de teste).
 * `name` só é trocado em testes, para registrar variações de `config` no mesmo `Server`.
 */
export function defineTrucoRoom(
  server: Server,
  config: TrucoRoomConfig = {},
  name: string = TRUCO_ROOM_NAME,
) {
  class ConfiguredTrucoRoom extends TrucoRoom {
    constructor() {
      super(config);
    }
  }
  return server.define(name, ConfiguredTrucoRoom);
}
