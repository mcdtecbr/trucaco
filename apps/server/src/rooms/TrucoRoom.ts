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
 * Fora deste bloco (ver README): sinais/sfx/chat (2F), auth real (2G), lobby e persistência (2H).
 */
import { randomInt } from 'node:crypto';
import { CloseCode, Room, ServerError } from '@colyseus/core';
import type { Client, Server } from '@colyseus/core';
import {
  ACTION_MIN_INTERVAL_MS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  RECONNECT_SECONDS,
  TURN_TIMEOUT_MS,
  parseClientMessage,
  validateRoomOptions,
} from '@trucaco/protocol';
import type {
  ClientMessage,
  ErrorCode,
  PresenceStatus,
  RoomOptions,
  ServerMessage,
} from '@trucaco/protocol';
import {
  applySeriesAction,
  botAction,
  cancelSeries,
  isSeriesOver,
  legalActions,
  mulberry32,
  pendingSeat,
  publicEvent,
  startHand,
  startSeries,
  variantById,
} from '@trucaco/rules';
import type {
  GameEvent,
  HandAction,
  PublicGameEvent,
  Rng,
  Seat,
  SeriesState,
} from '@trucaco/rules';
import { projectState } from '../game/projection';
import {
  TABLE_SEATS,
  createSeatView,
  createTableState,
  setCancelVotes,
  setPlayer,
} from '../game/schema';
import type { TableState } from '../game/schema';
import { log } from '../logger';

export const TRUCO_ROOM_NAME = 'truco';

type Timer = ReturnType<Room['clock']['setTimeout']>;

/** Código de política do WebSocket (RFC 6455, 1008) usado ao expulsar quem insiste em payload inválido. */
export const POLICY_CLOSE_CODE = 1008;
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
/** Reconexões (e retomadas por novo join) por assento na partida; acima disso o bot fica com a cadeira. */
export const DEFAULT_MAX_RECONNECTS = 20;
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
}

/** Dados de identidade do jogador (vêm do `onAuth`; futuramente do JWT, bloco 2G). */
export interface JoinAuth {
  readonly userId: string;
  readonly nickname: string;
}

export interface LoggedEvent {
  readonly seq: number;
  readonly at: number;
  /** Visão pública: carta coberta sem identidade. */
  readonly event: PublicGameEvent;
}

const NICKNAME_MAX = 24;
const USER_ID_MAX = 64;
const CONTROL = /[\p{C}]/u;

/**
 * TODO(2G): AUTENTICAÇÃO TEMPORÁRIA. Aceita `{userId, nickname}` das opções de join SEM prova de
 * identidade, e por isso só funciona fora de produção. Falha FECHADO: só `development` e `test`
 * EXPLÍCITOS passam; `production`, qualquer outro valor e `NODE_ENV` AUSENTE rejeitam tudo (um deploy
 * que esqueça a variável não pode abrir a mesa). O bloco 2G troca isto por
 * validação de JWT (`userId` do token, nunca do payload).
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

/**
 * TODO(2G): AUTENTICAÇÃO TEMPORÁRIA DA RECONEXÃO. O core 0.18 NÃO roda `onAuth` ao reconectar: a
 * única credencial é o token de reconexão (aleatório, por sessão, rotativo). Para o `userId` do novo
 * socket valer o do assento, o servidor exige uma identidade no upgrade do WebSocket
 * (`reconnectUpgradeGuard`, `beforeUpgrade` do transporte), que chega em `context.token`
 * (`_authToken` na URL ou `Authorization: Bearer`). Em dev/test o token é `dev:<userId>`; em qualquer
 * outro `NODE_ENV` (inclusive ausente) nada é aceito. O 2G troca por verificação de JWT.
 */
export function devReconnectUserId(
  token: string | null | undefined,
  nodeEnv: string | undefined,
): string | undefined {
  if (nodeEnv !== 'development' && nodeEnv !== 'test') return undefined;
  if (typeof token !== 'string' || !token.startsWith('dev:')) return undefined;
  const userId = token.slice(4);
  return userId.length > 0 && userId.length <= USER_ID_MAX ? userId : undefined;
}

