/** Estado de UI do lobby: fila, requisição em voo e último erro. Sem regra de jogo. */
import { createStore, useStore } from 'zustand';

export type QueueView =
  | { readonly status: 'idle' }
  | { readonly status: 'queued'; readonly expiresAt: number }
  | { readonly status: 'matched' }
  | { readonly status: 'seated' };

/** Operação em voo. `none` = livre. Qualquer outra desabilita os botões (anti duplo clique). */
export type LobbyBusy = 'none' | 'create' | 'join' | 'queue' | 'leaving' | 'entering';
export type LobbyScope = 'create' | 'join' | 'queue';

export interface LobbyError {
  readonly scope: LobbyScope;
  readonly code: string;
  readonly retryAfterSeconds?: number;
}

export type LobbyNotice = 'queueExpired' | null;

export interface LobbyStoreState {
  readonly queue: QueueView;
  readonly busy: LobbyBusy;
  readonly error: LobbyError | null;
  readonly notice: LobbyNotice;
  setQueue(queue: QueueView): void;
  setBusy(busy: LobbyBusy): void;
  setError(error: LobbyError | null): void;
  setNotice(notice: LobbyNotice): void;
  reset(): void;
}

const INITIAL = {
  queue: { status: 'idle' } as QueueView,
  busy: 'none' as LobbyBusy,
  error: null as LobbyError | null,
  notice: null as LobbyNotice,
};

export function createLobbyStore() {
  return createStore<LobbyStoreState>()((set) => ({
    ...INITIAL,
    setQueue: (queue) => set({ queue }),
    setBusy: (busy) => set({ busy }),
    setError: (error) => set({ error }),
    setNotice: (notice) => set({ notice }),
    reset: () => set({ ...INITIAL }),
  }));
}

export type LobbyStore = ReturnType<typeof createLobbyStore>;
export const lobbyStore: LobbyStore = createLobbyStore();

export function useLobbyStore<T>(selector: (s: LobbyStoreState) => T): T {
  return useStore(lobbyStore, selector);
}

export const selectIsBusy = (s: LobbyStoreState): boolean => s.busy !== 'none';
export const selectInQueue = (s: LobbyStoreState): boolean => s.queue.status === 'queued';

/** Segundos que faltam para a entrada na fila expirar (0 se já passou ou fora da fila). */
export function queueRemainingSeconds(queue: QueueView, nowMs: number): number {
  if (queue.status !== 'queued') return 0;
  return Math.max(0, Math.ceil((queue.expiresAt - nowMs) / 1000));
}
