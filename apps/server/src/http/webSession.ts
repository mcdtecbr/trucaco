/**
 * Sessão do cliente WEB: o refresh token vai em cookie httpOnly em vez do corpo (o JavaScript da página
 * nunca o vê, então XSS não o rouba). Contrato (documentado em `docs/protocolo-servidor.md`):
 *
 * - Cliente web = requisição com `X-Client: web`. Sem o cabeçalho (nativo, curl, testes) nada muda: o par
 *   vem no corpo e o cookie é IGNORADO.
 * - Resposta ao web: `Set-Cookie: refresh=<token>; Max-Age; Path=/auth; HttpOnly; SameSite=Strict`
 *   (`Secure` fora de dev) e o corpo SEM `refreshToken`.
 * - `/auth/refresh`, `/auth/logout` e `/auth/account` leem o refresh do cookie quando o corpo vem vazio.
 * - Defesa de CSRF: o cabeçalho customizado já força preflight entre origens e o cookie é `SameSite=Strict`;
 *   além disso toda rota de auth do web exige `Origin` igual ao próprio host ou em `CORS_ORIGINS` (e `Origin`
 *   presente quando há cookie).
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import {
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
  WEB_CLIENT_HEADER,
  WEB_CLIENT_VALUE,
} from '@trucaco/protocol';

/** `X-Client: web`. */
export function isWebClient(req: Request): boolean {
  return req.get(WEB_CLIENT_HEADER)?.trim().toLowerCase() === WEB_CLIENT_VALUE;
}

/** Valor do cookie `refresh` (`undefined` se ausente). Só lê; sem decodificar nada além do básico. */
export function refreshFromCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (typeof header !== 'string') return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== REFRESH_COOKIE_NAME) continue;
    const value = part.slice(eq + 1).trim();
    return value === '' ? undefined : value;
  }
  return undefined;
}

const attributes = (secure: boolean): string =>
  `Path=${REFRESH_COOKIE_PATH}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;

export function setRefreshCookie(
  res: Response,
  token: string,
  maxAgeSec: number,
  secure: boolean,
): void {
  res.append(
    'Set-Cookie',
    `${REFRESH_COOKIE_NAME}=${token}; Max-Age=${Math.max(1, Math.floor(maxAgeSec))}; ${attributes(secure)}`,
  );
}

export function clearRefreshCookie(res: Response, secure: boolean): void {
  res.append(
    'Set-Cookie',
    `${REFRESH_COOKIE_NAME}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; ${attributes(secure)}`,
  );
}

/** A origem é a do próprio servidor (mesmo `host`) ou está na lista exata de `CORS_ORIGINS`? */
export function isAllowedOrigin(
  origin: string,
  host: string | undefined,
  allowed: ReadonlySet<string>,
): boolean {
  if (allowed.has(origin)) return true;
  if (host === undefined || host === '') return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  return (url.protocol === 'http:' || url.protocol === 'https:') && url.host === host;
}

/**
 * Guarda das rotas de auth do web. Cliente não web: passa direto (o cookie é ignorado depois). Web:
 * `Origin` presente tem de ser permitida; sem `Origin`, só passa se NÃO houver cookie `refresh` (navegador
 * sempre manda `Origin` no POST, então a ausência com cookie é suspeita). Falha: `403 CORS_FORBIDDEN`.
 */
export function webOriginGuard(corsOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(corsOrigins);
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isWebClient(req)) {
      next();
      return;
    }
    const origin = req.headers.origin;
    const ok =
      origin === undefined
        ? refreshFromCookie(req) === undefined
        : isAllowedOrigin(origin, req.headers.host, allowed);
    if (ok) {
      next();
      return;
    }
    res.status(403).json({ error: { code: 'CORS_FORBIDDEN' } });
  };
}
