/**
 * Rotas do lobby (bloco 2H), todas autenticadas por `Authorization: Bearer <access>`. Devolvem uma RESERVA
 * DE ASSENTO que o cliente consome com `client.consumeSeatReservation(reservation)` (SDK Colyseus 0.18).
 *
 * | Rota                     | Corpo                      | Resposta                                           |
 * | ------------------------ | -------------------------- | -------------------------------------------------- |
 * | `POST /tables`           | `RoomOptions` (private)    | `201 { code, reservation }` (criador = 1º assento) |
 * | `POST /tables/join`      | `{ code }`                 | `200 { reservation }`                              |
 * | `POST /queue`            | `RoomOptions` (public, single) | `200 { status, ... }`                          |
 * | `GET /queue`             | -                          | `200 { status: idle|queued|matched|seated, ... }`  |
 * | `POST /queue/leave`      | -                          | `200 { status: 'idle' }`                           |
 *
 * (`POST` no lugar de `DELETE` para sair da fila: a lista de métodos do CORS é só GET/POST/PUT.)
 * Erros: `{ error: { code } }`. Entrar por código devolve o MESMO erro `404 TABLE_UNAVAILABLE` para código
 * inexistente, mesa cheia, em partida, de outro tipo ou fechada.
 */
import express from 'express';
import type { Application, Request, RequestHandler, Response } from 'express';
import { validateRoomOptions } from '@trucaco/protocol';
import type { RoomOptions } from '@trucaco/protocol';
import { AuthError, bearerFromHeader } from '../auth/authService';
import type { AuthService } from '../auth/authService';
import type { UserRepository } from '../db/types';
import { GatewayAuthError } from '../lobby/lobby';
import type { Fail, Lobby, LobbyError } from '../lobby/lobby';
import { SlidingWindowLimiter, clientKey } from '../rateLimit';
import { BODY_LIMIT } from './rest';

export interface LobbyRoutesOptions {
  readonly auth: AuthService;
  readonly users: UserRepository;
  readonly lobby: Lobby;
  readonly trustProxy: boolean;
}

const STATUS: Record<LobbyError, number> = {
  ALREADY_IN_TABLE: 409,
  INVALID_OPTIONS: 400,
  INVALID_CODE: 400,
  TABLE_UNAVAILABLE: 404,
  QUEUE_FULL: 503,
  RATE_LIMITED: 429,
  UNAVAILABLE: 503,
};

function failWith(res: Response, error: LobbyError | string, status: number): void {
  res.status(status).json({ error: { code: error } });
}

function failLobby(res: Response, f: Fail): void {
  if (f.retryAfterSec !== undefined) res.setHeader('Retry-After', String(f.retryAfterSec));
  failWith(res, f.error, STATUS[f.error]);
}

const locals = (res: Response): { userId: string; bearer: string } =>
  res.locals as { userId: string; bearer: string };

