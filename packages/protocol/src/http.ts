/**
 * Contrato REST/handshake (cliente <-> servidor): códigos de erro HTTP, formas de resposta e constantes.
 * Só tipos e constantes (sem rede). As formas foram conferidas contra `apps/server/src/http/rest.ts`,
 * `lobbyRoutes.ts`, `lobby/lobby.ts` e `auth/authService.ts`; o teste de contrato do servidor
 * (`http/httpContract.test.ts`) quebra se um código novo aparecer no servidor sem entrada aqui.
 */
import type { AvatarParts } from './avatar';
import { cleanFreeText } from './messages';
import type { VariantId } from './catalogs';
import type { PublicAchievement, UserAchievement, UserMission } from './gamification';
import type { Format, RoomOptions, Visibility } from './room';

/**
 * Códigos que o servidor emite em `{ error: { code } }` (REST) ou como erro de handshake de sala
 * (`ServerError`). Conjunto = catálogo congelado em `apps/server/src/errorCodes.contract.test.ts`
 * mais `INVALID_REFRESH_TOKEN` (emitido por variável, em `/auth/refresh`) e `BO3_REQUIRES_PRIVATE`
 * (vem de `validateRoomOptions`). Em ordem alfabética.
 * Fase 6 (contrato 6A; todos emitidos desde o 6F): `ALREADY_LINKED` (409),
 * `INVALID_BLOCK` (400), `INVALID_ID_TOKEN` (401), `INVALID_REPORT` (400), `PROVIDER_TAKEN` (409),
 * `SOCIAL_LOGIN_DISABLED` (503) e `USER_NOT_FOUND` (404). `NOT_IMPLEMENTED` (501) não é mais emitido
 * (era o stub de `/auth/link|google|apple`); fica na lista por compatibilidade com o cliente.
 */
export const HTTP_ERROR_CODES = [
  'ALREADY_IN_TABLE',
  'ALREADY_LINKED',
  'ALREADY_SEATED',
  'BANNED',
  'BO3_REQUIRES_PRIVATE',
  'CORS_FORBIDDEN',
  'FORBIDDEN',
  'INTERNAL',
  'INVALID_AVATAR',
  'INVALID_BLOCK',
  'INVALID_BODY',
  'INVALID_CODE',
  'INVALID_CODES',
  'INVALID_ID_TOKEN',
  'INVALID_INPUT',
  'INVALID_JSON',
  'INVALID_NICKNAME',
  'INVALID_OPTIONS',
  'INVALID_PARTNER',
  'INVALID_REFRESH_TOKEN',
  'INVALID_REPORT',
  'METHOD_NOT_ALLOWED',
  'NICKNAME_TAKEN',
  'NOT_FOUND',
  'NOT_IMPLEMENTED',
  'NOT_PARTNERS',
  'PAYLOAD_TOO_LARGE',
  'PROVIDER_TAKEN',
  'QUEUE_COOLDOWN',
  'QUEUE_FULL',
  'RATE_LIMITED',
  'ROOM_FULL',
  'SERVICE_UNAVAILABLE',
  'SOCIAL_LOGIN_DISABLED',
  'TABLE_UNAVAILABLE',
  'UNAUTHORIZED',
  'UNAVAILABLE',
  'UNSUPPORTED_MEDIA_TYPE',
  'USER_NOT_FOUND',
  'USE_LOBBY',
] as const;

export type HttpErrorCode = (typeof HTTP_ERROR_CODES)[number];

export function isHttpErrorCode(x: unknown): x is HttpErrorCode {
  return typeof x === 'string' && (HTTP_ERROR_CODES as readonly string[]).includes(x);
}

/** Corpo de toda resposta de erro do servidor. `code` pode ser desconhecido de um servidor mais novo. */
export interface ApiError {
  readonly error: { readonly code: string };
}

/**
 * Reserva de assento devolvida pelo lobby; o cliente a entrega intacta a `client.consumeSeatReservation`.
 * Estrutural e própria (ui/mobile não dependem do SDK no tipo). Os campos opcionais existem no objeto
 * real do Colyseus (`processId` sempre; `publicAddress`/`devMode` conforme o ambiente): repassar tudo.
 */
