/**
 * Controlador da mesa (sem React): recebe estado, eventos e mensagens do servidor, mantém o
 * `tableStore` e traduz toques em mensagens. É o único lugar que envia ações de jogo, e só envia o que
 * está em `legalActions` do snapshot atual (a UI desabilita o resto; o servidor revalida).
 */
import { ERROR_CODES } from '@trucaco/protocol';
import type { ClientMessage, ErrorCode, PublicGameEvent } from '@trucaco/protocol';
import { PUBLIC_EVENT_TYPES, announcementFor } from '@trucaco/ui';
import type { HandResult } from '@trucaco/ui';
import { messageForAction } from './actionMessage';
import { createClockOffset } from './clockOffset';
import { isPresenceStatus, presenceText } from './presence';
import { actionSignature, projectTable } from './projectTable';
import type { TableStore, TableStoreState } from './tableStore';

/** Se o estado não reagir à ação em tanto tempo, o botão destrava (mensagem perdida). */
export const BUSY_TIMEOUT_MS = 3000;
export const NOTICE_MS = 3000;
export const PRESENCE_NOTE_MS = 5000;
/** Teto do histórico em memória. */
const MAX_HISTORY = 200;

type MutablePatch = {
  -readonly [K in keyof Omit<TableStoreState, 'patch' | 'reset'>]?: TableStoreState[K];
};

export interface EventEnvelope {
  readonly seq: number;
  readonly at: number;
  readonly event: unknown;
}

export interface TableTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface TableControllerOptions {
  store: TableStore;
  /** Envia ao servidor; `false` = sem sala. */
  send: (msg: ClientMessage) => boolean;
  now?: () => number;
  timers?: TableTimers;
}

export interface TableController {
  /** Um `set` por patch de `room.state`. */
  applyState(roomState: unknown): void;
  onEvent(env: EventEnvelope): void;
  /** Salto de `seq`: o histórico derivado não vale mais. O estado é reprojetado por quem chama. */
  onDesync(info: { expected: number; got: number }): void;
  acknowledgeResync(): void;
  onPresence(payload: unknown): void;
  onTurnTimer(payload: unknown): void;
  onServerError(payload: unknown): void;
  onReconnected(): void;
  /** Toque numa carta: seleciona; no mesmo item selecionado, confirma. */
  pressCard(actionId: string): void;
  /** Envia a ação se (e só se) ela estiver em `legalActions` e não houver outra em voo. */
  act(actionId: string): boolean;
  clearError(): void;
  setLeaveConfirm(open: boolean): void;
  /** Quem anuncia (leitor de tela). `null` desliga. */
  setAnnouncer(fn: ((message: string) => void) | null): void;
  reset(): void;
}

function isPublicEvent(x: unknown): x is PublicGameEvent {
  if (typeof x !== 'object' || x === null) return false;
  const t = (x as { type?: unknown }).type;
  return typeof t === 'string' && (PUBLIC_EVENT_TYPES as readonly string[]).includes(t);
}

export function isErrorCode(x: unknown): x is ErrorCode {
  return typeof x === 'string' && (ERROR_CODES as readonly string[]).includes(x);
}

