/**
 * Sessão do cliente: restaurar -> convidado (se não houver) -> autenticado.
 *
 * - O access token vive só em memória; o refresh token é persistido pelo `TokenStorage` (nativo).
 * - Web (`webSession`, Fase 7A): o refresh vive num cookie httpOnly. A sessão guarda só um marcador em
 *   memória (`COOKIE_MARKER`) para saber que há sessão, restaura chamando `/auth/refresh` com corpo vazio
 *   e descobre o usuário por `GET /me`; o `TokenStorage` guarda apenas `{ userId, nickname }`.
 * - A renovação acontece em fila única dentro de `api.ts`; aqui só guardamos o resultado.
 * - 503, rede e timeout nunca derrubam a sessão: o estado vira `unavailable` e `start()` tenta de novo.
 * - Sem Zustand: `subscribe` simples; o store de UI (3E) pode espelhar `getState()`.
 */
import { createApiClient, isApiError } from './api';
import type { ApiClient, FetchLike, SessionTokens } from './api';
import { getServerUrl } from './config';
import { usesCookieSession } from './platform';
import { webRefreshLock } from './refreshLock';
import type { RefreshLock } from './refreshLock';
import type { StoredSession, TokenStorage } from './tokenStorageCore';
import type { AuthProvider, SocialAuthRequest } from '@trucaco/protocol';

/** Valor em memória de `refreshToken` no web: há um cookie de sessão; o valor real o JS nunca vê. */
const COOKIE_MARKER = '<cookie>';

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
  /** Tipo de conta (`GET /me`). Ausente até `loadProvider()` terminar (ou depois de restaurar a sessão). */
  readonly provider?: AuthProvider;
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
  /** Refresh em cookie httpOnly (web). Padrão: `usesCookieSession` (`platform.web.ts`). */
  webSession?: boolean;
  /** Repassado ao cliente HTTP: força `credentials: 'include'` (padrão: origem do servidor difere da página). */
  crossOrigin?: boolean;
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
  /** Lê o tipo de conta (`GET /me`) e o guarda no usuário da sessão. Melhor esforço, idempotente. */
  loadProvider(): Promise<void>;
  /**
   * Apaga a conta (`DELETE /me`) com o refresh atual como prova. Em sucesso limpa tudo local e vira
   * `signedOut`; em erro a sessão continua como estava e o erro sobe.
   */
  deleteAccount(): Promise<void>;
  /**
   * Entra com Google/Apple (`POST /auth/google|apple`). A sessão atual (convidado) é substituída: o
   * convidado anterior é perdido. Em erro a sessão continua como estava e o erro sobe.
   */
  loginSocial(req: SocialAuthRequest): Promise<void>;
  /**
   * Vincula a conta social ao convidado atual (`POST /auth/link`). O id não muda (avatar, histórico e
   * combinados ficam); o par de tokens novo substitui o antigo. Em erro (`PROVIDER_TAKEN`...) nada muda.
   */
  linkAccount(req: SocialAuthRequest): Promise<void>;
  /** `GET /auth/nonce`: nonce de uso único que vai ao provedor e volta em `loginSocial`/`linkAccount`. */
  fetchNonce(): Promise<string>;
  /** Cancela a escuta do armazenamento (outras abas). */
  dispose(): void;
}

