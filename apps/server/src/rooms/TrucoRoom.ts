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
 * Fora deste bloco (ver README): reconexão e bot de ausência (2E), sinais/sfx/chat (2F), auth real
 * (2G), lobby e persistência (2H).
 */
import { randomInt } from 'node:crypto';
import { Room, ServerError } from '@colyseus/core';
import type { Client, Server } from '@colyseus/core';
import {
  ACTION_MIN_INTERVAL_MS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  TURN_TIMEOUT_MS,
  parseClientMessage,
  validateRoomOptions,
} from '@trucaco/protocol';
import type { ClientMessage, ErrorCode, RoomOptions, ServerMessage } from '@trucaco/protocol';
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
  /** Expirações de turno seguidas por assento (só registro; "ausente"/bot permanente são do 2E). */
  readonly timeouts = new Map<Seat, number>();
  private readonly cancelVotes = new Set<Seat>();
  private turnTimer: Timer | null = null;
  private closeTimer: Timer | null = null;

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
    for (const userId of this.userBySeat.values()) {
      if (userId === auth.userId) throw new ServerError(409, 'ALREADY_SEATED');
    }
    const seat = this.firstFreeSeat();
    if (seat === null) throw new ServerError(409, 'ROOM_FULL');
    this.seatBySession.set(client.sessionId, seat);
    this.userBySeat.set(seat, auth.userId);
    setPlayer(this.state, seat, {
      nickname: auth.nickname,
      avatar: '{}',
      status: 'connected',
      isBot: false,
    });
    // O core NÃO cria `client.view`: sem isto o cliente receberia o estado sem o bloco privado.
    client.view = createSeatView(this.state, seat);
    log.info('truco: jogador sentou', { room: this.roomId, seat });
    if (this.seatBySession.size === TABLE_SEATS) {
      this.lock().catch((err: unknown) => log.error('truco: lock falhou', { err: String(err) }));
      // Adiado para o próximo tick do relógio: o 4º cliente já terminou de entrar e recebe os
      // primeiros eventos da partida (mensagens enviadas durante o `onJoin` chegam antes de o
      // cliente registrar os handlers). Cancelável: se alguém sai antes do tick, a sala destranca.
      this.startTimer = this.clock.setTimeout(() => this.startGame(), 0);
    }
  }

  override onLeave(client: Client): void {
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
    } else {
      // TODO(2E): allowReconnection(60 s) e bot após expirar. Por ora só marca desconectado.
      setPlayer(this.state, seat, { status: 'disconnected' });
    }
  }

  override onDispose(): void {
    this.startTimer?.clear();
    this.turnTimer?.clear();
    this.closeTimer?.clear();
  }

  // ---------------------------------------------------------------- partida

  private firstFreeSeat(): Seat | null {
    const taken = new Set(this.seatBySession.values());
    for (let s = 0; s < TABLE_SEATS; s++) if (!taken.has(s)) return s;
    return null;
  }

  private startGame(): void {
    this.startTimer = null;
    const options = this.options;
    if (options === null || this.series !== null || this.seatBySession.size !== TABLE_SEATS) return;
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

  private voteCancel(seat: Seat): ErrorCode | null {
    const series = this.series;
    if (series === null) return 'NOT_YOUR_TURN';
    if (isSeriesOver(series)) return 'SERIES_FINISHED';
    this.cancelVotes.add(seat);
    setCancelVotes(
      this.state,
      [...this.cancelVotes].sort((a, b) => a - b),
    );
    if (this.cancelVotes.size < TABLE_SEATS) return null;
    const r = cancelSeries(series);
    if (!r.ok) return r.error.code;
    this.series = r.state;
    this.emitEvents(r.events);
    this.sync();
    return null;
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
      }
    }
  }

  // ---------------------------------------------------------------- timer e projeção

  /** Projeta o schema e (re)arma o timer do turno, ou encerra a sala se a série acabou. */
  private sync(): void {
    const series = this.series;
    if (series === null) return;
    this.turnTimer?.clear();
    this.turnTimer = null;
    const seat = isSeriesOver(series) ? null : pendingSeat(series);
    if (seat === null) {
      projectState(series, this.state);
      if (isSeriesOver(series)) this.scheduleClose();
      else log.error('truco: série em andamento sem assento pendente', { room: this.roomId });
      return;
    }
    const timeoutMs = this.config.turnTimeoutMs ?? TURN_TIMEOUT_MS;
    const deadlineAt = Date.now() + timeoutMs;
    this.turnTimer = this.clock.setTimeout(() => this.onTurnTimeout(seat), timeoutMs);
    projectState(series, this.state, { turnDeadlineAt: deadlineAt });
    const msg: Omit<Extract<ServerMessage, { type: 'turnTimer' }>, 'type'> = { seat, deadlineAt };
    this.broadcast('turnTimer', msg);
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
    const consecutive = (this.timeouts.get(seat) ?? 0) + 1;
    this.timeouts.set(seat, consecutive);
    log.info('truco: turno expirou, jogada automática', {
      room: this.roomId,
      seat,
      consecutive,
      action: action.type,
    });
    const code = this.applyAndPublish(action);
    if (code !== null) log.error('truco: jogada automática recusada', { seat, code });
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
