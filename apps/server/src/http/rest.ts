/**
 * API REST (express) do servidor: `/auth/*` e `/me*`. Montada em `buildColyseusServer`, depois de
 * `/health`. Regras: corpo JSON com limite pequeno e `Content-Type` estrito, CORS só para as origens de
 * `CORS_ORIGINS` (vazio = nenhuma), cabeçalhos de segurança, rate limit por IP e por usuário, erros
 * sempre `{ error: { code } }` com códigos estáveis, sem stack e sem eco da entrada. Nunca registra
 * corpo de `/auth`, token, hash nem `Authorization` (o logger também redige por nome de campo).
 */
import express from 'express';
import type { Application, NextFunction, Request, RequestHandler, Response } from 'express';
import { AuthError, bearerFromHeader, type AuthService } from '../auth/authService';
import type { RestLimits } from '../auth/config';
import { parseAvatarParts } from '@trucaco/protocol';
import type { MeResponse } from '@trucaco/protocol';
import { log } from '../logger';
import { SlidingWindowLimiter, clientKey } from '../rateLimit';
import {
  InvalidInputError,
  NicknameTakenError,
  NotPartnersError,
  PersistenceError,
  type PartnerCodesMap,
  type UserRecord,
  type UserRepository,
} from '../db/types';
import { assertPartnerCodes, normalizeId, validateNickname } from '../db/validation';
import { TokenStoreUnavailableError } from '../auth/tokenStore';

export const BODY_LIMIT = '8kb';

export interface RestOptions {
  readonly auth: AuthService;
  readonly users: UserRepository;
  readonly limits: RestLimits;
  readonly corsOrigins: readonly string[];
  readonly trustProxy: boolean;
}

export interface BaseMiddlewareOptions {
  readonly corsOrigins: readonly string[];
  /** Liga `Strict-Transport-Security` (produção atrás de TLS). */
  readonly hsts: boolean;
}

type ErrorStatus = 400 | 401 | 403 | 404 | 405 | 409 | 413 | 415 | 429 | 500 | 501 | 503;

function fail(res: Response, status: ErrorStatus, code: string): void {
  res.status(status).json({ error: { code } });
}

const locals = (res: Response): { user: UserRecord } => res.locals as { user: UserRecord };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Cabeçalhos de segurança e CORS por lista exata de origens. Primeiro middleware da API. */
export function installBaseMiddleware(app: Application, opts: BaseMiddlewareOptions): void {
  app.disable('x-powered-by');
  const allowed = new Set(opts.corsOrigins);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    if (opts.hsts)
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    const origin = req.headers.origin;
    if (typeof origin === 'string') {
      res.vary('Origin');
      const ok = allowed.has(origin);
      if (ok) res.setHeader('Access-Control-Allow-Origin', origin);
      if (req.method === 'OPTIONS' && req.headers['access-control-request-method'] !== undefined) {
        if (!ok) {
          fail(res, 403, 'CORS_FORBIDDEN');
          return;
        }
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.setHeader('Access-Control-Max-Age', '600');
        res.status(204).end();
        return;
      }
    }
    next();
  });
}