export function createTableController(opts: TableControllerOptions): TableController {
  const { store } = opts;
  const now = opts.now ?? Date.now;
  const timers: TableTimers = opts.timers ?? {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  const offset = createClockOffset();
  let announce: ((message: string) => void) | null = null;
  let busySignature = '';
  let busyTimer: unknown = null;
  let noticeTimer: unknown = null;
  let presenceTimer: unknown = null;
  let handNumber = 0;

  const clear = (h: unknown): void => {
    if (h !== null) timers.clearTimeout(h);
  };
  const unlock = (): void => {
    clear(busyTimer);
    busyTimer = null;
    if (store.getState().busy) store.getState().patch({ busy: false });
  };

  function say(text: string): void {
    announce?.(text);
  }

  function applyState(roomState: unknown): void {
    const vm = projectTable(roomState);
    const cur = store.getState();
    const selected =
      cur.selected !== null && (vm.legalActions as readonly string[]).includes(cur.selected)
        ? cur.selected
        : null;
    const release = cur.busy && actionSignature(vm) !== busySignature;
    if (release) {
      clear(busyTimer);
      busyTimer = null;
    }
    // Um único `set` por patch do servidor.
    cur.patch({ vm, selected, ...(release ? { busy: false } : {}) });
  }

  function handResultOf(e: Extract<PublicGameEvent, { type: 'handDecided' }>): HandResult {
    return {
      handNumber: handNumber > 0 ? handNumber : (store.getState().vm?.handNumber ?? 0),
      winnerTeam: e.winnerTeam,
      points: e.points,
      reason: e.reason,
      scores: e.scores,
    };
  }

  function act(actionId: string): boolean {
    const s = store.getState();
    const vm = s.vm;
    if (s.busy || vm === null) return false;
    // Nenhuma ação sai se não estiver em `legalActions` do snapshot atual.
    if (!(vm.legalActions as readonly string[]).includes(actionId)) return false;
    const msg = messageForAction(actionId);
    if (msg === null) return false;
    if (!opts.send(msg)) return false;
    busySignature = actionSignature(vm);
    s.patch({ busy: true, selected: null, errorCode: null });
    clear(busyTimer);
    busyTimer = timers.setTimeout(unlock, BUSY_TIMEOUT_MS);
    return true;
  }

  return {
    applyState,
    act,

    onEvent(env) {
      const clientNow = now();
      const cur = store.getState();
      const patch: MutablePatch = {
        lastSeq: env.seq,
        clockOffsetMs: offset.add(env.at, clientNow),
      };
      const e = env.event;
      if (isPublicEvent(e)) {
        if (e.type === 'handStarted') handNumber = e.handNumber;
        if (e.type === 'handDecided') {
          patch.history = [...cur.history, handResultOf(e)].slice(-MAX_HISTORY);
        }
        if (e.type === 'gameDecided' || e.type === 'gameStarted') patch.history = [];
        const vm = cur.vm;
        try {
          say(
            announcementFor(e, {
              mySeat: vm?.mySeat ?? -1,
              nicknameOf: (seat) => {
                const n = vm?.seats[seat]?.nickname;
                return n === undefined || n === '' ? undefined : n;
              },
              ...(vm !== undefined && vm !== null ? { variant: vm.variant } : {}),
            }),
          );
        } catch {
          // Evento malformado: o estado (fonte de verdade) segue valendo.
        }
      }
      cur.patch(patch);
    },

    onDesync() {
      handNumber = 0;
      store.getState().patch({ history: [], desynced: true });
    },

    acknowledgeResync() {
      store.getState().patch({ desynced: false });
    },

    onPresence(payload) {
      if (typeof payload !== 'object' || payload === null) return;
      const { seat, status } = payload as { seat?: unknown; status?: unknown };
      if (typeof seat !== 'number' || !isPresenceStatus(status)) return;
      const vm = store.getState().vm;
      const player = vm?.seats[seat];
      if (vm === null || player === undefined) return;
      const text = presenceText(player.nickname, seat === vm.mySeat, status);
      say(text);
      clear(presenceTimer);
      store.getState().patch({ presenceNote: text });
      presenceTimer = timers.setTimeout(() => {
        presenceTimer = null;
        store.getState().patch({ presenceNote: null });
      }, PRESENCE_NOTE_MS);
    },

    onTurnTimer(payload) {
      if (typeof payload !== 'object' || payload === null) return;
      const { seat, deadlineAt } = payload as { seat?: unknown; deadlineAt?: unknown };
      if (typeof seat !== 'number' || typeof deadlineAt !== 'number') return;
      store.getState().patch({ timer: { seat, deadlineAt } });
    },

    onServerError(payload) {
      const code = (payload as { code?: unknown } | null)?.code;
      unlock();
      store.getState().patch({ errorCode: isErrorCode(code) ? code : 'UNKNOWN', selected: null });
    },

    onReconnected() {
      clear(noticeTimer);
      store.getState().patch({ notice: 'reconnected', busy: false });
      noticeTimer = timers.setTimeout(() => {
        noticeTimer = null;
        store.getState().patch({ notice: null });
      }, NOTICE_MS);
    },

    pressCard(actionId) {
      const s = store.getState();
      if (s.busy || s.vm === null) return;
      if (!(s.vm.legalActions as readonly string[]).includes(actionId)) return;
      if (s.selected === actionId) {
        act(actionId);
        return;
      }
      s.patch({ selected: actionId, errorCode: null });
    },

    clearError() {
      if (store.getState().errorCode !== null) store.getState().patch({ errorCode: null });
    },

    setLeaveConfirm(open) {
      store.getState().patch({ leaveConfirm: open });
    },

    setAnnouncer(fn) {
      announce = fn;
    },

    reset() {
      clear(busyTimer);
      clear(noticeTimer);
      clear(presenceTimer);
      busyTimer = noticeTimer = presenceTimer = null;
      busySignature = '';
      handNumber = 0;
      offset.reset();
      store.getState().reset();
    },
  };
}
