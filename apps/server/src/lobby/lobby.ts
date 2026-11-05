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
import { randomBytes, randomInt } from 'node:crypto';
import { isValidRoomCode } from '@trucaco/protocol';
import type { RoomOptions, Visibility } from '@trucaco/protocol';
import { log } from '../logger';
import { onBlockChange, onUserDeleted } from '../social/blockBus';
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
  /**
   * Quem casa numa mesa da fila e não senta (ou desiste/sai depois de casar) fica este tempo sem poder
   * reentrar na fila (por `userId`). 0 desliga. Sair da fila ANTES de casar não é penalizado.
   */
  readonly queueReentryCooldownMs: number;
  /** Piso de latência das recusas de `POST /tables/join` (anti oráculo de tempo). 0 desliga. */
  readonly joinMinLatencyMs: number;
  /** Teto de usuários com cooldown guardados (memória limitada). */
  readonly maxCooldownKeys: number;
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
  queueReentryCooldownMs: 60_000,
  joinMinLatencyMs: 150,
  maxCooldownKeys: 50_000,
  guard: DEFAULT_JOIN_GUARD,
};

/**
 * Fonte dos bloqueios (Fase 6): todos os `userId` com bloqueio em QUALQUER sentido em relação a
 * `userId` (quem ele bloqueou e quem o bloqueou). Falha = lança; o lobby falha FECHADO.
 */
export interface BlockLookup {
  relatedIds(userId: string): Promise<ReadonlySet<string>>;
}

/** Concessão de criação: o que a sala recém-criada pode fazer. Criada só pelo lobby. */
export interface Grant {
  readonly kind: 'private' | 'queue';
  readonly code: string;
  /** Mesa privada: o primeiro a sentar. */
  readonly creator: string | null;
  /** Mesa da fila: únicos usuários admitidos. */
  readonly allowed: ReadonlySet<string> | null;
  /**
   * Mesa da fila: assento SORTEADO de cada usuário (0..3; duplas 0/2 e 1/3). O assento vem daqui, nunca da
   * ordem de chegada: contas combinadas não escolhem ser parceiras nem ocupar vagas por pressa.
   */
  readonly seats: ReadonlyMap<string, number> | null;
  readonly creatorMs: number;
  readonly fillMs: number;
  readonly waitMs: number;
}

export interface SeatReservation {
  readonly name: string;
  readonly sessionId: string;
  readonly roomId: string;
  readonly reconnectionToken?: string;
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

interface TicketSlot {
  kind: 'ticket';
  roomId: string | null;
  expiresAt: number;
  /** `null` = ticket de mesa privada (criador ou quem entra por código); fila: a entrada original. */
  entry: QueueEntry | null;
  reservation?: SeatReservation;
  claimedAt?: number;
  claiming?: Promise<SeatReservation>;
}

type Slot =
  | { kind: 'queued'; entry: QueueEntry }
  | TicketSlot
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
  | 'QUEUE_COOLDOWN'
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
  /** userId -> fim do cooldown de reentrada na fila (FIFO com teto de chaves). */
  private readonly cooldowns = new Map<string, number>();
  private readonly guard: JoinGuard;
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribeBlocks: (() => void) | null = null;
  private unsubscribeDeleted: (() => void) | null = null;

  constructor(
    private readonly gateway: TableGateway,
    readonly config: LobbyConfig = DEFAULT_LOBBY_CONFIG,
    private readonly clock: () => number = Date.now,
    private readonly rand: RandomIntFn = randomInt,
    private readonly blocks: BlockLookup | null = null,
  ) {
    this.queue = new MatchQueue(config.maxQueue);
    this.guard = new JoinGuard(config.guard);
  }