export interface SeatReservation {
  readonly name: string;
  readonly sessionId: string;
  readonly roomId: string;
  readonly processId?: string;
  readonly publicAddress?: string;
  readonly devMode?: boolean;
  /** Presente em reservas de reconexão (`allowReconnection`); repassar intacto também. */
  readonly reconnectionToken?: string;
}

/** Validade da reserva de assento, em segundos (padrão do core Colyseus; o servidor não o altera). */
export const RESERVATION_TTL_SECONDS = 15;

/** Subprotocolo WebSocket: `Sec-WebSocket-Protocol: trucaco.bearer, <jwt>` (browsers não põem cabeçalhos). */
export const WS_BEARER_PROTOCOL = 'trucaco.bearer';

export type AuthProvider = 'guest' | 'google' | 'apple';

/** Par de tokens (`/auth/guest` e `/auth/refresh`). `expiresIn` = validade do access, em segundos. */
export interface TokenPairResponse {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
}

/**
 * Sessão do WEB (requisição com `X-Client: web`): o refresh vai em cookie httpOnly e NÃO vem no corpo.
 * Vale para `/auth/guest`, `/auth/refresh`, `/auth/google|apple` e `/auth/link`: o corpo é a resposta
 * normal sem `refreshToken`. O nativo (sem o cabeçalho) segue recebendo o par completo.
 */
export type WebSessionResponse<T extends TokenPairResponse = TokenPairResponse> = Omit<
  T,
  'refreshToken'
> & { readonly refreshToken?: never };

/** Cabeçalho que marca o cliente web (força preflight CORS entre origens e liga o cookie do refresh). */
export const WEB_CLIENT_HEADER = 'X-Client';
export const WEB_CLIENT_VALUE = 'web';
/** Cookie httpOnly do refresh no web: `HttpOnly; SameSite=Strict; Path=/auth` (`Secure` fora de dev). */
export const REFRESH_COOKIE_NAME = 'refresh';
export const REFRESH_COOKIE_PATH = '/auth';

/** `POST /auth/guest` -> 201. */
export interface GuestAuthResponse extends TokenPairResponse {
  readonly user: { readonly id: string; readonly nickname: string };
}

/** `POST /auth/refresh` (corpo `{ refreshToken }`) -> 200. */
export type RefreshResponse = TokenPairResponse;

/** `GET /me` -> 200. */
export interface MeResponse {
  readonly id: string;
  readonly nickname: string;
  readonly provider: AuthProvider;
  /** `null` quando não há avatar gravado ou o gravado é inválido (o cliente usa `DEFAULT_AVATAR_PARTS`). */
  readonly avatar: AvatarParts | null;
  /** ISO 8601. */
  readonly createdAt: string;
  /** Partidas e vitórias por variante (só partidas terminadas e contadas pela Fase 6). */
  readonly stats: UserStats;
}

/** `PUT /me` (corpo `{ nickname }`) -> 200. */
export interface UpdateNicknameResponse {
  readonly nickname: string;
}

/** `PUT /me/avatar` (corpo `{ parts }`) -> 200. */
export interface UpdateAvatarResponse {
  readonly avatar: AvatarParts;
}

/** `GET|PUT /me/partners/:partnerId/codes` -> 200. */
export interface PartnerCodesResponse {
  readonly codes: Record<string, unknown>;
}

/** `POST /tables` (corpo `RoomOptions` privado) -> 201. */
export interface CreateTableResponse {
  readonly code: string;
  readonly reservation: SeatReservation;
}

/** `POST /tables/join` (corpo `{ code }`) -> 200. */
export interface JoinTableResponse {
  readonly reservation: SeatReservation;
}

/**
 * `POST /queue`, `GET /queue`, `POST /queue/leave` -> 200. `expiresAt` = epoch ms em que a entrada
 * na fila expira; `matched` traz a reserva a consumir em até `RESERVATION_TTL_SECONDS`.
 */
