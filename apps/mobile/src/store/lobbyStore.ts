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
  /** Epoch ms até quando o `Retry-After` vale (botões do escopo ficam desabilitados). */
  readonly retryUntil?: number;
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

/** Segundos que faltam do `Retry-After` do erro (0 se não há ou já passou). */
export function retryRemainingSeconds(error: LobbyError | null, nowMs: number): number {
  if (error?.retryUntil === undefined) return 0;
  return Math.max(0, Math.ceil((error.retryUntil - nowMs) / 1000));
}

/** Segundos que faltam para a entrada na fila expirar (0 se já passou ou fora da fila). */
export function queueRemainingSeconds(queue: QueueView, nowMs: number): number {
  if (queue.status !== 'queued') return 0;
  return Math.max(0, Math.ceil((queue.expiresAt - nowMs) / 1000));
}