  /** Varredura periódica (expira fila e tickets). O timer não segura o processo. */
  start(everyMs = 1000): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.sweep(), everyMs);
    this.timer.unref();
    // Bloqueio feito com a fila andando vale já: quem espera nunca casa com o bloqueado.
    this.unsubscribeBlocks ??= onBlockChange((c) => {
      if (c.active) this.noteBlock(c.blockerId, c.blockedId);
    });
    this.unsubscribeDeleted ??= onUserDeleted((userId) => this.forgetUser(userId));
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.unsubscribeBlocks?.();
    this.unsubscribeBlocks = null;
    this.unsubscribeDeleted?.();
    this.unsubscribeDeleted = null;
  }

  /**
   * Conta apagada: sai da fila e perde o ticket (fila ou mesa privada ainda sem assento). Quem já está
   * sentado é tratado pela sala (`dropDeletedUser`). Sem cooldown: a conta não existe mais.
   */
  forgetUser(userId: string): void {
    const slot = this.slots.get(userId);
    if (slot === undefined) return;
    if (slot.kind === 'queued') this.queue.remove(userId);
    if (slot.kind !== 'table') this.slots.delete(userId);
  }

  /** Bloqueio novo entre dois usuários: as entradas que esperam na fila passam a se evitar. */
  noteBlock(a: string, b: string): void {
    this.queue.addAvoid(a, b);
  }

  /** `true` se `userId` tem bloqueio (qualquer sentido) com alguém de `others`. Sem fonte: `false`. */
  private async hasBlockWith(userId: string, others: Iterable<string>): Promise<boolean> {
    if (this.blocks === null) return false;
    const related = await this.blocks.relatedIds(userId);
    if (related.size === 0) return false;
    for (const other of others) if (related.has(other)) return true;
    return false;
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

  /**
   * O usuário deixou a mesa de vez (saiu na espera ou o bot assumiu). Libera o vínculo. `penalize`: saiu
   * de uma mesa da fila ainda em espera (casou, sentou e desistiu): cooldown de reentrada na fila.
   */
  unseat(userId: string, roomId: string, penalize = false): void {
    const slot = this.slots.get(userId);
    if (slot?.kind === 'table' && slot.roomId === roomId) {
      this.slots.delete(userId);
      if (penalize && slot.entry !== null) this.penalize(userId);
    }
  }

  /** Cooldown de reentrada na fila (no-op com a opção desligada). */
  private penalize(userId: string): void {
    if (this.config.queueReentryCooldownMs <= 0) return;
    this.cooldowns.delete(userId);
    this.cooldowns.set(userId, this.clock() + this.config.queueReentryCooldownMs);
    if (this.cooldowns.size > this.config.maxCooldownKeys) {
      const oldest = this.cooldowns.keys().next();
      if (oldest.done !== true) this.cooldowns.delete(oldest.value);
    }
  }

  /** Segundos que faltam do cooldown (0 = livre). Remove o vencido. */
  private cooldownLeftSec(userId: string): number {
    const until = this.cooldowns.get(userId);
    if (until === undefined) return 0;
    const left = until - this.clock();
    if (left <= 0) {
      this.cooldowns.delete(userId);
      return 0;
    }
    return Math.ceil(left / 1000);
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
      } else if (slot.kind === 'ticket' && slot.roomId === roomId && slot.entry !== null) {
        // Casou e não sentou: ocupou a vaga de outros três.
        this.penalize(userId);
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
    // Prazo provisório (a criação da sala é assíncrona); depois de criada, alinha com o prazo da sala.
    const slot: TicketSlot = {
      kind: 'ticket',
      roomId: null,
      expiresAt: now + this.config.creatorMs,
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
        seats: null,
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
    // O timer do criador da sala foi armado em `onCreate` (um pouco antes de agora): o ticket vale pelo
    // mesmo prazo e nunca sobrevive à mesa fechada (`releaseRoom` o remove) nem falta enquanto ela espera.
    slot.expiresAt = this.clock() + this.config.creatorMs;
    try {
      const reservation = await this.claim(slot, roomId, {}, bearer);
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
    // Mesma mesa (sentado, ou ticket desta mesa: criador que perdeu a reserva) segue; outra mesa/fila, não.
    // É o estado do próprio usuário: não revela nada sobre o código consultado.
    const sameRoom =
      slot !== undefined &&
      roomId !== undefined &&
      (slot.kind === 'table' || slot.kind === 'ticket') &&
      slot.roomId === roomId;
    if (slot !== undefined && !sameRoom) return { ok: false, error: 'ALREADY_IN_TABLE' };
    if (roomId === undefined || info === undefined || info.grant?.kind !== 'private') {
      return this.unavailable(userId, ip);
    }
    // Bloqueio (qualquer sentido) com o criador ou com quem já sentou: o MESMO erro de mesa inexistente.
    // Falha do banco = fechado (também `TABLE_UNAVAILABLE`, nada de erro distinto).
    if (!sameRoom && this.blocks !== null) {
      const present: string[] = [];
      if (info.grant.creator !== null) present.push(info.grant.creator);
      for (const [other, s] of this.slots) {
        if (s.kind === 'table' && s.roomId === roomId) present.push(other);
      }
      let blocked = true;
      try {
        blocked = await this.hasBlockWith(userId, present);
      } catch (err) {
        log.warn('lobby: consulta de bloqueios falhou', { name: errName(err) });
      }
      if (blocked) return this.unavailable(userId, ip);
    }
    // A reserva pendente ocupa o slot do usuário: não dá para segurar várias vagas de uma vez.
    let own: TicketSlot | null = slot?.kind === 'ticket' ? slot : null;
    let created: TicketSlot | null = null;
    if (slot === undefined) {
      created = {
        kind: 'ticket',
        roomId,
        expiresAt: this.clock() + this.config.reservationReuseMs,
        entry: null,
      };
      own = created;
      this.slots.set(userId, created);
    }
    try {
      const reservation =
        own !== null
          ? await this.claim(own, roomId, { code }, bearer)
          : await this.gateway.reserve(roomId, { code }, bearer);
      return { ok: true, reservation };
    } catch (err) {
      if (created !== null && this.slots.get(userId) === created) this.slots.delete(userId);
      if (err instanceof GatewayAuthError) throw err;
      return this.unavailable(userId, ip);
    }
  }

  /**
   * Reserva de assento do ticket: reaproveita a reserva ainda viva (dentro de `reservationReuseMs`, menor
   * que a validade no core) e junta chamadas simultâneas numa só (nunca duas vagas seguradas).
   */
  private async claim(
    slot: TicketSlot,
    roomId: string,
    joinOptions: { code?: string },
    bearer: string,
  ): Promise<SeatReservation> {
    if (
      slot.reservation !== undefined &&
      slot.claimedAt !== undefined &&
      this.clock() - slot.claimedAt < this.config.reservationReuseMs
    ) {
      return slot.reservation;
    }
    slot.claiming ??= this.gateway.reserve(roomId, joinOptions, bearer);
    const pending = slot.claiming;
    try {
      const reservation = await pending;
      slot.reservation = reservation;
      slot.claimedAt = this.clock();
      return reservation;
    } finally {
      if (slot.claiming === pending) delete slot.claiming;
    }
  }

  private unavailable(userId: string, ip: string): Fail {
    this.guard.fail(userId, ip, this.clock());
    return { ok: false, error: 'TABLE_UNAVAILABLE' };
  }

  isLocked(userId: string): boolean {
    return this.guard.isLocked(userId, this.clock());
  }

  /**
   * `/matchmake/joinById` (fora do lobby): mesmo freio de força bruta do `joinByCode`. `ip` só entra quando
   * é confiável (atrás de proxy configurado); sem ele conta só o usuário. `true` = pode tentar.
   */
  allowDirectJoin(userId: string, ip: string | null): boolean {
    return this.guard.check(userId, ip, this.clock()) === 'ok';
  }

  /** Falha de uma entrada direta por roomId (sala inexistente, cheia, recusada). */
  noteDirectJoinFailure(userId: string, ip: string | null): void {
    this.guard.fail(userId, ip, this.clock());
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
      const wait = this.cooldownLeftSec(userId);
      if (wait > 0) return { ok: false, error: 'QUEUE_COOLDOWN', retryAfterSec: wait };
      let avoid: ReadonlySet<string> | undefined;
      if (this.blocks !== null) {
        try {
          avoid = await this.blocks.relatedIds(userId);
        } catch (err) {
          log.warn('lobby: consulta de bloqueios falhou', { name: errName(err) });
          return { ok: false, error: 'UNAVAILABLE' };
        }
      }
      // O `await` acima abre uma janela: outra chamada do mesmo usuário pode ter entrado na fila.
      if (!this.slots.has(userId)) {
        const entry = this.queue.enqueue(
          userId,
          options,
          this.clock(),
          this.config.queueTtlMs,
          avoid,
        );
        if (entry === null) return { ok: false, error: 'QUEUE_FULL' };
        this.slots.set(userId, { kind: 'queued', entry });
        await this.drain();
      }
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
    } else if (slot.kind === 'ticket' && slot.entry !== null) {
      // Mesa da fila formada e ainda não sentou: desiste (e paga o cooldown: deixou três esperando). A
      // mesa se resolve no prazo (`failFill`). Ticket sem entrada (criador/convidado de mesa privada) não
      // é da fila e não é tocado.
      this.slots.delete(userId);
      this.penalize(userId);
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
    try {
      return { status: 'matched', reservation: await this.claim(slot, slot.roomId, {}, bearer) };
    } catch (err) {
      if (this.slots.get(userId) === slot) this.slots.delete(userId);
      if (err instanceof GatewayAuthError) throw err;
      return { status: 'idle' };
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
    // Assentos sorteados (Fisher-Yates com `crypto.randomInt`): a ordem de chegada na fila ou de entrada na
    // sala não decide parceria nem vaga.
    const order = group.map((e) => e.userId);
    for (let i = order.length - 1; i > 0; i--) {
      const j = this.rand(0, i + 1);
      [order[i], order[j]] = [order[j] as string, order[i] as string];
    }
    const seats = new Map(order.map((userId, seat) => [userId, seat] as const));
    for (const entry of group) {
      const ticket: TicketSlot = {
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
        seats,
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
      if (slot.kind === 'ticket' && slot.expiresAt <= now) {
        this.slots.delete(userId);
        // Ticket da fila vencido sem sentar: casou e não apareceu.
        if (slot.entry !== null && slot.roomId !== null) this.penalize(userId);
      }
    }
  }

  /** Contagens agregadas (sem userId nem apelido). */
  stats(): { queued: number; tables: number; users: number } {
    return { queued: this.queue.size, tables: this.rooms.size, users: this.slots.size };
  }

  /** Fila pública por tamanho de mesa (agregado, sem userId). */
  queueByTableSize(): Record<string, number> {
    return this.queue.countByTableSize();
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