function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET.charAt(randomInt(0, ROOM_CODE_ALPHABET.length));
  }
  return code;
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
  private readonly invalidAt = new Map<Seat, number[]>();
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
  /** Assentos com socket caído e janela de reconexão aberta (`allowReconnection`). */
  private readonly droppedSeats = new Set<Seat>();
  /** Último `seq` de evento enviado ao socket do assento (base do replay na reconexão). */
  private readonly lastSeq = new Map<Seat, number>();
  /** Reconexões e retomadas por assento (teto `maxReconnects`). */
  private readonly reconnectCount = new Map<Seat, number>();
  private readonly seatPresence = new Map<Seat, PresenceStatus>();
  private currentTurn: { seat: Seat; deadlineAt: number } | null = null;
  private botTimer: Timer | null = null;
  private abandonTimer: Timer | null = null;
  private closing = false;

  constructor(private readonly config: TrucoRoomConfig = {}) {
    super();
  }

  override onCreate(options: unknown): void {
    const valid = validateRoomOptions(options);
    if (!valid.ok) {
      log.warn('truco: opções de sala inválidas', { error: valid.error });
      throw new ServerError(400, valid.error);
    }
    this.options = valid.options;
    this.maxMessagesPerSecond = this.config.maxMessagesPerSecond ?? MAX_MESSAGES_PER_SECOND;
    this.seed = this.config.rngSeed ?? randomInt(0, 2 ** 32);
    this.rng = mulberry32(this.seed);
    this.setState(createTableState(generateRoomCode(), valid.options));
    if (this.config.patchRateMs !== undefined) this.setPatchRate(this.config.patchRateMs);
    // Única rota de entrada de mensagens do cliente.
    this.onMessage('*', (client, type, message) => this.handleMessage(client, type, message));
  }

  /**
   * TODO(2G): trocar por validação de JWT (o `userId` virá do token, nunca do payload). Ver `devAuth`.
   *
   * Autenticação ESTÁTICA, não de instância: no `@colyseus/core` 0.18 o `onAuth` de instância só roda
   * DEPOIS de `onCreate`, então `create`/`joinOrCreate` criariam a sala sem credencial. O `static
   * onAuth(token, options, context)` roda no matchmaker ANTES de criar a sala ou reservar assento
   * (`create`, `join`, `joinById`, `joinOrCreate`). O que ele devolve vira `client.auth` e chega ao
   * `onJoin(client, options, auth)`. Lançar `ServerError` aborta a requisição sem criar sala.
   */
  static override async onAuth(_token: string, options: unknown): Promise<JoinAuth> {
    return devAuth(options, process.env.NODE_ENV);
  }

  override onJoin(client: Client, _options: unknown, auth: JoinAuth | undefined): void {
    // Sem dado do `onAuth` estático (reserva criada por fora do matchmaker HTTP): recusa.
    if (auth === undefined || typeof auth.userId !== 'string') {
      throw new ServerError(401, 'UNAUTHORIZED');
    }
    // Quem já tem assento só volta ao PRÓPRIO assento, e só se o bot o ocupa (saída definitiva).
    for (const [owned, userId] of this.userBySeat) {
      if (userId === auth.userId) {
        this.reclaimSeat(client, owned);
        return;
      }
    }
    if (this.series !== null) throw new ServerError(409, 'ROOM_FULL');
    const seat = this.firstFreeSeat();
    if (seat === null) throw new ServerError(409, 'ROOM_FULL');
    this.seatBySession.set(client.sessionId, seat);
    this.userBySeat.set(seat, auth.userId);
    this.lastSeq.set(seat, this.seq);
    this.seatPresence.set(seat, 'online');
    setPlayer(this.state, seat, {
      nickname: auth.nickname,
      avatar: '{}',
      status: 'connected',
      isBot: false,
    });
    // O core NÃO cria `client.view`: sem isto o cliente receberia o estado sem o bloco privado.
    client.view = createSeatView(this.state, seat);
    log.info('truco: jogador sentou', { room: this.roomId, seat });
    if (this.userBySeat.size === TABLE_SEATS) {
      this.lock().catch((err: unknown) => log.error('truco: lock falhou', { err: String(err) }));
      // Adiado para o próximo tick do relógio: o 4º cliente já terminou de entrar e recebe os
      // primeiros eventos da partida (mensagens enviadas durante o `onJoin` chegam antes de o
      // cliente registrar os handlers). Cancelável: se alguém sai antes do tick, a sala destranca.
      this.startTimer = this.clock.setTimeout(() => this.startGame(), 0);
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
      log.error('truco: reconexão com assento inconsistente', { room: this.roomId });
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
      this.userBySeat.delete(seat);
      // Nada do ocupante anterior pode ser herdado pelo próximo (strikes, rate limit, contadores).
      this.invalidAt.delete(seat);
      this.lastActionAt.delete(seat);
      this.warnState.delete(seat);
      this.timeouts.delete(seat);
      this.lastSeq.delete(seat);
      this.seatPresence.delete(seat);
      this.reconnectCount.delete(seat);
      setPlayer(this.state, seat, { nickname: '', avatar: '', status: 'empty' });
      if (this.startTimer !== null) {
        this.startTimer.clear();
        this.startTimer = null;
      }
      if (this.locked) {
        this.unlock().catch((err: unknown) =>
          log.error('truco: unlock falhou', { err: String(err) }),
        );
      }
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

  override onDispose(): void {
    this.closing = true;
    this.startTimer?.clear();
    this.turnTimer?.clear();
    this.closeTimer?.clear();
    this.botTimer?.clear();
    this.abandonTimer?.clear();
  }

  /**
   * Verificação da identidade de uma RECONEXÃO, chamada pelo `reconnectUpgradeGuard` antes do upgrade
   * do WebSocket: a sessão tem de ter assento e o `userId` apresentado tem de ser o do assento.
   * (O token de reconexão em si é validado pelo core, por sessão.)
   */
  authorizeReconnect(sessionId: string, userId: string | undefined): boolean {
    const seat = this.seatBySession.get(sessionId);
    if (seat === undefined || userId === undefined) return false;
    return this.userBySeat.get(seat) === userId;
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
    this.checkVotes();
    this.checkAbandon();
  }

  private becomeBot(seat: Seat): void {
    this.botSeats.add(seat);
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
    if (now !== null && !isSeriesOver(now) && pendingSeat(now) === seat) this.sync();
  }

  /** Dono do assento que o bot ocupa voltando por um novo join (mesmo `userId`). */
  private reclaimSeat(client: Client, seat: Seat): void {
    if (this.series === null || !this.botSeats.has(seat)) {
      throw new ServerError(409, 'ALREADY_SEATED');
    }
    if ((this.reconnectCount.get(seat) ?? 0) >= this.maxReconnects()) {
      throw new ServerError(409, 'ROOM_FULL');
    }
    this.seatBySession.set(client.sessionId, seat);
    log.info('truco: dono retomou o assento do bot', { room: this.roomId, seat });
    this.resume(client, seat);
  }

  /**
   * Devolve o assento ao humano (reconexão ou novo join): vista própria nova, presença, replay dos
   * eventos perdidos, relógio do turno. Cancela o bot do turno (nunca duas ações no mesmo turno).
   */
  private resume(client: Client, seat: Seat): void {
    this.reconnectCount.set(seat, (this.reconnectCount.get(seat) ?? 0) + 1);
    this.botSeats.delete(seat);
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
    const series = this.series;
    if (series !== null && !isSeriesOver(series) && pendingSeat(series) === seat) {
      // Cancela o bot agendado e dá ao jogador o relógio do turno.
      this.sync();
    } else if (this.currentTurn !== null) {
      client.send('turnTimer', this.currentTurn);
    }
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

  private firstFreeSeat(): Seat | null {
    for (let s = 0; s < TABLE_SEATS; s++) if (!this.userBySeat.has(s)) return s;
    return null;
  }

  private startGame(): void {
    this.startTimer = null;
    const options = this.options;
    if (options === null || this.series !== null || this.userBySeat.size !== TABLE_SEATS) return;
    const variant = variantById(options.variant);
    const ironHand = options.ironHand;
    const started = startSeries({
      variant,
      config: { format: options.format, ironHand },
      pe: 0,
      rng: this.rng,
    });
    let series = started.state;
    let events: readonly GameEvent[] = started.events;
    const scores = this.config.initialScores;
    if (scores !== undefined && (scores[0] !== 0 || scores[1] !== 0)) {
      // Só teste/servidor: refaz a 1ª mão já com o placar forçado (onze, dez, ferro).
      const hand = startHand({ variant, pe: 0, scores, ironHand, rng: this.rng });
      series = { ...series, match: { ...series.match, scores, hand } };
      events = events.map((e) =>
        e.type === 'handStarted' ? { ...e, scores, special: hand.special } : e,
      );
    }
    this.series = series;
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
      this.reject(client, parsed.code);
      this.countInvalid(client, seat, parsed.code);
      return;
    }
    const msg = parsed.message;
    switch (msg.type) {
      case 'signal':
      case 'sfx':
      case 'chat':
        // Decisão: IGNORADAS até o bloco 2F (sem resposta, sem efeito), só log debug.
        log.debug('truco: mensagem ignorada (2F)', { seat, type: msg.type });
        return;
      case 'ready':
        // Decisão: a partida começa quando o 4º jogador entra; `ready` é aceito e ignorado.
        log.debug('truco: ready ignorado', { seat });
        return;
      default:
        break;
    }
    if (!this.allowAction(seat)) {
      this.reject(client, 'RATE_LIMITED');
      return;
    }
    if (msg.type === 'voteCancel') {
      const code = this.voteCancel(seat);
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

  // ---------------------------------------------------------------- eventos

  /** Um `event` por cliente (não `broadcast`): a carta coberta é vista só pelo dono. */
  private emitEvents(events: readonly GameEvent[]): void {
    for (const ev of events) {
      const seq = ++this.seq;
      const at = Date.now();
      this.eventLog.push({ seq, at, event: publicEvent(ev) });
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
      if (isSeriesOver(series)) this.scheduleClose();
      else log.error('truco: série em andamento sem assento pendente', { room: this.roomId });
      return;
    }
    const timeoutMs = this.config.turnTimeoutMs ?? TURN_TIMEOUT_MS;
    const deadlineAt = Date.now() + timeoutMs;
    this.turnTimer = this.clock.setTimeout(() => this.onTurnTimeout(seat), timeoutMs);
    if (this.botSeats.has(seat)) {
      // Bot de ausência: age logo (com um pequeno "pensar"); o timer acima é só a rede de segurança.
      const scheduled = series;
      const thinkMs = this.config.botThinkMs ?? DEFAULT_BOT_THINK_MS;
      this.botTimer = this.clock.setTimeout(() => this.onBotTurn(seat, scheduled), thinkMs);
    }
    projectState(series, this.state, { turnDeadlineAt: deadlineAt });
    this.currentTurn = { seat, deadlineAt };
    const msg: Omit<Extract<ServerMessage, { type: 'turnTimer' }>, 'type'> = { seat, deadlineAt };
    this.broadcast('turnTimer', msg);
  }

  /**
   * Vez do bot de ausência. Só age se AINDA é o mesmo estado agendado, o assento ainda é bot e é a
   * vez dele; usa `botAction` (nunca pede nem aumenta aposta) e a mesma porta das ações humanas.
   */
  private onBotTurn(seat: Seat, scheduled: SeriesState): void {
    this.botTimer = null;
    const series = this.series;
    if (this.closing || series === null || series !== scheduled || isSeriesOver(series)) return;
    if (!this.botSeats.has(seat) || pendingSeat(series) !== seat) return;
    const action = botAction(series, seat, this.rng);
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
    const action = botAction(series, seat, this.rng);
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

  private scheduleClose(): void {
    if (this.closeTimer !== null) return;
    const delay = this.config.finishDelayMs ?? DEFAULT_FINISH_DELAY_MS;
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
