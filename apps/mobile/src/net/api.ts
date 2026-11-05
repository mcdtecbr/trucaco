/**
 * Cliente REST tipado do Trucaco. Sem UI e sem estado de tela.
 *
 * Regras de segurança (docs/protocolo-servidor.md, seção 1):
 * - o refresh é FILA ÚNICA: no máximo uma renovação em voo; chamadas concorrentes que recebem 401
 *   aguardam a mesma promessa e repetem UMA vez;
 * - o par novo é persistido (`auth.setTokens`) ANTES de qualquer requisição ser repetida;
 * - 503, falha de rede e timeout NUNCA descartam a sessão; só `401` no `/auth/refresh` a encerra;
 * - nada é logado: nem token, nem `Authorization`, nem corpo (principalmente de `/auth/*`).
 *
 * Modo web (`webSession`, docs/protocolo-servidor.md "Sessão do web"): o refresh vive num cookie httpOnly que o
 * JS nunca vê. As rotas `/auth/*` levam `X-Client: web` (e `credentials: 'include'` se a origem do servidor
 * difere da página), o refresh e o logout vão com corpo vazio e as respostas vêm sem `refreshToken`.
 */
import { WEB_CLIENT_HEADER, WEB_CLIENT_VALUE, isHttpErrorCode } from '@trucaco/protocol';
import type {
  AchievementsResponse,
  BlocksResponse,
  CreateTableRequest,
  CreateTableResponse,
  GuestAuthResponse,
  HealthResponse,
  HttpErrorCode,
  JoinTableResponse,
  LogoutRequest,
  MatchesPageResponse,
  MeResponse,
  MissionsResponse,
  PublicProfileResponse,
  QueueRequest,
  QueueStatusResponse,
  ReportRequest,
  SocialAuthRequest,
  SocialAuthResponse,
  TokenPairResponse,
  UpdateAvatarResponse,
  UpdateNicknameResponse,
} from '@trucaco/protocol';

export const DEFAULT_TIMEOUT_MS = 10_000;

export type ApiErrorKind = 'http' | 'unavailable' | 'network' | 'timeout' | 'invalid_response';
export type ApiErrorCode = HttpErrorCode | 'NETWORK' | 'TIMEOUT' | 'INVALID_RESPONSE' | 'UNKNOWN';

/** Erro da API. A mensagem é fixa e curta: nunca carrega token, URL com credencial nem corpo. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly kind: ApiErrorKind;
  /** `Retry-After` (segundos) quando o servidor enviou. */
  readonly retryAfterSeconds: number | undefined;

  constructor(init: {
    status: number;
    code: ApiErrorCode;
    kind: ApiErrorKind;
    retryAfterSeconds?: number;
  }) {
    super(`API ${init.kind} ${init.status} ${init.code}`);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.kind = init.kind;
    this.retryAfterSeconds = init.retryAfterSeconds;
  }

  /** Servidor ou rede indisponível (503/502/504, rede, timeout): manter a sessão e tentar depois. */
  get isUnavailable(): boolean {
    return this.kind === 'unavailable' || this.kind === 'network' || this.kind === 'timeout';
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

/** Par de tokens como a sessão o recebe: no web o `refreshToken` não vem (fica no cookie). */
export type SessionTokens = Omit<TokenPairResponse, 'refreshToken'> & {
  readonly refreshToken?: string;
};
type Loose<T extends TokenPairResponse> = Omit<T, 'refreshToken'> & {
  readonly refreshToken?: string;
};

/** Ponte com a sessão: guarda os tokens e decide o que fazer quando o refresh é recusado. */
export interface ApiAuth {
  getAccessToken(): string | null;
  getRefreshToken(): string | null;
  /** Deve persistir o par novo (refresh rotativo) e só então resolver. */
  setTokens(pair: SessionTokens): Promise<void>;
  /** `401` no `/auth/refresh`: a família morreu. */
  onRefreshRejected(): void | Promise<void>;
  /**
   * Opcional. Executa a renovação inteira (reler armazenamento + POST + gravar) em exclusão mútua
   * ENTRE abas (Web Locks). Sem isso, só a fila única dentro do processo protege.
   */
  exclusive?<T>(fn: () => Promise<T>): Promise<T>;
  /**
   * Opcional. Chamado dentro da exclusão, ANTES de ler `getRefreshToken()`: a sessão relê o armazenamento
   * e adota o refresh que outra aba já rotacionou (reapresentar o antigo é reuso e revoga a família).
   */
  beforeRefresh?(): Promise<void>;
}

export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal: AbortSignal;
    credentials: 'omit' | 'include' | 'same-origin';
  },
) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export interface ApiOptions {
  baseUrl: string;
  auth: ApiAuth;
  fetch?: FetchLike;
  timeoutMs?: number;
  /** Modo web: refresh em cookie httpOnly (ver o cabeçalho do arquivo). Padrão: nativo (par no corpo). */
  webSession?: boolean;
  /** Só no modo web: força (ou não) `credentials: 'include'` em `/auth/*`. Padrão: compara a origem com a da página. */
  crossOrigin?: boolean;
}

