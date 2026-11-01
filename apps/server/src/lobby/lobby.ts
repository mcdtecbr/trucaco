/**
 * Lobby (bloco 2H): mesas privadas por código, fila pública FIFO e o vínculo "um `userId`, uma mesa".
 *
 * Por que REST + `matchMaker` e não `LobbyRoom` do core: a `LobbyRoom` publica a LISTA de salas para quem
 * entra nela (aqui haveria mesas privadas e dados de jogadores no meio), exigiria uma sala por cliente
 * só para escutar e não tem fila nem tickets. O desenho aqui é um estado em memória (esta classe) com
 * rotas autenticadas (`http/lobbyRoutes.ts`) que devolvem uma RESERVA DE ASSENTO; o cliente a consome com
 * `client.consumeSeatReservation(reservation)` do SDK. Nenhuma lista de mesas é exposta.
 *
 * Estado em memória do processo (um servidor por processo). Multi-instância exigiria mover diretório,
 * fila e limites para Redis (`trucaco:v1:rl:*` e filas do `docs/banco-de-dados.md`).
 *
 * Máquina de estados por `userId` (um slot): `queued` -> `ticket` (mesa formada, assento não ocupado) ->
 * `table` (sentado). Mesa privada: o criador nasce como `ticket` da própria mesa. Quem tem slot não
 * enfileira, não cria nem entra em outra mesa.
 */
import { randomBytes } from 'node:crypto';
import { isValidRoomCode } from '@trucaco/protocol';
import type { RoomOptions, Visibility } from '@trucaco/protocol';
import { log } from '../logger';
import { DEFAULT_JOIN_GUARD, JoinGuard } from './joinGuard';
import type { JoinGuardConfig } from './joinGuard';
import { MatchQueue } from './matchQueue';
import type { QueueEntry } from './matchQueue';
import { generateUniqueRoomCode } from './roomCode';
import type { RandomIntFn } from './roomCode';

/** Chave (só do servidor) pela qual a sala recebe a concessão criada pelo lobby; o cliente não a conhece. */
export const GRANT_KEY = '__lobbyGrant';

export interface LobbyConfig {
  /** Validade de uma entrada na fila. */
  readonly queueTtlMs: number;
  /** Tempo para os 4 da fila ocuparem seus assentos depois da mesa formada. */
  readonly fillMs: number;
  /** Tempo para o criador da mesa privada ocupar o primeiro assento. */
  readonly creatorMs: number;
  /** Tempo máximo de uma mesa em espera (sem partida iniciada). */
  readonly tableWaitMs: number;
  readonly maxQueue: number;
  /** Operações de lobby (criar, fila, consulta) por usuário e por IP/min. */
  readonly actionsPerUserPerMin: number;
  readonly actionsPerIpPerMin: number;
  /** Mesas privadas criadas por usuário/min. */
  readonly createPerUserPerMin: number;
  /** Depois deste tempo sem sentar, `GET /queue` emite uma reserva nova (a anterior já expirou). */
  readonly reservationReuseMs: number;
  readonly guard: JoinGuardConfig;
}

export const DEFAULT_LOBBY_CONFIG: LobbyConfig = {
  queueTtlMs: 120_000,
  fillMs: 45_000,
  creatorMs: 30_000,
  tableWaitMs: 30 * 60_000,
  maxQueue: 5000,
  actionsPerUserPerMin: 60,
  actionsPerIpPerMin: 180,
  createPerUserPerMin: 6,
  // Maior que a reserva do core (15 s): nunca duas reservas vivas do mesmo usuário.
  reservationReuseMs: 16_000,
  guard: DEFAULT_JOIN_GUARD,
};

/** Concessão de criação: o que a sala recém-criada pode fazer. Criada só pelo lobby. */
export interface Grant {
  readonly kind: 'private' | 'queue';
  readonly code: string;
  /** Mesa privada: o primeiro a sentar. */
  readonly creator: string | null;
  /** Mesa da fila: únicos usuários admitidos. */
  readonly allowed: ReadonlySet<string> | null;
  readonly creatorMs: number;
  readonly fillMs: number;
  readonly waitMs: number;
}

export interface SeatReservation {
  readonly name: string;
  readonly sessionId: string;
  readonly roomId: string;
}