export function mountRest(app: Application, opts: RestOptions): void {
  const { auth, users, limits } = opts;
  const ipKey = (req: Request): string => clientKey(req, opts.trustProxy);

  const ipLimiter = new SlidingWindowLimiter(limits.perIpPerMin, 60_000);
  const guestIpLimiter = new SlidingWindowLimiter(limits.guestPerIpPerHour, 3_600_000);
  const guestGlobalLimiter = new SlidingWindowLimiter(limits.guestGlobalPerHour, 3_600_000);
  const refreshIpLimiter = new SlidingWindowLimiter(limits.refreshPerIpPerMin, 60_000);
  const userLimiter = new SlidingWindowLimiter(limits.perUserPerMin, 60_000);
  // Escritas do perfil (apelido/avatar/códigos): bem mais restritas que a leitura.
  const writeLimiter = new SlidingWindowLimiter(
    Math.max(1, Math.floor(limits.perUserPerMin / 6)),
    60_000,
  );

  const tooMany = (res: Response, retryAfterSec: number): void => {
    res.setHeader('Retry-After', String(retryAfterSec));
    fail(res, 429, 'RATE_LIMITED');
  };
  const byIp =
    (limiter: SlidingWindowLimiter, retryAfterSec: number): RequestHandler =>
    (req, res, next) => {
      if (limiter.allow(ipKey(req))) next();
      else tooMany(res, retryAfterSec);
    };
  const globalGuest: RequestHandler = (_req, res, next) => {
    if (guestGlobalLimiter.allow('global')) next();
    else tooMany(res, 600);
  };

  /** Corpo (se houver) tem de ser `application/json`; o JSON tem limite pequeno e modo estrito. */
  const contentType: RequestHandler = (req, res, next) => {
    const length = req.headers['content-length'];
    const hasBody =
      (length !== undefined && length !== '0') || req.headers['transfer-encoding'] !== undefined;
    if (hasBody && !req.is('application/json')) {
      fail(res, 415, 'UNSUPPORTED_MEDIA_TYPE');
      return;
    }
    next();
  };
  const json = express.json({ limit: BODY_LIMIT, strict: true });

  const authenticate: RequestHandler = async (req, res, next) => {
    const token = bearerFromHeader(req.headers.authorization);
    if (token === undefined) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      fail(res, 401, 'UNAUTHORIZED');
      return;
    }
    let userId: string;
    try {
      const principal = await auth.authenticateAccess(token);
      userId = principal.userId;
      res.locals['jti'] = principal.jti;
    } catch (err) {
      if (!(err instanceof AuthError)) throw err;
      res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
      fail(res, 401, 'UNAUTHORIZED');
      return;
    }
    const user = await users.findById(userId);
    if (user === null) {
      res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
      fail(res, 401, 'UNAUTHORIZED');
      return;
    }
    if (!userLimiter.allow(user.id)) {
      tooMany(res, 60);
      return;
    }
    res.locals['user'] = user;
    next();
  };
  const writeLimit: RequestHandler = (_req, res, next) => {
    if (writeLimiter.allow(locals(res).user.id)) next();
    else tooMany(res, 60);
  };

  const route = (
    path: string,
    allowed: readonly string[],
    define: (r: ReturnType<Application['route']>) => void,
  ): void => {
    const r = app.route(path);
    define(r);
    r.all((_req, res) => {
      res.setHeader('Allow', allowed.join(', '));
      fail(res, 405, 'METHOD_NOT_ALLOWED');
    });
  };

  const notImplemented: RequestHandler = (_req, res) => fail(res, 501, 'NOT_IMPLEMENTED');

  // ------------------------------------------------------------------------------- /auth
  route('/auth/guest', ['POST'], (r) =>
    r.post(
      byIp(ipLimiter, 60),
      byIp(guestIpLimiter, 3600),
      globalGuest,
      contentType,
      async (_req, res) => {
        const { user, pair } = await auth.createGuest();
        log.info('auth: convidado criado');
        res.status(201).json({ user: { id: user.id, nickname: user.nickname }, ...pair });
      },
    ),
  );

  route('/auth/refresh', ['POST'], (r) =>
    r.post(byIp(ipLimiter, 60), byIp(refreshIpLimiter, 60), contentType, json, async (req, res) => {
      const body: unknown = req.body;
      if (
        !isPlainObject(body) ||
        Object.keys(body).length !== 1 ||
        typeof body['refreshToken'] !== 'string'
      ) {
        fail(res, 400, 'INVALID_BODY');
        return;
      }
      const pair = await auth.refresh(body['refreshToken']);
      res.status(200).json(pair);
    }),
  );

  /**
   * Logout: corpo `{ refreshToken }` (revoga a família dele, se for do usuário do JWT) ou `{ all: true }`.
   * Sempre 204, também para refresh inválido/desconhecido/de outro usuário (sem oráculo). O `jti` do
   * access apresentado é revogado em qualquer caso.
   */
  route('/auth/logout', ['POST'], (r) =>
    r.post(byIp(ipLimiter, 60), authenticate, contentType, json, async (req, res) => {
      const body: unknown = req.body;
      if (!isPlainObject(body) || Object.keys(body).length !== 1) {
        fail(res, 400, 'INVALID_BODY');
        return;
      }
      const jti = res.locals['jti'] as string;
      const userId = locals(res).user.id;
      if (typeof body['refreshToken'] === 'string') {
        await auth.logout({ userId, jti }, { refreshToken: body['refreshToken'] });
      } else if (body['all'] === true) {
        await auth.logout({ userId, jti }, { all: true });
      } else {
        fail(res, 400, 'INVALID_BODY');
        return;
      }
      res.status(204).end();
    }),
  );

  /**
   * CONTRATO (stub, Fase 3): `POST /auth/link` com `Authorization: Bearer <access de convidado>` e corpo
   * `{ provider: 'google'|'apple', idToken: string }`. Valida o idToken no provedor, grava
   * (provider, subject) no usuário convidado (409 `PROVIDER_TAKEN` se o subject já for de outra conta)
   * e responde 200 com um par novo (`TokenPair`), revogando as famílias antigas. O `idToken` é de uso
   * único (`jti:used` por `SET NX EX`).
   */
  route('/auth/link', ['POST'], (r) => r.post(byIp(ipLimiter, 60), authenticate, notImplemented));
  /** Login social: stub; contrato `{ idToken }` -> `TokenPair` (Fase 3). */
  route('/auth/google', ['POST'], (r) => r.post(byIp(ipLimiter, 60), notImplemented));
  route('/auth/apple', ['POST'], (r) => r.post(byIp(ipLimiter, 60), notImplemented));

  // --------------------------------------------------------------------------------- /me
  route('/me', ['GET', 'PUT'], (r) => {
    r.get(byIp(ipLimiter, 60), authenticate, async (_req, res) => {
      const user = locals(res).user;
      const avatar = await users.getAvatar(user.id);
      const body: MeResponse = {
        id: user.id,
        nickname: user.nickname,
        provider: user.provider,
        avatar,
        createdAt: user.createdAt.toISOString(),
        // Zeros até o 6E (estatísticas reais); a forma já é a final (`UserStats`).
        stats: { paulista: { played: 0, won: 0 }, mineiro: { played: 0, won: 0 } },
      };
      res.json(body);
    });
    r.put(byIp(ipLimiter, 60), authenticate, writeLimit, contentType, json, async (req, res) => {
      const body: unknown = req.body;
      if (
        !isPlainObject(body) ||
        Object.keys(body).length !== 1 ||
        typeof body['nickname'] !== 'string'
      ) {
        fail(res, 400, 'INVALID_BODY');
        return;
      }
      let nickname: string;
      try {
        nickname = validateNickname(body['nickname']);
      } catch (err) {
        if (err instanceof InvalidInputError) {
          fail(res, 400, 'INVALID_NICKNAME');
          return;
        }
        throw err;
      }
      try {
        await users.updateNickname(locals(res).user.id, nickname);
      } catch (err) {
        if (err instanceof NicknameTakenError) {
          fail(res, 409, 'NICKNAME_TAKEN');
          return;
        }
        throw err;
      }
      res.json({ nickname });
    });
  });

  route('/me/avatar', ['PUT'], (r) =>
    r.put(byIp(ipLimiter, 60), authenticate, writeLimit, contentType, json, async (req, res) => {
      const body: unknown = req.body;
      if (!isPlainObject(body) || Object.keys(body).length !== 1 || !isPlainObject(body['parts'])) {
        fail(res, 400, 'INVALID_BODY');
        return;
      }
      // Só o catálogo do protocolo passa (chaves exatas, índices no intervalo); texto livre -> 400.
      const parts = parseAvatarParts(body['parts']);
      if (parts === null) {
        fail(res, 400, 'INVALID_AVATAR');
        return;
      }
      try {
        await users.saveAvatar(locals(res).user.id, parts);
      } catch (err) {
        if (err instanceof InvalidInputError) {
          fail(res, 400, 'INVALID_AVATAR');
          return;
        }
        throw err;
      }
      res.json({ avatar: parts });
    }),
  );

  /** Significados combinados com o parceiro para cada sinal. Só quem já jogou em dupla pode gravar. */
  route('/me/partners/:partnerId/codes', ['GET', 'PUT'], (r) => {
    const partnerOf = (req: Request, res: Response): string | null => {
      try {
        return normalizeId(req.params['partnerId']);
      } catch {
        fail(res, 400, 'INVALID_PARTNER');
        return null;
      }
    };
    r.get(byIp(ipLimiter, 60), authenticate, async (req, res) => {
      const partnerId = partnerOf(req, res);
      if (partnerId === null) return;
      try {
        res.json({ codes: (await users.getPartnerCodes(locals(res).user.id, partnerId)) ?? {} });
      } catch (err) {
        if (err instanceof InvalidInputError) {
          fail(res, 400, 'INVALID_PARTNER');
          return;
        }
        throw err;
      }
    });
    r.put(byIp(ipLimiter, 60), authenticate, writeLimit, contentType, json, async (req, res) => {
      const partnerId = partnerOf(req, res);
      if (partnerId === null) return;
      const body: unknown = req.body;
      if (!isPlainObject(body) || Object.keys(body).length !== 1 || !isPlainObject(body['codes'])) {
        fail(res, 400, 'INVALID_BODY');
        return;
      }
      let clean: PartnerCodesMap;
      try {
        // A mesma limpeza do chat; o repositório a aplica de novo (idempotente) ao gravar.
        clean = assertPartnerCodes(body['codes'] as PartnerCodesMap);
        await users.savePartnerCodes(locals(res).user.id, partnerId, clean);
      } catch (err) {
        if (err instanceof NotPartnersError) {
          fail(res, 403, 'NOT_PARTNERS');
          return;
        }
        if (err instanceof InvalidInputError) {
          fail(res, 400, 'INVALID_CODES');
          return;
        }
        throw err;
      }
      res.json({ codes: clean });
    });
  });
}