export function createSession(options: SessionOptions): Session {
  const { storage } = options;
  const now = options.now ?? (() => Date.now());
  const refreshLock = options.refreshLock ?? webRefreshLock;
  const refreshAheadMs = options.refreshAheadMs ?? REFRESH_AHEAD_MS;
  const web = options.webSession ?? usesCookieSession;

  let state: SessionState = { status: 'idle', user: null };
  let accessToken: string | null = null;
  let accessExpiresAt = 0;
  let refreshToken: string | null = null;
  let starting: Promise<SessionState> | null = null;
  /** Leitura de `GET /me` em voo (no máximo uma) e se já falhou desde o último evento explícito. */
  let providerLoad: Promise<void> | null = null;
  let providerTried = false;
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
    if (!web && stored.refreshToken !== undefined) refreshToken = stored.refreshToken;
    const u = state.user;
    if (u === null || u.id !== stored.userId || u.nickname !== stored.nickname) {
      const keep = u !== null && u.id === stored.userId && u.provider !== undefined;
      setState({
        status: state.status,
        user: {
          id: stored.userId,
          nickname: stored.nickname,
          ...(keep ? { provider: u.provider } : {}),
        },
      });
    }
  }

  /**
   * Dentro do lock, antes de renovar: se outra aba já rotacionou, o refresh em memória é o ANTIGO e
   * reapresentá-lo é reuso (revoga a família). Relê o armazenamento e adota o que estiver lá.
   */
  async function syncFromStorage(): Promise<void> {
    if (web) return; // o cookie é um só para todas as abas: o navegador já entrega o mais novo
    if (refreshToken === null) return; // sem sessão aqui: não adota a de outro usuário
    let stored: StoredSession | null;
    try {
      stored = await storage.load();
    } catch {
      return;
    }
    if (
      stored === null ||
      stored.refreshToken === undefined ||
      stored.refreshToken === refreshToken
    ) {
      return;
    }
    adoptStored(stored);
  }

  /** Web: outra aba entrou com outro usuário. */
  function userChanged(stored: StoredSession): boolean {
    const u = state.user;
    return u === null || u.id !== stored.userId || u.nickname !== stored.nickname;
  }

  function watchStorage(): void {
    if (unsubscribeStorage !== null || storage.subscribe === undefined) return;
    unsubscribeStorage = storage.subscribe((stored) => {
      if (refreshToken === null) return;
      if (web) {
        if (!userChanged(stored)) return;
        adoptStored(stored);
        // O access em memória é do usuário anterior: o cookie já é o novo, renova para alinhar.
        void api.refreshSession().catch(() => undefined);
        return;
      }
      if (stored.refreshToken !== refreshToken) adoptStored(stored);
    });
  }

  async function adopt(pair: SessionTokens, user: SessionUser): Promise<void> {
    // Web: o refresh novo já está no cookie. Nativo: o par vem no corpo (a validação do cliente o exige).
    const next = web ? COOKIE_MARKER : pair.refreshToken;
    if (next === undefined) throw new Error('resposta sem refresh token');
    refreshToken = next;
    // Persistir ANTES de expor o token novo: o refresh antigo já morreu no servidor.
    const stored: StoredSession = {
      ...(web ? {} : { refreshToken: next }),
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
    webSession: web,
    ...(options.crossOrigin !== undefined ? { crossOrigin: options.crossOrigin } : {}),
    auth: {
      getAccessToken: () => accessToken,
      getRefreshToken: () => refreshToken,
      async setTokens(pair) {
        const user = state.user;
        // Logout (ou refresh recusado) durante o voo: não ressuscita a sessão no armazenamento.
        if (web && user === null) {
          // Restauração no web: o usuário ainda não é conhecido (vem de `GET /me` logo depois).
          if (refreshToken === null) throw new SessionRequiredError();
          setAccess(pair.accessToken, pair.expiresIn);
          return;
        }
        if (user === null) throw new Error('sessão sem usuário');
        if (refreshToken === null) throw new SessionRequiredError();
        if (
          web &&
          subjectOf(pair.accessToken) !== null &&
          subjectOf(pair.accessToken) !== user.id
        ) {
          // O cookie é de OUTRO usuário (outra aba entrou em outra conta): adota o dono do token.
          setAccess(pair.accessToken, pair.expiresIn);
          void adoptTokenOwner();
          return;
        }
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

  /** `sub` do access (JWT) sem validar assinatura: só para saber de quem é o cookie. `null` se ilegível. */
  function subjectOf(token: string): string | null {
    try {
      const part = token.split('.')[1];
      if (part === undefined) return null;
      const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
      const json = JSON.parse(globalThis.atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))) as {
        sub?: unknown;
      };
      return typeof json.sub === 'string' ? json.sub : null;
    } catch {
      return null;
    }
  }

  /** Corrida de abas no web: relê `GET /me` com o access novo e passa a ser o usuário dono do token. */
  async function adoptTokenOwner(): Promise<void> {
    const gen = generation;
    try {
      const me = await api.me();
      if (gen !== generation || accessToken === null) return;
      if (state.user?.id === me.id) return;
      const user: SessionUser = { id: me.id, nickname: me.nickname, provider: me.provider };
      state = { ...state, user };
      await storage.save({ userId: user.id, nickname: user.nickname });
      providerTried = true;
      setState({ status: 'authenticated', user });
    } catch {
      // Sem `/me` agora: a próxima renovação confere de novo.
    }
  }

  async function createGuest(gen: number): Promise<void> {
    const res = await api.guest();
    if (gen !== generation) return; // logout durante a criação: não grava nada
    const user: SessionUser = { id: res.user.id, nickname: res.user.nickname, provider: 'guest' };
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

  /**
   * Restauração no web. Devolve `true` se terminou (autenticada ou `unavailable`); `false` cai para convidado.
   * 1) refresh LEGADO do `localStorage` (Fase 3): troca por cookie uma vez (`POST /auth/refresh` com corpo) e
   *    apaga o valor local; 2) senão, `POST /auth/refresh` com corpo vazio (cookie). O usuário vem de `GET /me`.
   */
  async function restoreWeb(gen: number, stored: StoredSession | null): Promise<boolean> {
    const stale = (): boolean => gen !== generation;
    let current = stored;
    let migrated: SessionTokens | null = null;
    let unavailable = false;
    if (stored?.refreshToken !== undefined) {
      // Dentro da trava entre abas: relê o armazenamento (outra aba pode já ter migrado) e, no sucesso,
      // grava a chave v2 e apaga a v1 NA HORA, antes de `me()` ou de qualquer outra espera.
      await refreshLock(async () => {
        let fresh: StoredSession | null;
        try {
          fresh = await storage.load();
        } catch {
          fresh = stored;
        }
        current = fresh;
        if (fresh?.refreshToken === undefined) return;
        try {
          migrated = await api.migrateLegacyRefresh(fresh.refreshToken);
          await storage.save({ userId: fresh.userId, nickname: fresh.nickname });
          current = { userId: fresh.userId, nickname: fresh.nickname };
        } catch (e) {
          if (isApiError(e) && e.status === 401) {
            await storage.clear(); // legado morto (revogado/expirado): cai no cookie, e depois em convidado
            current = null;
          } else {
            unavailable = true; // rede/503: o legado fica onde está
          }
        }
      });
      if (stale()) return true;
    }
    const hint: SessionUser | null =
      current === null ? null : { id: current.userId, nickname: current.nickname };
    if (unavailable) {
      setState({ status: 'unavailable', user: hint });
      return true;
    }
    state = { ...state, user: null };
    refreshToken = COOKIE_MARKER;
    const got = migrated as SessionTokens | null;
    if (got !== null) {
      setAccess(got.accessToken, got.expiresIn);
    } else {
      try {
        await api.refreshSession();
      } catch (e) {
        if (stale()) return true;
        if (isApiError(e) && e.status === 401) return false; // já tratado em onRefreshRejected
        setState({ status: 'unavailable', user: hint });
        return true;
      }
    }
    if (stale()) return true;
    let user: SessionUser;
    try {
      const me = await api.me();
      user = { id: me.id, nickname: me.nickname, provider: me.provider };
    } catch (e) {
      if (stale()) return true;
      if (hint === null || (isApiError(e) && e.status === 401)) {
        setState({ status: 'unavailable', user: hint });
        return true;
      }
      user = hint;
    }
    if (stale()) return true;
    state = { ...state, user };
    await storage.save({ userId: user.id, nickname: user.nickname }); // também apaga a chave legada
    if (stale()) return true;
    setState({ status: 'authenticated', user });
    return true;
  }

  async function run(gen: number): Promise<SessionState> {
    const stale = (): boolean => gen !== generation;
    providerTried = false; // restauração/login é evento explícito: libera uma nova leitura de /me
    setState({ status: 'restoring', user: state.user });
    try {
      const stored = await storage.load();
      if (stale()) return state;
      if (web) {
        const done = await restoreWeb(gen, stored);
        if (done) return state;
      } else if (stored !== null && stored.refreshToken !== undefined) {
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

  function loadProvider(): Promise<void> {
    const u = state.user;
    if (u === null || u.provider !== undefined || state.status !== 'authenticated') {
      return Promise.resolve();
    }
    // Uma chamada por vez e sem laço: falhou, só tenta de novo em `start()` (login ou restauração).
    if (providerLoad !== null) return providerLoad;
    if (providerTried) return Promise.resolve();
    providerTried = true;
    const p = (async () => {
      try {
        const me = await api.me();
        const cur = state.user;
        if (cur === null || cur.id !== u.id) return;
        setState({ status: state.status, user: { ...cur, provider: me.provider } });
      } catch {
        // Sem o tipo de conta a UI só esconde avisos que dependem dele.
      }
    })().finally(() => {
      if (providerLoad === p) providerLoad = null;
    });
    providerLoad = p;
    return p;
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
        if (toRevoke !== null) await api.logout(web ? undefined : { refreshToken: toRevoke });
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
    loadProvider,
    fetchNonce: () => api.nonce(),
    async deleteAccount() {
      await ensureAccessToken(); // renova antes: lê o refresh JÁ rotacionado
      const toRevoke = refreshToken;
      if (toRevoke === null) throw new SessionRequiredError();
      await api.deleteAccount(web ? undefined : toRevoke);
      generation += 1;
      starting = null;
      dropSession();
      try {
        await storage.clear();
      } finally {
        setState({ status: 'signedOut', user: null });
      }
    },
    async loginSocial(req) {
      const gen = generation;
      const res = await api.loginSocial(req);
      if (gen !== generation) return; // logout durante a chamada: descarta
      const oldRefresh = refreshToken;
      const user: SessionUser = {
        id: res.user.id,
        nickname: res.user.nickname,
        provider: req.provider,
      };
      // Melhor esforço: revoga a família do convidado que está sendo deixado para trás (ainda com o
      // access antigo). Falha (rede, 401) é ignorada; o refresh antigo expira sozinho.
      // No web a resposta já trocou o cookie pelo da conta nova: um logout agora revogaria a NOVA sessão.
      if (!web && oldRefresh !== null && state.user !== null && state.user.id !== user.id) {
        try {
          await ensureAccessToken();
          await api.logout({ refreshToken: refreshToken ?? oldRefresh });
        } catch {
          // Sem efeito sobre a entrada na conta nova.
        }
        if (gen !== generation) return;
      }
      state = { ...state, user };
      await adopt(res, user);
      providerTried = true; // o provedor já é conhecido
      setState({ status: 'authenticated', user });
    },
    async linkAccount(req) {
      const cur = state.user;
      if (cur === null) throw new SessionRequiredError();
      const gen = generation;
      await ensureAccessToken(); // o 401 do vínculo não é "access vencido": renova antes
      let res;
      try {
        res = await api.linkAccount(req);
      } catch (e) {
        if (isApiError(e) && e.code === 'ALREADY_LINKED' && gen === generation) {
          // A conta já tem provedor (outra aba ou aparelho): relê o tipo de conta em vez de ficar preso.
          const u = state.user;
          if (u !== null && u.id === cur.id) {
            providerTried = false;
            setState({ status: state.status, user: { id: u.id, nickname: u.nickname } });
            await loadProvider();
          }
        }
        throw e;
      }
      // Logout, apagar conta ou troca de usuário durante a chamada: não ressuscita a sessão.
      if (gen !== generation || state.user === null || state.user.id !== cur.id) return;
      const user: SessionUser = {
        id: res.user.id,
        nickname: res.user.nickname,
        provider: req.provider,
      };
      await adopt(res, user);
      if (gen !== generation) {
        dropSession();
        await storage.clear();
        return;
      }
      setState({ status: 'authenticated', user });
    },
    async setNickname(nickname) {
      const res = await api.updateNickname(nickname);
      const user = state.user;
      if (user === null) return;
      const next: SessionUser = { ...user, nickname: res.nickname };
      if (refreshToken !== null) {
        await storage.save({
          ...(web ? {} : { refreshToken }),
          userId: next.id,
          nickname: next.nickname,
        });
      }
      setState({ status: state.status, user: next });
    },
  };
}