export type QueueStatusResponse =
  | { readonly status: 'idle' }
  | { readonly status: 'queued'; readonly expiresAt: number }
  | { readonly status: 'matched'; readonly reservation: SeatReservation }
  | { readonly status: 'seated' };

/** `GET /health` -> 200. */
export interface HealthResponse {
  readonly status: 'ok';
  readonly protocol: number;
  /** Provedores de login social ligados neste servidor (vazio = só convidado). O cliente esconde os botões dos outros. */
  readonly socialProviders: readonly SocialProvider[];
}

/** Corpos de requisição, para o cliente tipar o que envia. */
export type CreateTableRequest = RoomOptions & {
  readonly visibility: Extract<Visibility, 'private'>;
};
export type QueueRequest = RoomOptions & {
  readonly visibility: Extract<Visibility, 'public'>;
  readonly format: Extract<Format, 'single'>;
};
export interface RefreshRequest {
  readonly refreshToken: string;
}
/**
 * `POST /auth/logout` (autenticado) -> 204 sem corpo. Exatamente uma chave: `refreshToken` revoga a
 * família dele (se for do usuário do JWT; inválido ou alheio também dá 204, sem oráculo) e `all: true`
 * revoga todas as famílias do usuário. Em ambos o access apresentado é invalidado.
 */
export type LogoutRequest = { readonly refreshToken: string } | { readonly all: true };
export interface JoinTableRequest {
  readonly code: string;
}

// ---------------------------------------------------------------------------------------------
// Fase 6 (contrato 6A): login social, vínculo, perfil, histórico, bloqueio, denúncia, conquistas.
// ---------------------------------------------------------------------------------------------

/** Caminhos REST da Fase 6 (relativos à raiz da API). `:id` e `:userId` são UUID. */
export const HTTP_ROUTES = {
  authGoogle: '/auth/google',
  authApple: '/auth/apple',
  authLink: '/auth/link',
  authNonce: '/auth/nonce',
  /** `DELETE` com o refresh do cookie (web); o nativo segue em `DELETE /me` com `{ refreshToken }`. */
  authAccount: '/auth/account',
  matches: '/matches',
  myAchievements: '/me/achievements',
  myMissions: '/me/missions',
  myBlocks: '/me/blocks',
  myBlock: '/me/blocks/:userId',
  deleteMe: '/me',
  publicProfile: '/users/:id',
  reports: '/reports',
} as const;

export const SOCIAL_PROVIDERS = ['google', 'apple'] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

/** Limites de entrada (validados antes de qualquer lógica; o servidor reaplica o rate limit). */
export const ID_TOKEN_MAX_LENGTH = 4096;
export const NONCE_MAX_LENGTH = 128;
/** Validade do nonce de `GET /auth/nonce` (uso único), em segundos. */
export const NONCE_TTL_SECONDS = 300;
export const REFRESH_TOKEN_MAX_LENGTH = 1024;
export const REPORT_TEXT_MAX_LENGTH = 500;
/** Denúncias por usuário por hora (rate limit no servidor, em memória do processo). */
export const REPORT_RATE_LIMIT_PER_HOUR = 5;
/** Paginação de `GET /matches` (`?limit=&cursor=`): espelho do repositório. */
export const MATCHES_PAGE_DEFAULT = 20;
export const MATCHES_PAGE_MAX = 50;

/**
 * Motivos de denúncia. Espelham `ReportReasonId` do servidor e o enum `report_reason` do banco
 * (sem migração).
 */
