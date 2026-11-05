/**
 * API REST (express) do servidor: `/auth/*` e `/me*`. Montada em `buildColyseusServer`, depois de
 * `/health`. Regras: corpo JSON com limite pequeno e `Content-Type` estrito, CORS só para as origens de
 * `CORS_ORIGINS` (vazio = nenhuma), cabeçalhos de segurança, rate limit por IP e por usuário, erros
 * sempre `{ error: { code } }` com códigos estáveis, sem stack e sem eco da entrada. Nunca registra
 * corpo de `/auth`, token, hash nem `Authorization` (o logger também redige por nome de campo).
 */
import express from 'express';
import type { Application, NextFunction, Request, RequestHandler, Response } from 'express';
import {
  AuthError,
  SocialAuthError,
  bearerFromHeader,
  type AuthService,
} from '../auth/authService';
import type { RestLimits } from '../auth/config';
import {
  MATCHES_PAGE_MAX,
  REPORT_RATE_LIMIT_PER_HOUR,
  normalizeUuid,
  parseAvatarParts,
  parseBlockRequest,
  parseDeleteAccountRequest,
  parseLinkRequest,
  parseReportRequest,
  parseSocialAuthRequest,
} from '@trucaco/protocol';
import type {
  BlocksResponse,
  MatchSummaryResponse,
  MatchesPageResponse,
  MeResponse,
  PublicProfileResponse,
  SocialAuthResponse,
  SocialProvider,
} from '@trucaco/protocol';
import { log } from '../logger';
import { SlidingWindowLimiter, clientKey } from '../rateLimit';
import {
  InvalidInputError,
  NicknameTakenError,
  NotPartnersError,
  PersistenceError,
  type MatchRepository,
  type MatchSummary,
  type ProgressionRepository,
  type PartnerCodesMap,
  type UserRecord,
  type UserRepository,
} from '../db/types';
import { assertPartnerCodes, normalizeId, validateNickname } from '../db/validation';
import { TokenStoreUnavailableError } from '../auth/tokenStore';
import { emitBlockChange, emitUserDeleted } from '../social/blockBus';
import { dailyMissionsFor, weeklyMissionsFor } from '../progression/missions';
import { periodKeys } from '../progression/period';
import {
  toAchievementsResponse,
  toMissionsResponse,
  toPublicAchievements,
  toUserStats,
} from '../progression/views';

export const BODY_LIMIT = '8kb';
/** Teto de bloqueios por usuário (memória e consultas do lobby/sala limitadas). */
export const MAX_BLOCKS_PER_USER = 200;
/** Denúncia sem `matchId` só vale se os dois jogaram a mesma partida terminada nesta janela (7 dias). */
export const REPORT_SHARED_MATCH_WINDOW_MS = 7 * 24 * 3_600_000;
/** Teto global de denúncias gravadas contra um mesmo denunciado por hora (de qualquer denunciante). */
export const REPORTS_PER_REPORTED_PER_HOUR = 10;
const CURSOR_MAX_LENGTH = 256;

function toMatchResponse(m: MatchSummary): MatchSummaryResponse {
  return {
    id: m.id,
    variant: m.variant,
    format: m.format,
    ironHand: m.ironHand,
    visibility: m.visibility,
    status: m.status,
    winnerTeam: m.winnerTeam,
    games: m.games,
    startedAt: m.startedAt.toISOString(),
    endedAt: m.endedAt.toISOString(),
    players: m.players.map((p) => ({
      seat: p.seat,
      team: p.team,
      userId: p.userId,
      nickname: p.nickname,
      botFrom: p.botFrom,
    })),
  };
}

export interface RestOptions {
  readonly auth: AuthService;
  readonly users: UserRepository;
  /** Histórico (`GET /matches`) e validação de `matchId` das denúncias. Ausente: histórico vazio. */
  readonly matches?: MatchRepository;
  /** Conquistas, missões e estatísticas (`/me/achievements`, `/me/missions`, `stats`, `/users/:id`). Ausente: tudo zerado. */
  readonly progression?: ProgressionRepository;
  /** Relógio (testes de virada de dia). Padrão: `new Date()`. */
  readonly now?: () => Date;
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
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
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
  const { auth, users, limits, matches, progression } = opts;
  const now = opts.now ?? ((): Date => new Date());
  const ipKey = (req: Request): string => clientKey(req, opts.trustProxy);