export function mountLobbyRoutes(app: Application, opts: LobbyRoutesOptions): void {
  const { auth, users, lobby } = opts;
  const cfg = lobby.config;
  const ipLimiter = new SlidingWindowLimiter(cfg.actionsPerIpPerMin, 60_000);
  const userLimiter = new SlidingWindowLimiter(cfg.actionsPerUserPerMin, 60_000);
  const createLimiter = new SlidingWindowLimiter(cfg.createPerUserPerMin, 60_000);
  const ipOf = (req: Request): string => clientKey(req, opts.trustProxy);

  const byIp: RequestHandler = (req, res, next) => {
    if (ipLimiter.allow(ipOf(req))) next();
    else {
      res.setHeader('Retry-After', '60');
      failWith(res, 'RATE_LIMITED', 429);
    }
  };

  const contentType: RequestHandler = (req, res, next) => {
    const length = req.headers['content-length'];
    const hasBody =
      (length !== undefined && length !== '0') || req.headers['transfer-encoding'] !== undefined;
    if (hasBody && !req.is('application/json')) {
      failWith(res, 'UNSUPPORTED_MEDIA_TYPE', 415);
      return;
    }
    next();
  };
  const json = express.json({ limit: BODY_LIMIT, strict: true });

  const authenticate: RequestHandler = async (req, res, next) => {
    const bearer = bearerFromHeader(req.headers.authorization);
    if (bearer === undefined) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      failWith(res, 'UNAUTHORIZED', 401);
      return;
    }
    try {
      const userId = (await auth.authenticateAccess(bearer)).userId;
      if ((await users.findById(userId)) === null) throw new AuthError('UNAUTHORIZED');
      if (!userLimiter.allow(userId)) {
        res.setHeader('Retry-After', '60');
        failWith(res, 'RATE_LIMITED', 429);
        return;
      }
      res.locals['userId'] = userId;
      res.locals['bearer'] = bearer;
      next();
    } catch (err) {
      if (err instanceof AuthError && err.code !== 'SERVICE_UNAVAILABLE') {
        res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
        failWith(res, 'UNAUTHORIZED', 401);
        return;
      }
      throw err;
    }
  };

  /** Falha de auth vinda do `onAuth` durante a reserva (token revogado entre os dois passos, Redis fora). */
  const guardGateway = async (res: Response, fn: () => Promise<void>): Promise<void> => {
    try {
      await fn();
    } catch (err) {
      if (err instanceof GatewayAuthError) {
        failWith(res, err.status === 401 ? 'UNAUTHORIZED' : 'SERVICE_UNAVAILABLE', err.status);
        return;
      }
      throw err;
    }
  };

  const parseOptions = (
    body: unknown,
    visibility: 'public' | 'private',
  ): RoomOptions | { error: string } => {
    const valid = validateRoomOptions(body);
    if (!valid.ok) return { error: valid.error };
    if (valid.options.visibility !== visibility) return { error: 'INVALID_OPTIONS' };
    return valid.options;
  };

  app.post('/tables', byIp, authenticate, contentType, json, async (req, res) => {
    const { userId, bearer } = locals(res);
    const options = parseOptions(req.body, 'private');
    if ('error' in options) {
      failWith(res, options.error, 400);
      return;
    }
    if (!createLimiter.allow(userId)) {
      res.setHeader('Retry-After', '60');
      failWith(res, 'RATE_LIMITED', 429);
      return;
    }
    await guardGateway(res, async () => {
      const r = await lobby.createTable(userId, bearer, options);
      if (!r.ok) failLobby(res, r);
      else res.status(201).json({ code: r.code, reservation: r.reservation });
    });
  });

  app.post('/tables/join', byIp, authenticate, contentType, json, async (req, res) => {
    const { userId, bearer } = locals(res);
    const body: unknown = req.body;
    if (
      typeof body !== 'object' ||
      body === null ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      !('code' in body)
    ) {
      failWith(res, 'INVALID_BODY', 400);
      return;
    }
    await guardGateway(res, async () => {
      const r = await lobby.joinByCode(userId, bearer, ipOf(req), (body as { code: unknown }).code);
      if (!r.ok) failLobby(res, r);
      else res.status(200).json({ reservation: r.reservation });
    });
  });

  app.post('/queue', byIp, authenticate, contentType, json, async (req, res) => {
    const { userId, bearer } = locals(res);
    const options = parseOptions(req.body, 'public');
    if ('error' in options) {
      failWith(res, options.error, 400);
      return;
    }
    await guardGateway(res, async () => {
      const r = await lobby.enqueue(userId, bearer, options);
      if (!r.ok) failLobby(res, r);
      else res.status(200).json(r.status);
    });
  });

  app.get('/queue', byIp, authenticate, async (_req, res) => {
    const { userId, bearer } = locals(res);
    await guardGateway(res, async () => {
      res.status(200).json(await lobby.statusOf(userId, bearer));
    });
  });

  app.post('/queue/leave', byIp, authenticate, async (_req, res) => {
    await lobby.leaveQueue(locals(res).userId);
    res.status(200).json({ status: 'idle' });
  });
}