export const REPORT_REASONS = [
  'cheating',
  'abusive_chat',
  'offensive_nickname',
  'harassment',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** `GET /auth/nonce` -> 200 (sem Bearer, limitado por IP). `503 SOCIAL_LOGIN_DISABLED` sem provedor ligado. */
export interface NonceResponse {
  /** Aleatório, de uso único, vale `expiresIn` segundos. Vai ao provedor no pedido do idToken. */
  readonly nonce: string;
  readonly expiresIn: number;
}

/**
 * `POST /auth/google` e `POST /auth/apple` (sem Bearer): `provider` tem de bater com a rota. O `nonce` é
 * OBRIGATÓRIO: pegue em `GET /auth/nonce`, mande ao provedor e reenvie o mesmo aqui. A claim `nonce` do
 * idToken tem de ser igual a ele (Apple também aceita o SHA-256 em hex dele).
 */
export interface SocialAuthRequest {
  readonly provider: SocialProvider;
  /** JWT de identidade emitido pelo provedor. Uso único. Nunca logar. */
  readonly idToken: string;
  /** Nonce emitido por `GET /auth/nonce`. Uso único. */
  readonly nonce: string;
}

/** `POST /auth/link` (Bearer, convidado): mesma forma do login social; o `userId` vem do token. */
export type LinkRequest = SocialAuthRequest;

/** `POST /auth/google|apple` -> 200 (conta existente) ou 201 (`created: true`); `POST /auth/link` -> 200. */
export type SocialAuthResponse = TokenPairResponse & {
  readonly user: { readonly id: string; readonly nickname: string };
  readonly created: boolean;
};

/** `DELETE /me` (Bearer) -> 204. Exige o refresh token como prova de acesso recente. */
export interface DeleteAccountRequest {
  readonly refreshToken: string;
}

export interface VariantStats {
  readonly played: number;
  readonly won: number;
}
export type UserStats = Readonly<Record<VariantId, VariantStats>>;

/** `GET /users/:id` -> 200. Nunca traz histórico, provedor nem datas. */
export interface PublicProfileResponse {
  readonly id: string;
  readonly nickname: string;
  readonly avatar: AvatarParts | null;
  /** Só as desbloqueadas (nível >= 1). */
  readonly achievements: readonly PublicAchievement[];
  readonly stats: UserStats;
}

export interface MatchSummaryPlayerResponse {
  readonly seat: number;
  readonly team: 0 | 1;
  readonly userId: string | null;
  /** `null` para bot ou usuário removido. */
  readonly nickname: string | null;
  readonly botFrom: number | null;
}

/** Item de `GET /matches`: sem `events`, `deals` nem `seed`. Datas em ISO 8601. */
export interface MatchSummaryResponse {
  readonly id: string;
  readonly variant: VariantId;
  readonly format: Format;
  readonly ironHand: boolean;
  readonly visibility: Visibility;
  readonly status: 'finished' | 'cancelled';
  readonly winnerTeam: 0 | 1 | null;
  /** Resumo por jogo da série (JSON do servidor; o cliente trata como opaco ou valida o que usa). */
  readonly games: readonly unknown[];
  readonly startedAt: string;
  readonly endedAt: string;
  readonly players: readonly MatchSummaryPlayerResponse[];
}

/** `GET /matches?limit=&cursor=` (Bearer) -> 200. Só as partidas do próprio usuário. */
export interface MatchesPageResponse {
  readonly items: readonly MatchSummaryResponse[];
  /** `null` na última página; opaco para o cliente. */
  readonly nextCursor: string | null;
}

/** `POST /reports` (Bearer) -> 201 `{}` (sem eco do que foi gravado). */
export interface ReportRequest {
  readonly userId: string;
  readonly matchId?: string;
  readonly reason: ReportReason;
  readonly text?: string;
}

/** `POST /me/blocks` (Bearer) -> 204. Idempotente. */
export interface BlockRequest {
  readonly userId: string;
}

export interface BlockedUser {
  readonly userId: string;
  /** `null` se o bloqueado apagou a conta. */
  readonly nickname: string | null;
}

/** `GET /me/blocks` -> 200. */
export interface BlocksResponse {
  readonly blocks: readonly BlockedUser[];
}

/** `GET /me/achievements` -> 200: o catálogo inteiro, com progresso (nível 0 = bloqueada). */
export interface AchievementsResponse {
  readonly achievements: readonly UserAchievement[];
}

/** `GET /me/missions` -> 200: missões do dia e da semana corrente. */
export interface MissionsResponse {
  readonly missions: readonly UserMission[];
}

// --- Validadores de corpo (puros; `null` = inválido). Mesma postura de `parseAvatarParts`:
// objeto simples, sem chave extra (inclui `__proto__`, que o JSON.parse cria como chave própria),
// tipos e limites exatos. O servidor responde `INVALID_BODY` (ou o código específico) em `null`.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(x: unknown): x is string {
  return typeof x === 'string' && UUID_RE.test(x);
}