/** Costura com o Colyseus (trocada por um falso nos testes unitários). */
export interface TableGateway {
  /** Cria a sala `truco` e devolve o `roomId`. A sala consome a concessão `grantToken` em `onCreate`. */
  createRoom(options: RoomOptions, grantToken: string): Promise<string>;
  /** Reserva assento (roda o `onAuth` com o JWT). Lança `GatewayAuthError` para 401/503. */
  reserve(roomId: string, joinOptions: { code?: string }, bearer: string): Promise<SeatReservation>;
}

export class GatewayAuthError extends Error {
  constructor(readonly status: 401 | 503) {
    super(status === 401 ? 'UNAUTHORIZED' : 'SERVICE_UNAVAILABLE');
    this.name = 'GatewayAuthError';
  }
}

type Slot =
  | { kind: 'queued'; entry: QueueEntry }
  | {
      kind: 'ticket';
      roomId: string | null;
      expiresAt: number;
      entry: QueueEntry | null;
      reservation?: SeatReservation;
      claimedAt?: number;
      claiming?: Promise<SeatReservation>;
    }
  | { kind: 'table'; roomId: string; entry: QueueEntry | null };

interface RoomInfo {
  readonly code: string;
  readonly visibility: Visibility;
  readonly grant: Grant | null;
  creatorSeated: boolean;
}

export type LobbyError =
  | 'ALREADY_IN_TABLE'
  | 'INVALID_OPTIONS'
  | 'INVALID_CODE'
  | 'TABLE_UNAVAILABLE'
  | 'QUEUE_FULL'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE';

export type Fail = {
  readonly ok: false;
  readonly error: LobbyError;
  readonly retryAfterSec?: number;
};

export type QueueStatus =
  | { readonly status: 'idle' }
  | { readonly status: 'queued'; readonly expiresAt: number }
  | { readonly status: 'matched'; readonly reservation: SeatReservation }
  | { readonly status: 'seated' };

