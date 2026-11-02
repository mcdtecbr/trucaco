/**
 * Sessão do cliente: restaurar -> convidado (se não houver) -> autenticado.
 *
 * - O access token vive só em memória; o refresh token é persistido pelo `TokenStorage`.
 * - A renovação acontece em fila única dentro de `api.ts`; aqui só guardamos o resultado.
 * - 503, rede e timeout nunca derrubam a sessão: o estado vira `unavailable` e `start()` tenta de novo.
 * - Sem Zustand: `subscribe` simples; o store de UI (3E) pode espelhar `getState()`.
 */
import { createApiClient, isApiError } from './api';
import type { ApiClient, FetchLike } from './api';
import { getServerUrl } from './config';
import { webRefreshLock } from './refreshLock';
import type { RefreshLock } from './refreshLock';
import type { StoredSession, TokenStorage } from './tokenStorageCore';
import type { TokenPairResponse } from '@trucaco/protocol';

/** Renova o access se faltar menos que isto para expirar. */
export const REFRESH_AHEAD_MS = 60_000;

/** `ensureAccessToken` sem refresh token local (nunca iniciou, logout ou refresh recusado). */
export class SessionRequiredError extends Error {
  constructor() {
    super('SESSION_REQUIRED');
    this.name = 'SessionRequiredError';
  }
}

export type SessionStatus =
  | 'idle'
  | 'restoring'
  | 'authenticated'
  /** Servidor/rede fora: a sessão guardada foi mantida. */
  | 'unavailable'
  /** Sem sessão (refresh recusado ou logout). `start()` cria um convidado novo. */
  | 'signedOut';

export interface SessionUser {
  readonly id: string;
  readonly nickname: string;
}

export interface SessionState {
  readonly status: SessionStatus;
  readonly user: SessionUser | null;
}

export interface SessionOptions {
  storage: TokenStorage;
  baseUrl?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  now?: () => number;
  /** Exclusão mútua da renovação entre abas. Padrão: Web Locks no navegador, nada no nativo. */
  refreshLock?: RefreshLock;
  /** Renova se faltar menos que isto para o access expirar (padrão `REFRESH_AHEAD_MS`). */
  refreshAheadMs?: number;
}

export interface Session {
  readonly api: ApiClient;
  getState(): SessionState;
  subscribe(listener: (state: SessionState) => void): () => void;
  /** Access token atual em memória (pode estar perto de expirar); `null` sem sessão. */
  getAccessToken(): string | null;
  /** Avisa a cada troca de access token (inclusive `null`). Usado para atualizar o cliente Colyseus. */
  onAccessTokenChange(listener: (token: string | null) => void): () => void;
  /** Restaura a sessão guardada ou cria um convidado. Idempotente enquanto roda. */
  start(): Promise<SessionState>;
  /** Devolve um access válido por mais de 60 s, renovando antes se preciso. */
  ensureAccessToken(): Promise<string>;
  /** Renova agora (fila única), mesmo com o access ainda válido. */
  forceRefresh(): Promise<string>;
  /** Encerra no servidor (melhor esforço) e SEMPRE limpa o armazenamento local. */
  logout(): Promise<void>;
  setNickname(nickname: string): Promise<void>;
  /** Cancela a escuta do armazenamento (outras abas). */
  dispose(): void;
}