/** 404 e tratador de erros genéricos: SEMPRE por último, com ou sem as rotas de auth. */
export function mountFallbacks(app: Application): void {
  app.use((_req, res) => fail(res, 404, 'NOT_FOUND'));
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const e = err as { type?: unknown; status?: unknown; name?: unknown; code?: unknown };
    if (err instanceof AuthError) {
      if (err.code === 'SERVICE_UNAVAILABLE') fail(res, 503, 'SERVICE_UNAVAILABLE');
      else fail(res, 401, err.code);
      return;
    }
    if (e.type === 'entity.too.large') {
      fail(res, 413, 'PAYLOAD_TOO_LARGE');
      return;
    }
    if (
      typeof e.type === 'string' &&
      typeof e.status === 'number' &&
      e.status >= 400 &&
      e.status < 500
    ) {
      // Falhas do parser de corpo (JSON malformado, charset, aborto): sempre o mesmo código.
      fail(res, 400, 'INVALID_JSON');
      return;
    }
    if (err instanceof InvalidInputError) {
      fail(res, 400, 'INVALID_INPUT');
      return;
    }
    if (err instanceof NotPartnersError) {
      fail(res, 403, 'NOT_PARTNERS');
      return;
    }
    if (err instanceof NicknameTakenError) {
      fail(res, 409, 'NICKNAME_TAKEN');
      return;
    }
    // Só nome e código (o erro bruto do Prisma/Redis pode carregar dados): nunca a mensagem nem a stack.
    log.error('rest: erro interno', {
      name: typeof e.name === 'string' ? e.name : 'unknown',
      code: err instanceof PersistenceError ? err.code : typeof e.code === 'string' ? e.code : null,
    });
    const unavailable =
      err instanceof TokenStoreUnavailableError ||
      e.name === 'MaxRetriesPerRequestError' ||
      e.name === 'ReplyError';
    if (unavailable) fail(res, 503, 'SERVICE_UNAVAILABLE');
    else fail(res, 500, 'INTERNAL');
  });
}