export class Lobby {
  private readonly queue: MatchQueue;
  private readonly slots = new Map<string, Slot>();
  private readonly rooms = new Map<string, RoomInfo>();
  /** código -> roomId; `null` = código reservado e ainda sem sala. */
  private readonly codes = new Map<string, string | null>();
  private readonly grants = new Map<string, Grant>();
  private readonly guard: JoinGuard;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly gateway: TableGateway,
    readonly config: LobbyConfig = DEFAULT_LOBBY_CONFIG,
    private readonly clock: () => number = Date.now,
    private readonly rand?: RandomIntFn,
  ) {
    this.queue = new MatchQueue(config.maxQueue);
    this.guard = new JoinGuard(config.guard);
  }

  /** Varredura periódica (expira fila e tickets). O timer não segura o processo. */
  start(everyMs = 1000): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.sweep(), everyMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  // ------------------------------------------------------------------ lado da sala (síncrono)

  /** Código único, já reservado no diretório. */
  newCode(): string {
    const code = generateUniqueRoomCode((c) => this.codes.has(c), this.rand);
    this.codes.set(code, null);
    return code;
  }

  /** A sala recém-criada pega a concessão (uso único). `undefined` se o token não existe. */
  consumeGrant(token: string): Grant | undefined {
    const grant = this.grants.get(token);
    this.grants.delete(token);
    return grant;
  }

  registerRoom(roomId: string, code: string, visibility: Visibility, grant: Grant | null): void {
    this.codes.set(code, roomId);
    this.rooms.set(roomId, { code, visibility, grant, creatorSeated: false });
  }

  /**
   * Admissão ANTES de reservar assento (chamada pelo `_reserveSeat` da sala). Vale o vínculo global
   * (um slot por usuário) e a regra da mesa: fila = só os 4 sorteados; privada = criador primeiro, depois
   * quem apresenta o código. Quem já está sentado nesta mesa (retomada do próprio assento) passa.
   */
  admit(userId: string, roomId: string, joinOptions: unknown): boolean {
    const slot = this.slots.get(userId);
    if (slot !== undefined) {
      if (slot.kind === 'queued') return false;
      if (slot.roomId !== roomId) return false;
    }
    const info = this.rooms.get(roomId);
    if (info?.grant === null || info === undefined) return true;
    const grant = info.grant;
    if (grant.kind === 'queue') return grant.allowed?.has(userId) === true;
    if (userId === grant.creator) return true;
    if (slot?.kind === 'table') return true;
    const code = (joinOptions as { code?: unknown } | null | undefined)?.code;
    return info.creatorSeated && typeof code === 'string' && code === info.code;
  }

  /** O usuário sentou (`onJoin`). `false` se o vínculo é de outra mesa ou da fila. */
  seat(userId: string, roomId: string): boolean {
    const slot = this.slots.get(userId);
    if (slot !== undefined) {
      if (slot.kind === 'queued') return false;
      if (slot.roomId !== roomId) return false;
    }
    this.slots.set(userId, {
      kind: 'table',
      roomId,
      entry: slot === undefined ? null : slot.entry,
    });
    const info = this.rooms.get(roomId);
    if (info?.grant?.creator === userId) info.creatorSeated = true;
    return true;
  }

  /** O usuário deixou a mesa de vez (saiu na espera ou o bot assumiu). Libera o vínculo. */
  unseat(userId: string, roomId: string): void {
    const slot = this.slots.get(userId);
    if (slot?.kind === 'table' && slot.roomId === roomId) this.slots.delete(userId);
  }

  /** A sala foi descartada: libera código, vínculos e tickets dela. */
  releaseRoom(roomId: string): void {
    const info = this.rooms.get(roomId);
    if (info !== undefined) {
      this.codes.delete(info.code);
      this.rooms.delete(roomId);
    }
    for (const [userId, slot] of this.slots) {
      if (slot.kind !== 'queued' && slot.roomId === roomId) this.slots.delete(userId);
    }
  }

  /**
   * A mesa da fila não encheu no prazo: quem já sentou volta à fila na POSIÇÃO ORIGINAL (sem perder a
   * vez), os ausentes são soltos. A sala se fecha em seguida (`releaseRoom` no `onDispose`).
   */
  failFill(roomId: string): void {
    const now = this.clock();
    const back: QueueEntry[] = [];
    for (const [userId, slot] of this.slots) {
      if (slot.kind === 'table' && slot.roomId === roomId && slot.entry !== null) {
        back.push(slot.entry);
        this.slots.delete(userId);
      }
    }
    this.releaseRoom(roomId);
    for (const entry of back) {
      if (this.queue.requeue(entry, now, this.config.queueTtlMs)) {
        this.slots.set(entry.userId, { kind: 'queued', entry });
      }
    }
    if (back.length > 0) void this.drain();
  }

  // ------------------------------------------------------------------ mesa privada

  async createTable(
    userId: string,
    bearer: string,
    options: RoomOptions,
  ): Promise<Fail | { ok: true; code: string; reservation: SeatReservation }> {
    this.sweep();
    if (this.slots.has(userId)) return { ok: false, error: 'ALREADY_IN_TABLE' };
    const now = this.clock();
    const slot: Slot = {
      kind: 'ticket',
      roomId: null,
      expiresAt: now + this.config.creatorMs + 5000,
      entry: null,
    };
    this.slots.set(userId, slot);
    let code: string;
    let token: string;
    try {
      code = this.newCode();
      token = randomBytes(16).toString('hex');
      this.grants.set(token, {
        kind: 'private',
        code,
        creator: userId,
        allowed: null,
        creatorMs: this.config.creatorMs,
        fillMs: this.config.fillMs,
        waitMs: this.config.tableWaitMs,
      });
    } catch {
      this.slots.delete(userId);
      return { ok: false, error: 'UNAVAILABLE' };
    }
    let roomId: string;
    try {
      roomId = await this.gateway.createRoom(options, token);
    } catch (err) {
      this.grants.delete(token);
      this.codes.delete(code);
      if (this.slots.get(userId) === slot) this.slots.delete(userId);
      log.warn('lobby: criação de mesa falhou', { name: errName(err) });
      return { ok: false, error: 'UNAVAILABLE' };
    }
    slot.roomId = roomId;
    try {
      const reservation = await this.gateway.reserve(roomId, {}, bearer);
      return { ok: true, code, reservation };
    } catch (err) {
      // A mesa sem criador se fecha sozinha (prazo do criador); o usuário fica livre já.
      if (this.slots.get(userId) === slot) this.slots.delete(userId);
      if (err instanceof GatewayAuthError) throw err;
      log.warn('lobby: reserva do criador falhou', { name: errName(err) });
      return { ok: false, error: 'UNAVAILABLE' };
    }
  }

  // ------------------------------------------------------------------ entrar por código

  /**
   * Erro IDÊNTICO (`TABLE_UNAVAILABLE`) para código inexistente, mesa cheia, em partida, de outro tipo
   * (fila) ou fechada: nenhum oráculo de existência. Só `INVALID_CODE` (formato errado, sem consulta) e
   * `ALREADY_IN_TABLE` (estado do próprio chamador) diferem.
   */
  async joinByCode(
    userId: string,
    bearer: string,
    ip: string,
    code: unknown,
  ): Promise<Fail | { ok: true; reservation: SeatReservation }> {
    this.sweep();
    const verdict = this.guard.check(userId, ip, this.clock());
    if (verdict !== 'ok') {
      return { ok: false, error: 'RATE_LIMITED', retryAfterSec: verdict === 'locked' ? 600 : 60 };
    }
    if (!isValidRoomCode(code)) {
      this.guard.fail(userId, ip, this.clock());
      return { ok: false, error: 'INVALID_CODE' };
    }
    const roomId = this.codes.get(code) ?? undefined;
    const info = roomId === undefined ? undefined : this.rooms.get(roomId);
    const slot = this.slots.get(userId);
    if (slot !== undefined && !(slot.kind === 'table' && slot.roomId === roomId)) {
      // Estado do próprio usuário (não revela nada sobre o código consultado).
      return { ok: false, error: 'ALREADY_IN_TABLE' };
    }
    if (roomId === undefined || info === undefined || info.grant?.kind !== 'private') {
      return this.unavailable(userId, ip);
    }
    try {
      const reservation = await this.gateway.reserve(roomId, { code }, bearer);
      return { ok: true, reservation };
    } catch (err) {
      if (err instanceof GatewayAuthError) throw err;
      return this.unavailable(userId, ip);
    }
  }

  private unavailable(userId: string, ip: string): Fail {
    this.guard.fail(userId, ip, this.clock());
    return { ok: false, error: 'TABLE_UNAVAILABLE' };
  }

  isLocked(userId: string): boolean {
    return this.guard.isLocked(userId, this.clock());
  }

  // ------------------------------------------------------------------ fila pública

  async enqueue(
    userId: string,
    bearer: string,
    options: RoomOptions,
  ): Promise<Fail | { ok: true; status: QueueStatus }> {
    this.sweep();
    const slot = this.slots.get(userId);
    if (slot !== undefined && slot.kind !== 'queued') {
      return slot.kind === 'ticket' && slot.entry !== null
        ? { ok: true, status: await this.statusOf(userId, bearer) }
        : { ok: false, error: 'ALREADY_IN_TABLE' };
    }
    if (slot === undefined) {
      const entry = this.queue.enqueue(userId, options, this.clock(), this.config.queueTtlMs);
      if (entry === null) return { ok: false, error: 'QUEUE_FULL' };
      this.slots.set(userId, { kind: 'queued', entry });
      await this.drain();
    }
    // Já na fila: idempotente (mantém variante e posição; nunca uma segunda entrada).
    return { ok: true, status: await this.statusOf(userId, bearer) };
  }

  async leaveQueue(userId: string): Promise<void> {
    const slot = this.slots.get(userId);
    if (slot === undefined) return;
    if (slot.kind === 'queued') {
      this.queue.remove(userId);
      this.slots.delete(userId);
    } else if (slot.kind === 'ticket') {
      // Mesa formada e ainda não sentou: desiste. A mesa se resolve no prazo (`failFill`).
      this.slots.delete(userId);
    }
  }

  async statusOf(userId: string, bearer: string): Promise<QueueStatus> {
    this.sweep();
    const slot = this.slots.get(userId);
    if (slot === undefined) return { status: 'idle' };
    if (slot.kind === 'queued') return { status: 'queued', expiresAt: slot.entry.expiresAt };
    if (slot.kind === 'table') return { status: 'seated' };
    // Criador de mesa privada não está na fila.
    if (slot.entry === null) return { status: 'idle' };
    if (slot.roomId === null) return { status: 'queued', expiresAt: slot.expiresAt };
    const now = this.clock();
    const fresh =
      slot.reservation !== undefined &&
      slot.claimedAt !== undefined &&
      now - slot.claimedAt < this.config.reservationReuseMs;
    if (fresh && slot.reservation !== undefined) {
      return { status: 'matched', reservation: slot.reservation };
    }
    slot.claiming ??= this.gateway.reserve(slot.roomId, {}, bearer);
    const pending = slot.claiming;
    try {
      const reservation = await pending;
      slot.reservation = reservation;
      slot.claimedAt = this.clock();
      return { status: 'matched', reservation };
    } catch (err) {
      if (this.slots.get(userId) === slot) this.slots.delete(userId);
      if (err instanceof GatewayAuthError) throw err;
      return { status: 'idle' };
    } finally {
      if (slot.claiming === pending) delete slot.claiming;
    }
  }

  /** Forma as mesas possíveis. Cada grupo sai da fila de forma atômica (síncrona) antes de qualquer `await`. */
  async drain(): Promise<void> {
    const groups = this.queue.takeGroups();
    if (groups.length === 0) return;
    await Promise.all(groups.map((g) => this.formTable(g)));
  }

  private async formTable(group: readonly QueueEntry[]): Promise<void> {
    const first = group[0];
    if (first === undefined) return;
    const now = this.clock();
    const tickets = new Map<string, Slot>();
    for (const entry of group) {
      const ticket: Slot = {
        kind: 'ticket',
        roomId: null,
        expiresAt: now + this.config.fillMs,
        entry,
      };
      tickets.set(entry.userId, ticket);
      this.slots.set(entry.userId, ticket);
    }
    const options: RoomOptions = {
      variant: first.variant,
      format: 'single',
      ironHand: first.ironHand,
      visibility: 'public',
    };
    let token: string | null = null;
    let code: string | null = null;
    try {
      code = this.newCode();
      token = randomBytes(16).toString('hex');
      this.grants.set(token, {
        kind: 'queue',
        code,
        creator: null,
        allowed: new Set(group.map((e) => e.userId)),
        creatorMs: this.config.creatorMs,
        fillMs: this.config.fillMs,
        waitMs: this.config.tableWaitMs,
      });
      const roomId = await this.gateway.createRoom(options, token);
      for (const [userId, ticket] of tickets) {
        if (this.slots.get(userId) === ticket && ticket.kind === 'ticket') ticket.roomId = roomId;
      }
    } catch (err) {
      log.warn('lobby: mesa da fila não foi criada', { name: errName(err) });
      if (token !== null) this.grants.delete(token);
      if (code !== null) this.codes.delete(code);
      // Ninguém perde a vez: volta à posição original.
      for (const entry of group) {
        const slot = this.slots.get(entry.userId);
        if (slot === tickets.get(entry.userId)) {
          this.slots.delete(entry.userId);
          if (this.queue.requeue(entry, this.clock(), this.config.queueTtlMs)) {
            this.slots.set(entry.userId, { kind: 'queued', entry });
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------ manutenção

  /** Expira entradas da fila e tickets sem assento. */
  sweep(): void {
    const now = this.clock();
    for (const entry of this.queue.expire(now)) {
      const slot = this.slots.get(entry.userId);
      if (slot?.kind === 'queued' && slot.entry === entry) this.slots.delete(entry.userId);
    }
    for (const [userId, slot] of this.slots) {
      if (slot.kind === 'ticket' && slot.expiresAt <= now) this.slots.delete(userId);
    }
  }

  /** Contagens agregadas (sem userId nem apelido). */
  stats(): { queued: number; tables: number; users: number } {
    return { queued: this.queue.size, tables: this.rooms.size, users: this.slots.size };
  }

  /** Teste: slot do usuário. */
  slotKind(userId: string): Slot['kind'] | null {
    return this.slots.get(userId)?.kind ?? null;
  }
}

function errName(err: unknown): string {
  return err instanceof Error ? err.name : 'unknown';
}

// ---------------------------------------------------------------------- instância do processo

let current: Lobby | null = null;

/** Registra o lobby do processo (a sala o consulta; `static`/instância não têm acesso ao `Server`). */
export function configureLobby(lobby: Lobby | null): void {
  current?.stop();
  current = lobby;
}

export function getLobby(): Lobby | null {
  return current;
}