export function createSession(options: SessionOptions): Session {
  const { storage } = options;
  const now = options.now ?? (() => Date.now());
  const refreshLock = options.refreshLock ?? webRefreshLock;
  const refreshAheadMs = options.refreshAheadMs ?? REFRESH_AHEAD_MS;

  let state: SessionState = { status: 'idle', user: null };
  let accessToken: string | null = null;
  let accessExpiresAt = 0;
  let refreshToken: string | null = null;
  let starting: Promise<SessionState> | null = null;
  /** Sobe a cada logout: o resultado de um `start()` anterior ao logout é descartado. */
  let generation = 0;
  let unsubscribeStorage: (() => void) | null = null;
  const listeners = new Set<(s: SessionState) => void>();
  const tokenListeners = new Set<(t: string | null) => void>();

  function setState(next: SessionState): void {
    state = next;
    for (const l of [...listeners]) l(state);
  }

  function setAccess(token: string | null, expiresInSeconds = 0): void {
    accessToken = token;
    accessExpiresAt = token === null ? 0 : now() + expiresInSeconds * 1000;
    for (const l of [...tokenListeners]) l(token);
  }

  function dropSession(): void {
    refreshToken = null;
    setAccess(null);
  }

  /** Adota o par guardado por OUTRA aba (refresh mais novo e, se mudou, o usuário). */
  function adoptStored(stored: StoredSession): void {
    refreshToken = stored.refreshToken;
    const u = state.user;
    if (u === null || u.id !== stored.userId || u.nickname !== stored.nickname) {
      setState({ status: state.status, user: { id: stored.userId, nickname: stored.nickname } });
    }
  }

  /**
   * Dentro do lock, antes de renovar: se outra aba já rotacionou, o refresh em memória é o ANTIGO e
   * reapresentá-lo é reuso (revoga a família). Relê o armazenamento e adota o que estiver lá.
   */
  async function syncFromStorage(): Promise<void> {
    if (refreshToken === null) return; // sem sessão aqui: não adota a de outro usuário
    let stored: StoredSession | null;
    try {
      stored = await storage.load();
    } catch {
      return;
    }
    if (stored === null || stored.refreshToken === refreshToken) return;
    adoptStored(stored);
  }

  function watchStorage(): void {
    if (unsubscribeStorage !== null || storage.subscribe === undefined) return;
    unsubscribeStorage = storage.subscribe((stored) => {
      if (refreshToken !== null && stored.refreshToken !== refreshToken) adoptStored(stored);
    });
  }

  async function adopt(pair: TokenPairResponse, user: SessionUser): Promise<void> {
    refreshToken = pair.refreshToken;
    // Persistir ANTES de expor o token novo: o refresh antigo já morreu no servidor.
    const stored: StoredSession = {
      refreshToken: pair.refreshToken,
      userId: user.id,
      nickname: user.nickname,
    };
    await storage.save(stored);
    setAccess(pair.accessToken, pair.expiresIn);
  }

  const api = createApiClient({
    baseUrl: options.baseUrl ?? getServerUrl(),
    ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    auth: {
      getAccessToken: () => accessToken,
      getRefreshToken: () => refreshToken,
      async setTokens(pair) {
        const user = state.user;
        if (user === null) throw new Error('sessão sem usuário');
        // Logout (ou refresh recusado) durante o voo: não ressuscita a sessão no armazenamento.
        if (refreshToken === null) throw new SessionRequiredError();
        await adopt(pair, user);
        // Renovação bem-sucedida depois de `unavailable`: a sessão voltou.
        if (state.status === 'unavailable') setState({ status: 'authenticated', user });
      },
      exclusive: (fn) => refreshLock(fn),
      beforeRefresh: syncFromStorage,
      async onRefreshRejected() {
        dropSession();
        await storage.clear();
        setState({ status: 'signedOut', user: null });
      },
    },
  });

  async function createGuest(gen: number): Promise<void> {
    const res = await api.guest();
    if (gen !== generation) return; // logout durante a criação: não grava nada
    const user = { id: res.user.id, nickname: res.user.nickname };
    // `state.user` precisa existir antes de qualquer refresh futuro; adopt grava o par.
    state = { ...state, user };
    await adopt(res, user);
    if (gen !== generation) {
      dropSession();
      await storage.clear();
      return;
    }
    setState({ status: 'authenticated', user });
  }

  async function run(gen: number): Promise<SessionState> {
    const stale = (): boolean => gen !== generation;
    setState({ status: 'restoring', user: state.user });
    try {
      const stored = await storage.load();
      if (stale()) return state;
      if (stored !== null) {
        refreshToken = stored.refreshToken;
        const user = { id: stored.userId, nickname: stored.nickname };
        state = { ...state, user };
        try {
          await api.refreshSession();
          if (stale()) return state;
          // A renovação pode ter adotado outro usuário (outra aba): `state.user` é a fonte.
          setState({ status: 'authenticated', user: state.user ?? user });
          return state;
        } catch (e) {
          if (stale()) return state;
          if (isApiError(e) && e.status === 401) {
            // Já tratado em onRefreshRejected (storage limpo): cai para convidado.
          } else {
            // Timeout/rede/503/corpo inválido: o refresh guardado NÃO é descartado.
            setState({ status: 'unavailable', user });
            return state;
          }
        }
      }
      await createGuest(gen);
      return state;
    } catch {
      if (stale()) return state;
      setState({ status: 'unavailable', user: state.user });
      return state;
    }
  }

  function start(): Promise<SessionState> {
    if (starting !== null) return starting;
    if (state.status === 'authenticated') return Promise.resolve(state);
    watchStorage();
    const p = run(generation).finally(() => {
      if (starting === p) starting = null;
    });
    starting = p;
    return p;
  }

  async function ensureAccessToken(): Promise<string> {
    if (accessToken !== null && accessExpiresAt - now() > refreshAheadMs) return accessToken;
    if (refreshToken === null) {
      throw new SessionRequiredError();
    }
    return api.refreshSession();
  }

  return {
    api,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getAccessToken: () => accessToken,
    onAccessTokenChange(listener) {
      tokenListeners.add(listener);
      return () => {
        tokenListeners.delete(listener);
      };
    },
    start,
    ensureAccessToken,
    forceRefresh: () => {
      if (refreshToken === null) return Promise.reject(new SessionRequiredError());
      return api.refreshSession();
    },
    dispose() {
      unsubscribeStorage?.();
      unsubscribeStorage = null;
    },
    async logout() {
      generation += 1; // invalida um start() em voo
      starting = null;
      try {
        // Access vencido faria o logout levar 401: renova ANTES e lê o refresh já rotacionado.
        await ensureAccessToken();
        const toRevoke = refreshToken;
        if (toRevoke !== null) await api.logout({ refreshToken: toRevoke });
      } catch {
        // Rede/503/401: o logout local acontece mesmo assim.
      } finally {
        dropSession();
        try {
          await storage.clear();
        } finally {
          setState({ status: 'signedOut', user: null });
        }
      }
    },
    async setNickname(nickname) {
      const res = await api.updateNickname(nickname);
      const user = state.user;
      if (user === null) return;
      const next = { id: user.id, nickname: res.nickname };
      if (refreshToken !== null) {
        await storage.save({ refreshToken, userId: next.id, nickname: next.nickname });
      }
      setState({ status: state.status, user: next });
    },
  };
}