/** UUID em minúsculas (forma canônica, igual a `normalizeId` do servidor) ou `null`. */
export function normalizeUuid(x: unknown): string | null {
  return isUuid(x) ? x.toLowerCase() : null;
}

/** Objeto simples cujas chaves próprias estão todas em `allowed`; senão `null`. */
function plainRecord(raw: unknown, allowed: readonly string[]): Record<string, unknown> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const proto: unknown = Object.getPrototypeOf(raw);
  if (proto !== Object.prototype && proto !== null) return null;
  const rec = raw as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    if (!allowed.includes(key)) return null;
  }
  return rec;
}

function boundedString(x: unknown, max: number): x is string {
  return typeof x === 'string' && x.length >= 1 && x.length <= max;
}

export function isSocialProvider(x: unknown): x is SocialProvider {
  return typeof x === 'string' && (SOCIAL_PROVIDERS as readonly string[]).includes(x);
}

export function isReportReason(x: unknown): x is ReportReason {
  return typeof x === 'string' && (REPORT_REASONS as readonly string[]).includes(x);
}

/** Valida o corpo de `POST /auth/google|apple|link`. */
export function parseSocialAuthRequest(raw: unknown): SocialAuthRequest | null {
  const rec = plainRecord(raw, ['provider', 'idToken', 'nonce']);
  if (rec === null) return null;
  const { provider, idToken } = rec;
  if (!isSocialProvider(provider)) return null;
  if (!boundedString(idToken, ID_TOKEN_MAX_LENGTH)) return null;
  const nonce = rec['nonce'];
  if (!boundedString(nonce, NONCE_MAX_LENGTH)) return null;
  return { provider, idToken, nonce };
}

export const parseLinkRequest: (raw: unknown) => LinkRequest | null = parseSocialAuthRequest;

/** Valida o corpo de `DELETE /me`. */
export function parseDeleteAccountRequest(raw: unknown): DeleteAccountRequest | null {
  const rec = plainRecord(raw, ['refreshToken']);
  if (rec === null) return null;
  const refreshToken = rec['refreshToken'];
  if (!boundedString(refreshToken, REFRESH_TOKEN_MAX_LENGTH)) return null;
  return { refreshToken };
}

/** Valida o corpo de `POST /me/blocks`. */
export function parseBlockRequest(raw: unknown): BlockRequest | null {
  const rec = plainRecord(raw, ['userId']);
  if (rec === null) return null;
  const userId = normalizeUuid(rec['userId']);
  if (userId === null) return null;
  return { userId };
}

/**
 * Valida o corpo de `POST /reports`. Ids saem em minúsculas. `text` passa pela limpeza do chat (NUL,
 * controles, bidi e formatação são recusados; quebras viram espaço; devolve o texto limpo) e vazio é
 * recusado (omita a chave).
 */
export function parseReportRequest(raw: unknown): ReportRequest | null {
  const rec = plainRecord(raw, ['userId', 'matchId', 'reason', 'text']);
  if (rec === null) return null;
  const userId = normalizeUuid(rec['userId']);
  const reason = rec['reason'];
  if (userId === null || !isReportReason(reason)) return null;
  let matchId: string | undefined;
  if (Object.hasOwn(rec, 'matchId')) {
    const m = normalizeUuid(rec['matchId']);
    if (m === null) return null;
    matchId = m;
  }
  let text: string | undefined;
  if (Object.hasOwn(rec, 'text')) {
    const rawText = rec['text'];
    if (typeof rawText !== 'string') return null;
    const t = cleanFreeText(rawText, REPORT_TEXT_MAX_LENGTH);
    if (t === null) return null;
    text = t;
  }
  return {
    userId,
    reason,
    ...(matchId === undefined ? {} : { matchId }),
    ...(text === undefined ? {} : { text }),
  };
}
