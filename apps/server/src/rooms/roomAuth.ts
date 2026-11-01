/**
 * Autenticação das SALAS. O `static onAuth` do Colyseus não tem acesso à instância do servidor, então
 * as dependências (serviço de auth e repositório) ficam registradas aqui, uma vez por processo
 * (`configureRoomAuth`, chamado por `buildColyseusServer`). Sem configuração: tudo é recusado.
 *
 * Fonte da identidade: JWT de acesso no cabeçalho `Authorization: Bearer` da requisição de matchmaking
 * (ou, no upgrade da reconexão, no cabeçalho/subprotocolo). NUNCA na query string. `userId`, apelido e
 * avatar vêm do banco, nunca do payload do cliente. `devAuth` (userId/apelido do payload e token
 * `dev:<id>`) só existe com `allowDevAuth` E `NODE_ENV` explícito development/test.
 */
import type { UserRepository } from '../db/types';
import type { AuthService } from '../auth/authService';
import { AuthError, bearerFromHeader } from '../auth/authService';
import { isDevLike } from '../auth/config';
import { log } from '../logger';

export interface RoomAuthDeps {
  readonly auth: AuthService | null;
  readonly users: UserRepository | null;
  /** Aceita `devAuth` (identidade sem prova). Só com `NODE_ENV` development/test. */
  readonly allowDevAuth: boolean;
}

let current: RoomAuthDeps | null = null;

export function configureRoomAuth(
  deps: RoomAuthDeps | null,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): void {
  if (deps?.allowDevAuth === true && !isDevLike(nodeEnv)) {
    throw new Error('devAuth só pode ser habilitado com NODE_ENV=development ou test.');
  }
  current = deps;
}

export function getRoomAuth(): RoomAuthDeps | null {
  return current;
}

export const USER_ID_MAX = 64;

/** `dev:<userId>`: identidade provisória de testes. Só vale com `allowDevAuth` + dev/test. */
export function devReconnectUserId(
  token: string | null | undefined,
  nodeEnv: string | undefined,
): string | undefined {
  if (!isDevLike(nodeEnv)) return undefined;
  if (typeof token !== 'string' || !token.startsWith('dev:')) return undefined;
  const userId = token.slice(4);
  return userId.length > 0 && userId.length <= USER_ID_MAX ? userId : undefined;
}

export type Identity =
  | { readonly ok: true; readonly userId: string }
  | { readonly ok: false; readonly reason: 'missing' | 'invalid' | 'unavailable' };

/**
 * Resolve o `userId` de um token apresentado (JWT; ou `dev:` quando permitido). `missing` = nada foi
 * apresentado (cliente deve autenticar); `invalid` = apresentado mas recusado (inclui expirado: o
 * cliente tenta `/auth/refresh`); `unavailable` = Redis/banco fora do ar (503, não 401: o cliente não
 * deve descartar a sessão).
 */
export async function identityFromToken(
  token: string | undefined,
  deps: RoomAuthDeps | null = current,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): Promise<Identity> {
  if (token === undefined) return { ok: false, reason: 'missing' };
  if (deps === null) return { ok: false, reason: 'invalid' };
  if (deps.allowDevAuth) {
    const dev = devReconnectUserId(token, nodeEnv);
    if (dev !== undefined) return { ok: true, userId: dev };
  }
  if (deps.auth === null) return { ok: false, reason: 'invalid' };
  try {
    const principal = await deps.auth.authenticateAccess(token);
    return { ok: true, userId: principal.userId };
  } catch (err) {
    if (err instanceof AuthError) return { ok: false, reason: 'invalid' };
    log.error('roomAuth: dependência indisponível', {
      name: err instanceof Error ? err.name : '?',
    });
    return { ok: false, reason: 'unavailable' };
  }
}

/** Token do cabeçalho `Authorization` de um `Headers`. */
export const tokenFromHeaders = (headers: Headers | undefined): string | undefined =>
  bearerFromHeader(headers?.get('authorization'));
