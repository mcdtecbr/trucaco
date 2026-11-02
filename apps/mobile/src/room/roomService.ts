/**
 * Dono da sala Colyseus atual (singleton por app). Uma sala por vez; sai sempre com `leave(true)`
 * (consentido) e nunca vaza entre sessões (`leave()` é chamado no logout). Projeta só o que a sala de
 * espera mostra em `roomStore` e alimenta a mesa (`table`: projeção em `tableStore`, eventos, presença, erros).
 */
import type { ClientMessage, SeatReservation } from '@trucaco/protocol';
import { errorCodeOf } from '../i18n/errors';
import { trackEvents } from '../net/colyseus';
import type { EventTracker } from '../net/colyseus';
import { payloadOf } from '../table/actionMessage';
import type { TableController } from '../table/tableController';
import { projectWaiting } from '../store/roomStore';
import type { RoomStore } from '../store/roomStore';

/** `CloseCode.CONSENTED` do Colyseus: saída pedida pelo cliente. */
export const CLOSE_CONSENTED = 4000;
/** Espera máxima pelo primeiro estado depois de entrar. */
export const FIRST_STATE_TIMEOUT_MS = 3000;

/** O que usamos de `Room` (o SDK real satisfaz; testes usam um falso). */
export interface RoomLike {
  readonly state: unknown;
  readonly reconnectionToken: string;
  onStateChange(cb: () => void): unknown;
  onDrop(cb: () => void): unknown;
  onReconnect(cb: () => void): unknown;
  onLeave(cb: (code: number) => void): unknown;
  onMessage(type: string, cb: (payload: unknown) => void): unknown;
  send(type: string, payload: unknown): void;
  leave(consented?: boolean): Promise<unknown>;
}

export interface RoomClientLike {
  joinWithReservation(reservation: SeatReservation): Promise<RoomLike>;
  reconnect(source: { reconnectionToken: string }): Promise<RoomLike>;
}

export interface RoomService {
  /** Consome a reserva e resolve com o `roomCode` (pode ser '' se o estado não chegou a tempo). */
  enter(reservation: SeatReservation): Promise<string>;
  /** Sai da sala atual de forma consentida e zera o store. Idempotente. */
  leave(): Promise<void>;
  current(): RoomLike | null;
  /** Envia uma mensagem de jogo (sem `seat`). `false` = não há sala conectada. */
  send(message: ClientMessage): boolean;
}

/** O que o serviço precisa da mesa (o `TableController` satisfaz). */
export type TableSink = Pick<
  TableController,
  | 'applyState'
  | 'onEvent'
  | 'onDesync'
  | 'acknowledgeResync'
  | 'onPresence'
  | 'onTurnTimer'
  | 'onServerError'
  | 'onReconnected'
  | 'reset'
>;

/**
 * Mensagens do servidor que esta entrega ainda não usa (3H2/Fase 4): no-op para o SDK não avisar de tipo
 * sem handler. `event`, `presence`, `turnTimer` e `error` têm handler próprio em `attach`.
 */
const IGNORED_MESSAGES = ['signal', 'sfx', 'chat'];

