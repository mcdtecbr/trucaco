/**
 * Contrato REST/handshake (cliente <-> servidor): códigos de erro HTTP, formas de resposta e constantes.
 * Só tipos e constantes (sem rede). As formas foram conferidas contra `apps/server/src/http/rest.ts`,
 * `lobbyRoutes.ts`, `lobby/lobby.ts` e `auth/authService.ts`; o teste de contrato do servidor
 * (`http/httpContract.test.ts`) quebra se um código novo aparecer no servidor sem entrada aqui.
 */
import type { AvatarParts } from './avatar';
import type { Format, RoomOptions, Visibility } from './room';

/**
 * Códigos que o servidor emite em `{ error: { code } }` (REST) ou como erro de handshake de sala
 * (`ServerError`). Conjunto = catálogo congelado em `apps/server/src/errorCodes.contract.test.ts`
 * mais `INVALID_REFRESH_TOKEN` (emitido por variável, em `/auth/refresh`) e `BO3_REQUIRES_PRIVATE`
 * (vem de `validateRoomOptions`). Em ordem alfabética.
 */
export const HTTP_ERROR_CODES = [
  'ALREADY_IN_TABLE',
  'ALREADY_SEATED',
  'BANNED',
  'BO3_REQUIRES_PRIVATE',
  'CORS_FORBIDDEN',
  'FORBIDDEN',
  'INTERNAL',
  'INVALID_AVATAR',
  'INVALID_BODY',
  'INVALID_CODE',
  'INVALID_CODES',
  'INVALID_INPUT',
  'INVALID_JSON',
  'INVALID_NICKNAME',
  'INVALID_OPTIONS',
  'INVALID_PARTNER',
  'INVALID_REFRESH_TOKEN',
  'METHOD_NOT_ALLOWED',
  'NICKNAME_TAKEN',
  'NOT_FOUND',
  'NOT_IMPLEMENTED',
  'NOT_PARTNERS',
  'PAYLOAD_TOO_LARGE',
  'QUEUE_COOLDOWN',
  'QUEUE_FULL',
  'RATE_LIMITED',
  'ROOM_FULL',
  'SERVICE_UNAVAILABLE',
  'TABLE_UNAVAILABLE',
  'UNAUTHORIZED',
  'UNAVAILABLE',
  'UNSUPPORTED_MEDIA_TYPE',
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
