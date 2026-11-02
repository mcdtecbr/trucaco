/** Espelho da sessão para a UI (Zustand). A fonte de verdade é `net/session.ts`; sem lógica de jogo. */
import { createStore, useStore } from 'zustand';
import type { SessionState, SessionStatus, SessionUser } from '../net/session';
import type { Session } from '../net/session';

export interface SessionStoreState {
  readonly status: SessionStatus;
  readonly user: SessionUser | null;
  /** Uma sessão que existia foi perdida (refresh recusado) e caímos para um convidado novo. */
  readonly lostPrevious: boolean;
  /** Logout pedido pelo usuário: o próximo `signedOut` não conta como sessão perdida. */
  readonly loggingOut: boolean;
  sync(next: SessionState): void;
  beginLogout(): void;
  dismissLost(): void;
  reset(): void;
}

const INITIAL = {
  status: 'idle' as SessionStatus,
  user: null as SessionUser | null,
  lostPrevious: false,
  loggingOut: false,
};

export function createSessionStore() {
  return createStore<SessionStoreState>()((set, get) => ({
    ...INITIAL,
    sync(next) {
      const prev = get();
      const lost = next.status === 'signedOut' && prev.status !== 'idle' && !prev.loggingOut;
      set({
        status: next.status,
        user: next.user,
        lostPrevious: prev.lostPrevious || lost,
        loggingOut: next.status === 'signedOut' ? false : prev.loggingOut,
      });
    },
    beginLogout: () => set({ loggingOut: true }),
    dismissLost: () => set({ lostPrevious: false }),
    reset: () => set({ ...INITIAL }),
  }));
}

export type SessionStore = ReturnType<typeof createSessionStore>;

export const sessionStore: SessionStore = createSessionStore();

/** Liga o store à sessão; devolve a função que desliga. */
export function bindSession(session: Session, store: SessionStore = sessionStore): () => void {
  store.getState().sync(session.getState());
  return session.subscribe((s) => store.getState().sync(s));
}

export function useSessionStore<T>(selector: (s: SessionStoreState) => T): T {
  return useStore(sessionStore, selector);
}

export const selectNickname = (s: SessionStoreState): string | null => s.user?.nickname ?? null;
export const selectIsReady = (s: SessionStoreState): boolean => s.status === 'authenticated';