  const ipLimiter = new SlidingWindowLimiter(limits.perIpPerMin, 60_000);
  const guestIpLimiter = new SlidingWindowLimiter(limits.guestPerIpPerHour, 3_600_000);
  const guestGlobalLimiter = new SlidingWindowLimiter(limits.guestGlobalPerHour, 3_600_000);
  const refreshIpLimiter = new SlidingWindowLimiter(limits.refreshPerIpPerMin, 60_000);
  const socialIpLimiter = new SlidingWindowLimiter(limits.socialPerIpPerMin, 60_000);
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
  // Denúncias: 5 por hora por usuário (conta toda tentativa, também as inválidas).
  const reportLimiter = new SlidingWindowLimiter(REPORT_RATE_LIMIT_PER_HOUR, 3_600_000);
  const reportLimit: RequestHandler = (_req, res, next) => {
    if (reportLimiter.allow(locals(res).user.id)) next();
    else tooMany(res, 3600);
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

  /** Falhas de login social e vínculo -> HTTP. Devolve `false` para erro de outra natureza (cai no tratador geral). */
  const socialFail = (res: Response, err: unknown): boolean => {
    if (!(err instanceof SocialAuthError)) return false;
    switch (err.code) {
      case 'ALREADY_LINKED':
        fail(res, 409, 'ALREADY_LINKED');
        break;
      case 'PROVIDER_TAKEN':
        fail(res, 409, 'PROVIDER_TAKEN');
        break;
      case 'INVALID_ID_TOKEN':
        fail(res, 401, 'INVALID_ID_TOKEN');
        break;
      case 'SOCIAL_LOGIN_DISABLED':
        fail(res, 503, 'SOCIAL_LOGIN_DISABLED');
        break;
    }
    return true;
  };

  /**
   * Login social: `POST /auth/google` e `/auth/apple`, corpo `{ provider, idToken, nonce? }` (o `provider`
   * tem de bater com a rota). 200 conta existente, 201 conta nova (`created: true`). Sem Bearer.
   */
  const socialLogin =
    (provider: SocialProvider): RequestHandler =>
    async (req, res) => {
      const parsed = parseSocialAuthRequest(req.body);
      if (parsed === null || parsed.provider !== provider) {
        fail(res, 400, 'INVALID_BODY');
        return;
      }
      try {
        const { user, pair, created } = await auth.loginSocial(
          provider,
          parsed.idToken,
          parsed.nonce,
        );
        const body: SocialAuthResponse = {
          user: { id: user.id, nickname: user.nickname },
          ...pair,
          created,
        };
        res.status(created ? 201 : 200).json(body);
      } catch (err) {
        if (!socialFail(res, err)) throw err;
      }
    };
  route('/auth/google', ['POST'], (r) =>
    r.post(
      byIp(ipLimiter, 60),
      byIp(socialIpLimiter, 60),
      contentType,
      json,
      socialLogin('google'),
    ),
  );
  route('/auth/apple', ['POST'], (r) =>
    r.post(byIp(ipLimiter, 60), byIp(socialIpLimiter, 60), contentType, json, socialLogin('apple')),
  );

  /**
   * Vincular o convidado autenticado a Google/Apple. Corpo `{ provider, idToken, nonce? }`; o `userId` vem
   * do token de acesso. 200 com par novo (as sessões antigas morrem); 409 `ALREADY_LINKED` (a conta não é
   * convidada) ou `PROVIDER_TAKEN` (o `sub` é de outra conta; o idToken não é gasto, serve para entrar nela).
   */
  route('/auth/link', ['POST'], (r) =>
    r.post(
      byIp(ipLimiter, 60),
      byIp(socialIpLimiter, 60),
      authenticate,
      writeLimit,
      contentType,
      json,
      async (req, res) => {
        const parsed = parseLinkRequest(req.body);
        if (parsed === null) {
          fail(res, 400, 'INVALID_BODY');
          return;
        }
        try {
          const { user, pair } = await auth.linkGuest(
            { userId: locals(res).user.id, jti: res.locals['jti'] as string },
            parsed.provider,
            parsed.idToken,
            parsed.nonce,
          );
          const body: SocialAuthResponse = {
            user: { id: user.id, nickname: user.nickname },
            ...pair,
            created: false,
          };
          res.status(200).json(body);
        } catch (err) {
          if (!socialFail(res, err)) throw err;
        }
      },
    ),
  );

  // --------------------------------------------------------------------------------- /me
  /**
   * Apagar conta (LGPD, exigência 5.1.1 da Apple). Corpo `{ refreshToken }`: prova de acesso recente (o
   * refresh tem de estar vivo e ser do usuário do JWT; um access roubado sozinho não basta). Ordem: apaga
   * o usuário (cascatas no banco), derruba os sockets e revoga TODAS as sessões. Se a revogação falhar
   * (Redis fora), o usuário já não existe: o access restante (até 15 min) cai em 401, porque toda rota
   * autenticada e o `onAuth` das salas conferem que o usuário existe. 204 sem corpo.
   */
  const deleteAccount: RequestHandler = async (req, res) => {
    const parsed = parseDeleteAccountRequest(req.body);
    if (parsed === null) {
      fail(res, 400, 'INVALID_BODY');
      return;
    }
    const user = locals(res).user;
    const jti = res.locals['jti'] as string;
    await auth.assertRecentRefresh(user.id, parsed.refreshToken);
    await users.deleteUser(user.id);
    emitUserDeleted(user.id);
    log.info('me: conta apagada');
    await auth.logout({ userId: user.id, jti }, { all: true });
    res.status(204).end();
  };

  route('/me', ['GET', 'PUT', 'DELETE'], (r) => {
    r.get(byIp(ipLimiter, 60), authenticate, async (_req, res) => {
      const user = locals(res).user;
      const avatar = await users.getAvatar(user.id);
      const body: MeResponse = {
        id: user.id,
        nickname: user.nickname,
        provider: user.provider,
        avatar,
        createdAt: user.createdAt.toISOString(),
        stats: toUserStats((await progression?.getStats(user.id)) ?? []),
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
    r.delete(byIp(ipLimiter, 60), authenticate, writeLimit, contentType, json, deleteAccount);
  });

  // ----------------------------------------------------------------------------- /matches
  /** Histórico do PRÓPRIO usuário, paginado por cursor (`?limit=&cursor=`). Sem `events`, `deals` nem `seed`. */
  route('/matches', ['GET'], (r) =>
    r.get(byIp(ipLimiter, 60), authenticate, async (req, res) => {
      const { limit: rawLimit, cursor: rawCursor } = req.query;
      let limit: number | undefined;
      if (rawLimit !== undefined) {
        if (typeof rawLimit !== 'string' || !/^\d{1,3}$/.test(rawLimit)) {
          fail(res, 400, 'INVALID_INPUT');
          return;
        }
        limit = Number(rawLimit);
        if (limit < 1 || limit > MATCHES_PAGE_MAX) {
          fail(res, 400, 'INVALID_INPUT');
          return;
        }
      }
      if (
        rawCursor !== undefined &&
        (typeof rawCursor !== 'string' ||
          rawCursor.length === 0 ||
          rawCursor.length > CURSOR_MAX_LENGTH)
      ) {
        fail(res, 400, 'INVALID_INPUT');
        return;
      }
      const page =
        matches === undefined
          ? { items: [], nextCursor: null }
          : await matches.listForUser(locals(res).user.id, {
              ...(limit === undefined ? {} : { limit }),
              ...(rawCursor === undefined ? {} : { cursor: rawCursor }),
            });
      const body: MatchesPageResponse = {
        items: page.items.map(toMatchResponse),
        nextCursor: page.nextCursor,
      };
      res.json(body);
    }),
  );

  // ------------------------------------------------------------ conquistas, missões e perfil
  /** O catálogo inteiro de conquistas do PRÓPRIO usuário, com progresso (nível 0 = bloqueada). */
  route('/me/achievements', ['GET'], (r) =>
    r.get(byIp(ipLimiter, 60), authenticate, async (_req, res) => {
      const rows = (await progression?.listAchievements(locals(res).user.id)) ?? [];
      res.json(toAchievementsResponse(rows));
    }),
  );

  /**
   * Missões do dia e da semana correntes (`America/Sao_Paulo`). As linhas do período nascem aqui na primeira
   * leitura (sorteio determinístico por `hash(userId, periodKey)`, sem job); o dia seguinte tem outra chave.
   */
  route('/me/missions', ['GET'], (r) =>
    r.get(byIp(ipLimiter, 60), authenticate, async (_req, res) => {
      if (progression === undefined) {
        res.json(toMissionsResponse([]));
        return;
      }
      const me = locals(res).user.id;
      const keys = periodKeys(now());
      const [daily, weekly] = await Promise.all([
        progression.ensureMissions(me, keys.daily, dailyMissionsFor(me, keys.daily)),
        progression.ensureMissions(me, keys.weekly, weeklyMissionsFor(keys.weekly)),
      ]);
      res.json(toMissionsResponse([...daily, ...weekly]));
    }),
  );

  /**
   * Perfil público (decisão 7 do plano): apelido, avatar, medalhas desbloqueadas e partidas/vitórias por
   * variante. Nunca histórico, provedor nem datas. Sem oráculo: id malformado, inexistente, apagado ou em
   * bloqueio (nos dois sentidos) respondem o MESMO `404 USER_NOT_FOUND`.
   */
  route('/users/:id', ['GET'], (r) =>
    r.get(byIp(ipLimiter, 60), authenticate, async (req, res) => {
      const me = locals(res).user.id;
      const id = normalizeUuid(req.params['id']);
      if (id === null) {
        fail(res, 404, 'USER_NOT_FOUND');
        return;
      }
      if (id !== me) {
        const [blocked, blockers] = await Promise.all([
          users.listBlockedIds(me),
          users.listBlockerIds(me),
        ]);
        if (blocked.includes(id) || blockers.includes(id)) {
          fail(res, 404, 'USER_NOT_FOUND');
          return;
        }
      }
      let body: PublicProfileResponse;
      if (progression !== undefined) {
        const profile = await progression.getPublicProfile(id);
        if (profile === null) {
          fail(res, 404, 'USER_NOT_FOUND');
          return;
        }
        body = {
          id: profile.userId,
          nickname: profile.nickname,
          avatar: profile.avatar,
          achievements: toPublicAchievements(profile.achievements),
          stats: toUserStats(profile.stats),
        };
      } else {
        const user = await users.findById(id);
        if (user === null) {
          fail(res, 404, 'USER_NOT_FOUND');
          return;
        }
        body = {
          id: user.id,
          nickname: user.nickname,
          avatar: await users.getAvatar(id),
          achievements: [],
          stats: toUserStats([]),
        };
      }
      res.json(body);
    }),
  );

  // ------------------------------------------------------------------------------- bloqueio
  /**
   * Bloqueio persistente (decisão 5 do plano da Fase 6). Efeitos: a fila pública não casa os dois (qualquer
   * sentido), a mesa privada de quem bloqueia (ou do bloqueado) fica indisponível por código e o chat da
   * MESA entre os dois é descartado. Alvo inexistente ou apagado: 204 igual ao sucesso, sem gravar (sem oráculo).
   */
  route('/me/blocks', ['GET', 'POST'], (r) => {
    r.get(byIp(ipLimiter, 60), authenticate, async (_req, res) => {
      const list = await users.listBlocks(locals(res).user.id);
      const body: BlocksResponse = {
        blocks: list.map((b) => ({ userId: b.userId, nickname: b.nickname })),
      };
      res.json(body);
    });
    r.post(byIp(ipLimiter, 60), authenticate, writeLimit, contentType, json, async (req, res) => {
      const parsed = parseBlockRequest(req.body);
      if (parsed === null) {
        fail(res, 400, 'INVALID_BODY');
        return;
      }
      const me = locals(res).user.id;
      if (parsed.userId === me) {
        fail(res, 400, 'INVALID_BLOCK');
        return;
      }
      // Teto ANTES de consultar o alvo: com o teto cheio, existente e inexistente dão a mesma resposta.
      const current = await users.listBlockedIds(me);
      if (!current.includes(parsed.userId) && current.length >= MAX_BLOCKS_PER_USER) {
        fail(res, 400, 'INVALID_BLOCK');
        return;
      }
      // Sem oráculo de existência: alvo inexistente ou apagado (inclusive entre a leitura e a gravação)
      // responde 204 como se tivesse bloqueado, sem gravar nem publicar.
      const target = await users.findById(parsed.userId);
      if (target === null) {
        res.status(204).end();
        return;
      }
      try {
        await users.addBlock(me, target.id);
      } catch (err) {
        if (err instanceof InvalidInputError) {
          res.status(204).end();
          return;
        }
        throw err;
      }
      emitBlockChange({ blockerId: me, blockedId: target.id, active: true });
      res.status(204).end();
    });
  });

  /** Desbloquear: idempotente (204 também se não havia bloqueio). */
  route('/me/blocks/:userId', ['DELETE'], (r) =>
    r.delete(byIp(ipLimiter, 60), authenticate, writeLimit, async (req, res) => {
      const target = normalizeUuid(req.params['userId']);
      if (target === null) {
        fail(res, 400, 'INVALID_BLOCK');
        return;
      }
      const me = locals(res).user.id;
      await users.removeBlock(me, target);
      emitBlockChange({ blockerId: me, blockedId: target, active: false });
      res.status(204).end();
    }),
  );

  // ------------------------------------------------------------------------------ denúncia
  /**
   * Denúncia (moderação humana na Fase 8). 5 por hora por usuário. Sem oráculo: denunciado inexistente
   * ou apagado responde 201 como se tivesse gravado; denúncia repetida (mesmo denunciante, denunciado e
   * partida; sem partida, 24 h) também é 201 e não grava de novo (e há UNIQUE no banco); acima de
   * `REPORTS_PER_REPORTED_PER_HOUR` (não limitadas) contra o mesmo denunciado, a denúncia é GRAVADA com
   * `throttled = true` (fica para a moderação, fora da fila prioritária; não conta no teto) e a resposta é a
   * mesma 201. Contra si mesmo,
   * `matchId` em que o denunciante ou o denunciado não jogaram, e denúncia SEM `matchId` sem partida
   * terminada em comum nos últimos `REPORT_SHARED_MATCH_WINDOW_MS` (7 dias): `INVALID_REPORT`. Resposta 201 `{}` (sem eco).
   */
  route('/reports', ['POST'], (r) =>
    r.post(byIp(ipLimiter, 60), authenticate, reportLimit, contentType, json, async (req, res) => {
      const parsed = parseReportRequest(req.body);
      if (parsed === null) {
        fail(res, 400, 'INVALID_BODY');
        return;
      }
      const me = locals(res).user.id;
      if (parsed.userId === me) {
        fail(res, 400, 'INVALID_REPORT');
        return;
      }
      // Com `matchId` a participação vem ANTES de consultar o usuário: inexistente, apagado (some de
      // `match_players`) e existente que não jogou dão o MESMO `INVALID_REPORT` (sem oráculo de existência).
      if (parsed.matchId !== undefined) {
        const players = (await matches?.participantIds?.(parsed.matchId)) ?? null;
        if (players === null || !players.includes(me) || !players.includes(parsed.userId)) {
          fail(res, 400, 'INVALID_REPORT');
          return;
        }
      } else {
        // Sem `matchId`: só quem dividiu uma partida terminada na janela (qualquer assento). Mesmo erro
        // para inexistente, apagado e desconhecido.
        const since = new Date(Date.now() - REPORT_SHARED_MATCH_WINDOW_MS);
        if (!(await users.sharedMatchSince(me, parsed.userId, since))) {
          fail(res, 400, 'INVALID_REPORT');
          return;
        }
      }
      if ((await users.findById(parsed.userId)) === null) {
        res.status(201).json({});
        return;
      }
      // Idempotente: repetida responde igual ao sucesso e não grava de novo (nem sinaliza que já existia).
      if (await users.hasReport(me, parsed.userId, parsed.matchId ?? null)) {
        res.status(201).json({});
        return;
      }
      // Teto global por denunciado: acima dele a denúncia é descartada em silêncio (mesma resposta), para
      // um grupo não afogar a fila de moderação nem usar o 201 como oráculo.
      const hourAgo = new Date(Date.now() - 3_600_000);
      const throttled =
        (await users.countReportsAgainst(parsed.userId, hourAgo)) >= REPORTS_PER_REPORTED_PER_HOUR;
      if (throttled) log.warn('reports: teto por denunciado atingido, denúncia marcada throttled');
      try {
        await users.createReport({
          reporterId: me,
          reportedId: parsed.userId,
          ...(parsed.matchId === undefined ? {} : { matchId: parsed.matchId }),
          reason: parsed.reason,
          ...(parsed.text === undefined ? {} : { text: parsed.text }),
          throttled,
        });
      } catch (err) {
        if (!(err instanceof InvalidInputError)) throw err;
        // Denunciado ou partida apagados entre a leitura e a gravação: segue como se tivesse gravado.
      }
      log.info('reports: denúncia registrada', { reason: parsed.reason });
      res.status(201).json({});
    }),
  );

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