export interface ApiClient {
  guest(): Promise<Loose<GuestAuthResponse>>;
  /** Renovação em fila única. Resolve com o access novo. */
  refreshSession(): Promise<string>;
  /**
   * Troca um refresh LEGADO (do `localStorage` antigo) pelo cookie httpOnly: `POST /auth/refresh` com corpo e
   * `X-Client: web`. Só no modo web. Sem repetição; `401` sobe como erro (quem chama descarta o legado).
   */
  migrateLegacyRefresh(refreshToken: string): Promise<SessionTokens>;
  /** `GET /auth/nonce` (uso único, 300 s): vai ao provedor e volta em `loginSocial`/`linkAccount`. */
  nonce(): Promise<string>;
  /** Nativo: `{ refreshToken }`. Web: sem corpo (o servidor lê o cookie). */
  logout(body?: LogoutRequest): Promise<void>;
  health(): Promise<HealthResponse>;
  me(): Promise<MeResponse>;
  updateNickname(nickname: string): Promise<UpdateNicknameResponse>;
  updateAvatar(parts: Record<string, unknown>): Promise<UpdateAvatarResponse>;
  createTable(options: CreateTableRequest): Promise<CreateTableResponse>;
  joinTable(code: string): Promise<JoinTableResponse>;
  joinQueue(options: QueueRequest): Promise<QueueStatusResponse>;
  queueStatus(): Promise<QueueStatusResponse>;
  leaveQueue(): Promise<QueueStatusResponse>;
  /** Histórico do próprio usuário. `cursor` é opaco (vem de `nextCursor`). */
  matches(cursor?: string, limit?: number): Promise<MatchesPageResponse>;
  blocks(): Promise<BlocksResponse>;
  /** Idempotente. Vale na fila e nas próximas mesas, não na partida em andamento. */
  block(userId: string): Promise<void>;
  unblock(userId: string): Promise<void>;
  report(report: ReportRequest): Promise<void>;
  myAchievements(): Promise<AchievementsResponse>;
  myMissions(): Promise<MissionsResponse>;
  /** Perfil público de outro jogador (`GET /users/:id`). Nunca traz histórico nem provedor. */
  publicProfile(userId: string): Promise<PublicProfileResponse>;
  /** `POST /auth/google|apple` (sem Bearer). O convidado atual é substituído pela conta devolvida. */
  loginSocial(req: SocialAuthRequest): Promise<Loose<SocialAuthResponse>>;
  /**
   * `POST /auth/link` (Bearer, convidado). Devolve par novo (o servidor revoga as famílias antigas).
   * Sem repetição por 401: ele pode ser `INVALID_ID_TOKEN`; quem chama garante o access antes.
   */
  linkAccount(req: SocialAuthRequest): Promise<Loose<SocialAuthResponse>>;
  /**
   * Nativo: `DELETE /me` com o refresh como prova de acesso recente. Web: `DELETE /auth/account` sem corpo
   * (o cookie é a prova; o argumento é ignorado). Sem repetição por 401.
   */
  deleteAccount(refreshToken?: string): Promise<void>;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function parseJson(text: string): unknown {
  if (text === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** `needsRefresh`: o nativo exige o `refreshToken` no corpo; o web não o recebe (cookie). */
function isTokenPair(x: unknown, needsRefresh: boolean): x is SessionTokens {
  return (
    isRecord(x) &&
    typeof x['accessToken'] === 'string' &&
    x['accessToken'] !== '' &&
    (!needsRefresh || (typeof x['refreshToken'] === 'string' && x['refreshToken'] !== '')) &&
    typeof x['expiresIn'] === 'number' &&
    x['expiresIn'] > 0
  );
}

function isGuestResponse(x: unknown, needsRefresh: boolean): x is Loose<GuestAuthResponse> {
  if (!isTokenPair(x, needsRefresh)) return false;
  const user = (x as unknown as Record<string, unknown>)['user'];
  return isRecord(user) && typeof user['id'] === 'string' && typeof user['nickname'] === 'string';
}

function isSocialResponse(x: unknown, needsRefresh: boolean): x is Loose<SocialAuthResponse> {
  return (
    isGuestResponse(x, needsRefresh) &&
    typeof (x as unknown as Record<string, unknown>)['created'] === 'boolean'
  );
}

/** A página e o servidor estão em origens diferentes (dev: Metro em 8081, servidor em 2567). */
function differsFromPage(baseUrl: string): boolean {
  const page = (globalThis as { location?: { origin?: string } }).location?.origin;
  if (page === undefined || page === 'null') return false;
  try {
    return new URL(baseUrl).origin !== page;
  } catch {
    return false;
  }
}

function errorCodeOf(body: unknown): ApiErrorCode {
  if (isRecord(body) && isRecord(body['error'])) {
    const code = body['error']['code'];
    if (isHttpErrorCode(code)) return code;
  }
  return 'UNKNOWN';
}

function retryAfterOf(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function createApiClient(options: ApiOptions): ApiClient {
  const { auth } = options;
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const web = options.webSession === true;
  const needsRefresh = !web;
  const includeCookies = web && (options.crossOrigin ?? differsFromPage(baseUrl));
  const doFetch: FetchLike =
    options.fetch ?? ((url, init) => (globalThis.fetch as unknown as FetchLike)(url, init));

  async function raw(
    method: string,
    path: string,
    body: unknown,
    accessToken: string | null,
  ): Promise<unknown> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (accessToken !== null) headers['authorization'] = `Bearer ${accessToken}`;
    const isAuthRoute = web && (path === '/auth' || path.startsWith('/auth/'));
    if (isAuthRoute) headers[WEB_CLIENT_HEADER.toLowerCase()] = WEB_CLIENT_VALUE;

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    let status: number;
    let text: string;
    let retryAfter: string | null;
    try {
      const res = await doFetch(`${baseUrl}${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
        // Web: nunca `omit` em /auth/* (o navegador descartaria o Set-Cookie). Mesma origem: `same-origin`.
        credentials: isAuthRoute ? (includeCookies ? 'include' : 'same-origin') : 'omit',
      });
      status = res.status;
      retryAfter = res.headers.get('retry-after');
      text = await res.text();
    } catch {
      // Sem repassar a mensagem original: pode conter URL/host e nada acrescenta.
      throw new ApiError({
        status: 0,
        code: timedOut ? 'TIMEOUT' : 'NETWORK',
        kind: timedOut ? 'timeout' : 'network',
      });
    } finally {
      clearTimeout(timer);
    }

    const json = parseJson(text);
    if (status >= 200 && status < 300) {
      if (status === 204) return undefined;
      if (json === undefined) {
        throw new ApiError({ status, code: 'INVALID_RESPONSE', kind: 'invalid_response' });
      }
      return json;
    }
    const unavailable = status === 502 || status === 503 || status === 504;
    const code = errorCodeOf(json);
    const retryAfterSeconds = retryAfterOf(retryAfter);
    throw new ApiError({
      status,
      code: unavailable && code === 'UNKNOWN' ? 'SERVICE_UNAVAILABLE' : code,
      kind: unavailable ? 'unavailable' : 'http',
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    });
  }

  // ---- Refresh em fila única ----
  let inflight: Promise<string> | null = null;

  /**
   * Um POST /auth/refresh. Falha de transporte (timeout, rede) ou corpo inválido NÃO prova que o servidor
   * não rotacionou: o par novo pode ter se perdido no caminho. Por isso repete UMA vez, na hora, com o
   * MESMO refresh: dentro da janela de graça do servidor (20 s) ele devolve o par já emitido. Se a
   * segunda também falhar, o erro sobe e o refresh antigo continua guardado (a sessão não é descartada).
   * Limite conhecido: rede fora por mais de 20 s depois de um commit perdido => reuso => família revogada
   * (mitigação futura: graça maior no servidor).
   */
  async function postRefresh(refreshToken: string): Promise<SessionTokens> {
    for (let attempt = 0; ; attempt++) {
      try {
        // Web: corpo vazio, o servidor lê o cookie.
        const json = await raw('POST', '/auth/refresh', web ? undefined : { refreshToken }, null);
        if (!isTokenPair(json, needsRefresh)) {
          throw new ApiError({ status: 200, code: 'INVALID_RESPONSE', kind: 'invalid_response' });
        }
        return json;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          await auth.onRefreshRejected();
          throw e;
        }
        const lost =
          e instanceof ApiError &&
          (e.kind === 'timeout' || e.kind === 'network' || e.kind === 'invalid_response');
        if (lost && attempt === 0) continue;
        throw e;
      }
    }
  }

  async function doRefresh(): Promise<string> {
    const body = async (): Promise<string> => {
      await auth.beforeRefresh?.();
      const refreshToken = auth.getRefreshToken();
      if (refreshToken === null) {
        throw new ApiError({ status: 401, code: 'UNAUTHORIZED', kind: 'http' });
      }
      const pair = await postRefresh(refreshToken);
      await auth.setTokens(pair); // persistido ANTES de repetir qualquer chamada
      return pair.accessToken;
    };
    return auth.exclusive !== undefined ? auth.exclusive(body) : body();
  }

  async function migrateLegacyRefresh(refreshToken: string): Promise<SessionTokens> {
    if (!web) throw new Error('migrateLegacyRefresh só existe no modo web');
    const json = await raw('POST', '/auth/refresh', { refreshToken }, null);
    if (!isTokenPair(json, false)) {
      throw new ApiError({ status: 200, code: 'INVALID_RESPONSE', kind: 'invalid_response' });
    }
    return json;
  }

  function refreshSession(): Promise<string> {
    if (inflight !== null) return inflight;
    const p = doRefresh().finally(() => {
      if (inflight === p) inflight = null;
    });
    inflight = p;
    return p;
  }

  async function authed<T>(
    method: string,
    path: string,
    body?: unknown,
    opts: { refreshOn401?: boolean } = {},
  ): Promise<T> {
    const used = auth.getAccessToken() ?? (await refreshSession());
    try {
      return (await raw(method, path, body, used)) as T;
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401 || opts.refreshOn401 === false) throw e;
      // Se outra chamada já renovou enquanto esta voava, só repete com o token atual.
      const current = auth.getAccessToken();
      const fresh = current !== null && current !== used ? current : await refreshSession();
      return (await raw(method, path, body, fresh)) as T; // uma única repetição
    }
  }

  return {
    async guest() {
      const json = await raw('POST', '/auth/guest', undefined, null);
      if (!isGuestResponse(json, needsRefresh)) {
        throw new ApiError({ status: 201, code: 'INVALID_RESPONSE', kind: 'invalid_response' });
      }
      return json;
    },
    refreshSession,
    migrateLegacyRefresh,
    async nonce() {
      const json = await raw('GET', '/auth/nonce', undefined, null);
      const value = isRecord(json) ? json['nonce'] : undefined;
      if (typeof value !== 'string' || value === '') {
        throw new ApiError({ status: 200, code: 'INVALID_RESPONSE', kind: 'invalid_response' });
      }
      return value;
    },
    async logout(body) {
      await authed<undefined>('POST', '/auth/logout', web ? undefined : body, {
        refreshOn401: false,
      });
    },
    health: () => raw('GET', '/health', undefined, null) as Promise<HealthResponse>,
    me: () => authed<MeResponse>('GET', '/me'),
    updateNickname: (nickname) => authed<UpdateNicknameResponse>('PUT', '/me', { nickname }),
    updateAvatar: (parts) => authed<UpdateAvatarResponse>('PUT', '/me/avatar', { parts }),
    createTable: (opts) => authed<CreateTableResponse>('POST', '/tables', opts),
    joinTable: (code) => authed<JoinTableResponse>('POST', '/tables/join', { code }),
    joinQueue: (opts) => authed<QueueStatusResponse>('POST', '/queue', opts),
    queueStatus: () => authed<QueueStatusResponse>('GET', '/queue'),
    leaveQueue: () => authed<QueueStatusResponse>('POST', '/queue/leave'),
    matches(cursor, limit) {
      const q = new URLSearchParams();
      if (limit !== undefined) q.set('limit', String(limit));
      if (cursor !== undefined) q.set('cursor', cursor);
      const qs = q.toString();
      return authed<MatchesPageResponse>('GET', qs === '' ? '/matches' : `/matches?${qs}`);
    },
    blocks: () => authed<BlocksResponse>('GET', '/me/blocks'),
    async block(userId) {
      await authed<undefined>('POST', '/me/blocks', { userId });
    },
    async unblock(userId) {
      await authed<undefined>('DELETE', `/me/blocks/${encodeURIComponent(userId)}`);
    },
    async report(report) {
      await authed<unknown>('POST', '/reports', report);
    },
    myAchievements: () => authed<AchievementsResponse>('GET', '/me/achievements'),
    myMissions: () => authed<MissionsResponse>('GET', '/me/missions'),
    publicProfile: (userId) =>
      authed<PublicProfileResponse>('GET', `/users/${encodeURIComponent(userId)}`),
    async loginSocial(req) {
      const json = await raw('POST', `/auth/${req.provider}`, req, null);
      if (!isSocialResponse(json, needsRefresh)) {
        throw new ApiError({ status: 200, code: 'INVALID_RESPONSE', kind: 'invalid_response' });
      }
      return json;
    },
    async linkAccount(req) {
      const json = await authed<unknown>('POST', '/auth/link', req, { refreshOn401: false });
      if (!isSocialResponse(json, needsRefresh)) {
        throw new ApiError({ status: 200, code: 'INVALID_RESPONSE', kind: 'invalid_response' });
      }
      return json;
    },
    async deleteAccount(refreshToken) {
      if (web) {
        await authed<undefined>('DELETE', '/auth/account', undefined, { refreshOn401: false });
        return;
      }
      await authed<undefined>('DELETE', '/me', { refreshToken }, { refreshOn401: false });
    },
  };
}