export function createRoomService(options: {
  getClient: () => RoomClientLike;
  store: RoomStore;
  /** Alimentada a cada patch de estado e a cada mensagem do servidor. */
  table?: TableSink;
  firstStateTimeoutMs?: number;
}): RoomService {
  const { store, table } = options;
  const timeoutMs = options.firstStateTimeoutMs ?? FIRST_STATE_TIMEOUT_MS;
  let room: RoomLike | null = null;
  /** Sobe a cada `enter`/`leave`: callbacks de uma sala antiga são ignorados. */
  let generation = 0;
  let tracker: EventTracker | null = null;

  function project(r: RoomLike): void {
    const json = (r.state as { toJSON?: () => unknown } | null | undefined)?.toJSON?.();
    table?.applyState(json);
    const p = projectWaiting(json);
    store.getState().patch({
      roomCode: p.roomCode,
      tablePhase: p.tablePhase,
      seats: p.seats,
      mySeat: p.mySeat,
    });
  }

  function attach(r: RoomLike, gen: number, afterSeq: number | null = null): void {
    const live = (): boolean => gen === generation && room === r;
    const mine: EventTracker = trackEvents(
      r,
      {
        onEvent: (env) => {
          if (live()) table?.onEvent(env);
        },
        onDesync: (info) => {
          if (!live()) return;
          // Salto de seq: descarta o histórico derivado e refaz tudo a partir do estado.
          table?.onDesync(info);
          project(r);
          mine.acknowledgeResync();
          table?.acknowledgeResync();
        },
      },
      afterSeq,
    );
    tracker = mine;
    r.onMessage('presence', (p) => {
      if (live()) table?.onPresence(p);
    });
    r.onMessage('turnTimer', (p) => {
      if (live()) table?.onTurnTimer(p);
    });
    r.onMessage('error', (p) => {
      if (live()) table?.onServerError(p);
    });
    r.onStateChange(() => {
      if (live()) project(r);
    });
    r.onDrop(() => {
      if (live()) store.getState().patch({ connection: 'reconnecting' });
    });
    r.onReconnect(() => {
      if (!live()) return;
      store.getState().patch({ connection: 'connected', errorCode: null });
      project(r);
      table?.onReconnected();
    });
    r.onLeave((code) => {
      if (!live()) return;
      if (code === CLOSE_CONSENTED) {
        store.getState().patch({ connection: 'closed' });
        return;
      }
      void recover(r, gen);
    });
    for (const type of IGNORED_MESSAGES) r.onMessage(type, () => undefined);
  }

  /** O SDK esgotou as tentativas automáticas: uma tentativa manual com refresh do JWT. */
  async function recover(old: RoomLike, gen: number): Promise<void> {
    store.getState().patch({ connection: 'reconnecting' });
    try {
      const afterSeq = tracker?.lastSeq() ?? null;
      const next = await options.getClient().reconnect(old);
      if (gen !== generation) {
        void next.leave(true).catch(() => undefined);
        return;
      }
      room = next;
      attach(next, gen, afterSeq);
      store.getState().patch({ connection: 'connected', errorCode: null });
      project(next);
      table?.onReconnected();
    } catch (e) {
      if (gen !== generation) return;
      room = null;
      store.getState().patch({ connection: 'closed', errorCode: errorCodeOf(e) });
    }
  }

  function firstState(r: RoomLike, gen: number): Promise<void> {
    return new Promise((resolve) => {
      if (store.getState().roomCode !== '') return resolve();
      const timer = setTimeout(resolve, timeoutMs);
      r.onStateChange(() => {
        if (gen === generation && store.getState().roomCode !== '') {
          clearTimeout(timer);
          resolve();
        }
      });
    });
  }

  async function leave(): Promise<void> {
    generation += 1;
    const r = room;
    room = null;
    tracker = null;
    store.getState().reset();
    table?.reset();
    if (r === null) return;
    try {
      await r.leave(true);
    } catch {
      // Já caiu: nada a fazer.
    }
  }

  return {
    async enter(reservation) {
      // `gen` é tomado ANTES de qualquer await: um `leave()` durante a entrada invalida esta tentativa.
      const gen = ++generation;
      const previous = room;
      room = null;
      tracker = null;
      store.getState().reset();
      table?.reset();
      store.getState().patch({ connection: 'joining' });
      if (previous !== null) await previous.leave(true).catch(() => undefined);
      if (gen !== generation) return '';
      let r: RoomLike;
      try {
        r = await options.getClient().joinWithReservation(reservation);
      } catch (e) {
        if (gen === generation) {
          store.getState().patch({ connection: 'closed', errorCode: errorCodeOf(e) });
        }
        throw e;
      }
      if (gen !== generation) {
        // O usuário saiu durante a entrada.
        void r.leave(true).catch(() => undefined);
        return '';
      }
      room = r;
      attach(r, gen);
      store.getState().patch({ connection: 'connected', errorCode: null });
      project(r);
      await firstState(r, gen);
      return store.getState().roomCode;
    },

    leave,
    current: () => room,
    send(message) {
      if (room === null || store.getState().connection !== 'connected') return false;
      room.send(message.type, payloadOf(message));
      return true;
    },
  };
}
