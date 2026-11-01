/**
 * Rotas do lobby sem Colyseus: Express real + AuthService real + gateway falso. Cobre os ramos de
 * autenticação, validação de corpo, mapeamento de erro do lobby -> HTTP e limites de taxa.
 */
import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthService } from '../auth/authService';
import { DEFAULT_LIMITS } from '../auth/config';
import type { AuthConfig } from '../auth/config';
import { MemoryTokenStore, TokenStoreUnavailableError } from '../auth/tokenStore';
import { createMemoryRepositories } from '../db';
import { DEFAULT_LOBBY_CONFIG, GatewayAuthError, Lobby } from '../lobby/lobby';
import type { UserRepository } from '../db/types';
import type { LobbyConfig, TableGateway } from '../lobby/lobby';
import { setLogSink } from '../logger';
import { mountLobbyRoutes } from './lobbyRoutes';
import { installBaseMiddleware, mountFallbacks, mountRest } from './rest';

setLogSink(() => undefined);

const CFG: AuthConfig = {
  secret: new TextEncoder().encode('segredo-de-teste-com-32-bytes-ou-mais!!'),
  issuer: 'trucaco',
  audience: 'trucaco-api',
  accessTtlSec: 900,
  refreshTtlSec: 3600,
  refreshReuseGraceSec: 20,
  refreshFamilyMaxSec: 7_776_000,
  clockToleranceSec: 5,
};
const PRIV = { variant: 'paulista', format: 'single', ironHand: true, visibility: 'private' };
const PUB = { ...PRIV, visibility: 'public' };

const running: HttpServer[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((s) => new Promise((r) => s.close(r))));
});

interface Opts {
  lobby?: Partial<LobbyConfig>;
  reserve?: () => Promise<never | { name: string; sessionId: string; roomId: string }>;
  tokens?: MemoryTokenStore;
  users?: UserRepository;
}

async function start(opts: Opts = {}) {
  const repos = createMemoryRepositories();
  const users = opts.users ?? repos.users;
  const tokens = opts.tokens ?? new MemoryTokenStore();
  const auth = new AuthService(users, tokens, CFG);
  let n = 0;
  const gateway: TableGateway = {
    createRoom: () => Promise.resolve(`room-${++n}`),
    reserve:
      opts.reserve ?? ((roomId) => Promise.resolve({ name: 'truco', sessionId: 's', roomId })),
  };
  const lobby = new Lobby(gateway, {
    ...DEFAULT_LOBBY_CONFIG,
    joinMinLatencyMs: 0,
    ...opts.lobby,
  });
  const app = express();
  installBaseMiddleware(app, { corsOrigins: [], hsts: false });
  mountRest(app, {
    auth,
    users,
    limits: { ...DEFAULT_LIMITS, perIpPerMin: 10_000, perUserPerMin: 10_000 },
    corsOrigins: [],
    trustProxy: false,
  });
  mountLobbyRoutes(app, { auth, users, lobby, trustProxy: false });
  mountFallbacks(app);
  const server = await new Promise<HttpServer>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  running.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (
    method: string,
    path: string,
    init: { token?: string; body?: unknown; raw?: string; headers?: Record<string, string> } = {},
  ) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(init.body !== undefined || init.raw !== undefined
          ? { 'content-type': 'application/json' }
          : {}),
        ...(init.token !== undefined ? { authorization: `Bearer ${init.token}` } : {}),
        ...init.headers,
      },
      ...(init.raw !== undefined
        ? { body: init.raw }
        : init.body !== undefined
          ? { body: JSON.stringify(init.body) }
          : {}),
    });
    const text = await res.text();
    return {
      status: res.status,
      body: text === '' ? null : JSON.parse(text),
      headers: res.headers,
    };
  };
  const guest = async () => {
    const g = await auth.createGuest();
    return { token: g.pair.accessToken, id: g.user.id };
  };
  return { call, guest, repos, tokens, lobby, auth };
}

describe('autenticação das rotas do lobby', () => {
  it('sem Authorization, token lixo ou Basic: 401 UNAUTHORIZED com WWW-Authenticate, em todas as rotas', async () => {
    const { call } = await start();
    const routes: [string, string, unknown][] = [
      ['POST', '/tables', PRIV],
      ['POST', '/tables/join', { code: 'ABCDEFGH' }],
      ['POST', '/queue', PUB],
      ['GET', '/queue', undefined],
      ['POST', '/queue/leave', undefined],
    ];
    for (const [method, path, body] of routes) {
      const none = await call(method, path, body === undefined ? {} : { body });
      expect([path, none.status, none.body]).toEqual([
        path,
        401,
        { error: { code: 'UNAUTHORIZED' } },
      ]);
      expect(none.headers.get('www-authenticate')).toBe('Bearer');
      const junk = await call(method, path, { token: 'lixo.lixo.lixo', ...(body ? { body } : {}) });
      expect([path, junk.status]).toEqual([path, 401]);
      const basic = await call(method, path, { headers: { authorization: 'Basic dXNlcjpwYXNz' } });
      expect([path, basic.status]).toEqual([path, 401]);
    }
  });

  it('access ainda assinado de usuário removido do banco: 401 (não 500) e nenhuma mesa é criada', async () => {
    let gone = false;
    const base = createMemoryRepositories();
    const users = new Proxy(base.users, {
      get: (target, prop) =>
        prop === 'findById'
          ? (id: string) => (gone ? Promise.resolve(null) : target.findById(id))
          : Reflect.get(target, prop).bind(target),
    }) as UserRepository;
    const { call, guest } = await start({ users });
    const u = await guest();
    expect((await call('GET', '/queue', { token: u.token })).status).toBe(200);
    gone = true;
    for (const [m, path, body] of [
      ['POST', '/tables', PRIV],
      ['POST', '/queue', PUB],
      ['GET', '/queue', undefined],
    ] as const) {
      const r = await call(m, path, { token: u.token, ...(body ? { body } : {}) });
      expect([path, r.status]).toEqual([path, 401]);
    }
  });

  it('access com jti revogado: 401; Redis (token store) fora do ar: 503 SERVICE_UNAVAILABLE, nunca 401', async () => {
    const tokens = new MemoryTokenStore();
    const { call, guest, auth } = await start({ tokens });
    const u = await guest();
    const claims = await auth.authenticateAccess(u.token);
    await tokens.revokeJti(claims.jti, 900);
    const revoked = await call('GET', '/queue', { token: u.token });
    expect(revoked.status).toBe(401);

    const u2 = await guest();
    tokens.isJtiRevoked = () => Promise.reject(new TokenStoreUnavailableError());
    const down = await call('GET', '/queue', { token: u2.token });
    expect(down.status).toBe(503);
    expect(down.body).toEqual({ error: { code: 'SERVICE_UNAVAILABLE' } });
  });
});

describe('validação de corpo e tipo de conteúdo', () => {
  it('POST /tables/join: corpo vazio, array, campo extra, sem code e JSON malformado: 400; não-JSON com corpo: 415', async () => {
    const { call, guest } = await start();
    const { token } = await guest();
    const bad = [{}, [], { code: 'ABCDEFGH', extra: 1 }, { codigo: 'ABCDEFGH' }];
    for (const body of bad) {
      const r = await call('POST', '/tables/join', { token, raw: JSON.stringify(body) });
      expect([JSON.stringify(body), r.status, r.body]).toEqual([
        JSON.stringify(body),
        400,
        { error: { code: 'INVALID_BODY' } },
      ]);
    }
    // JSON estrito: `null` e texto truncado nem chegam à rota.
    for (const raw of ['{"code":', 'null', '"ABCDEFGH"']) {
      const malformed = await call('POST', '/tables/join', { token, raw });
      expect([raw, malformed.status, malformed.body.error.code]).toEqual([
        raw,
        400,
        'INVALID_JSON',
      ]);
    }
    const text = await call('POST', '/tables/join', {
      token,
      raw: '{"code":"ABCDEFGH"}',
      headers: { 'content-type': 'text/plain' },
    });
    expect(text.status).toBe(415);
    const huge = await call('POST', '/tables/join', { token, body: { code: 'A'.repeat(100_000) } });
    expect(huge.status).toBe(413);
  });

  it('código com formato errado ou tipo errado: INVALID_CODE 400, sem consultar mesa', async () => {
    // Formato errado conta como falha no guard (bloqueio é testado à parte): limiar alto aqui.
    const { call, guest } = await start({
      lobby: { guard: { ...DEFAULT_LOBBY_CONFIG.guard, failLockThreshold: 1000 } },
    });
    const { token } = await guest();
    for (const code of ['abc', 'ABCDEFG0', 'ABCDEFGHI', '', 42, null, { a: 1 }, ['ABCDEFGH']]) {
      const r = await call('POST', '/tables/join', { token, body: { code } });
      expect([JSON.stringify(code), r.status, r.body]).toEqual([
        JSON.stringify(code),
        400,
        { error: { code: 'INVALID_CODE' } },
      ]);
    }
  });

  it('POST /tables: opções inválidas, mesa pública, bo3 público e campos de cliente (seed, roomId): 400 sem criar mesa', async () => {
    const { call, guest } = await start();
    const { token } = await guest();
    const cases: unknown[] = [
      {},
      PUB,
      { ...PRIV, seed: 1 },
      { ...PRIV, roomId: 'x' },
      { ...PRIV, variant: 'truco-do-ze' },
      { ...PRIV, ironHand: 'sim' },
      [PRIV],
    ];
    for (const body of cases) {
      const r = await call('POST', '/tables', { token, raw: JSON.stringify(body) });
      expect([JSON.stringify(body), r.status]).toEqual([JSON.stringify(body), 400]);
      expect(r.body.error.code).toBe('INVALID_OPTIONS');
    }
    // bo3 público é recusado pela validação do protocolo, com o código próprio dela.
    const bo3 = await call('POST', '/queue', { token, body: { ...PUB, format: 'bo3' } });
    expect(bo3.status).toBe(400);
    expect(bo3.body.error.code).toBe('BO3_REQUIRES_PRIVATE');
    // fila com mesa privada: 400
    const wrong = await call('POST', '/queue', { token, body: PRIV });
    expect([wrong.status, wrong.body.error.code]).toEqual([400, 'INVALID_OPTIONS']);
  });
});

describe('mapeamento de erros do lobby para HTTP', () => {
  it('criar mesa devolve 201 com código de 8 caracteres; segunda criação do mesmo usuário: 409 ALREADY_IN_TABLE', async () => {
    const { call, guest } = await start();
    const { token } = await guest();
    const a = await call('POST', '/tables', { token, body: PRIV });
    expect(a.status).toBe(201);
    expect(a.body.code).toMatch(/^[A-HJ-KM-NP-Z2-9]{8}$/);
    expect(a.body.reservation.roomId).toBeTruthy();
    const b = await call('POST', '/tables', { token, body: PRIV });
    expect([b.status, b.body]).toEqual([409, { error: { code: 'ALREADY_IN_TABLE' } }]);
  });

  it('código inexistente: 404 TABLE_UNAVAILABLE idêntico; N falhas bloqueiam com 429 RATE_LIMITED + Retry-After', async () => {
    const { call, guest } = await start({
      lobby: { guard: { ...DEFAULT_LOBBY_CONFIG.guard, failLockThreshold: 3 } },
    });
    const { token } = await guest();
    const first = await call('POST', '/tables/join', { token, body: { code: 'ABCDEFGH' } });
    expect([first.status, first.body]).toEqual([404, { error: { code: 'TABLE_UNAVAILABLE' } }]);
    let last = first;
    for (let i = 0; i < 6; i++) {
      last = await call('POST', '/tables/join', { token, body: { code: 'ABCDEFGH' } });
    }
    expect(last.status).toBe(429);
    expect(last.body).toEqual({ error: { code: 'RATE_LIMITED' } });
    expect(Number(last.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('entrar na fila duas vezes é idempotente; GET /queue e /queue/leave refletem o estado real', async () => {
    const { call, guest } = await start();
    const { token } = await guest();
    expect((await call('GET', '/queue', { token })).body).toEqual({ status: 'idle' });
    const q1 = await call('POST', '/queue', { token, body: PUB });
    expect([q1.status, q1.body.status]).toEqual([200, 'queued']);
    const q2 = await call('POST', '/queue', { token, body: PUB });
    expect([q2.status, q2.body.status]).toEqual([200, 'queued']);
    expect((await call('POST', '/queue/leave', { token })).body).toEqual({ status: 'idle' });
    expect((await call('GET', '/queue', { token })).body).toEqual({ status: 'idle' });
  });

  it('fila lotada: 503 QUEUE_FULL', async () => {
    const { call, guest } = await start({ lobby: { maxQueue: 1 } });
    const a = await guest();
    const b = await guest();
    expect((await call('POST', '/queue', { token: a.token, body: PUB })).status).toBe(200);
    const full = await call('POST', '/queue', { token: b.token, body: PUB });
    expect([full.status, full.body]).toEqual([503, { error: { code: 'QUEUE_FULL' } }]);
  });

  it('reserva falha por token revogado entre os passos (GatewayAuthError 401): 401 UNAUTHORIZED; Redis fora (503): 503 SERVICE_UNAVAILABLE', async () => {
    let status: 401 | 503 = 401;
    const { call, guest } = await start({
      reserve: () => Promise.reject(new GatewayAuthError(status)),
    });
    const a = await guest();
    const r401 = await call('POST', '/tables', { token: a.token, body: PRIV });
    expect([r401.status, r401.body]).toEqual([401, { error: { code: 'UNAUTHORIZED' } }]);
    status = 503;
    const b = await guest();
    const r503 = await call('POST', '/tables', { token: b.token, body: PRIV });
    expect([r503.status, r503.body]).toEqual([503, { error: { code: 'SERVICE_UNAVAILABLE' } }]);
    const join = await call('GET', '/queue', { token: b.token });
    expect(join.status).toBe(200);
  });

  it('falha genérica da reserva do criador: 503 UNAVAILABLE e o usuário fica livre para tentar de novo', async () => {
    let fail = true;
    const { call, guest } = await start({
      reserve: (...a: unknown[]) =>
        fail
          ? Promise.reject(new Error('interno-secreto'))
          : Promise.resolve({ name: 'truco', sessionId: 's', roomId: String(a[0] ?? 'r') }),
    });
    const { token } = await guest();
    const r = await call('POST', '/tables', { token, body: PRIV });
    expect([r.status, r.body]).toEqual([503, { error: { code: 'UNAVAILABLE' } }]);
    expect(JSON.stringify(r.body)).not.toContain('secreto');
    fail = false;
    expect((await call('POST', '/tables', { token, body: PRIV })).status).toBe(201);
  });
});

describe('limites de taxa do lobby', () => {
  it('criar mesa acima do teto por usuário: 429 RATE_LIMITED com Retry-After', async () => {
    const { call, guest } = await start({ lobby: { createPerUserPerMin: 2 } });
    const { token } = await guest();
    // as duas primeiras passam (a 2ª dá 409 por já estar na mesa, mas conta no limite de criação)
    await call('POST', '/tables', { token, body: PRIV });
    await call('POST', '/tables', { token, body: PRIV });
    const third = await call('POST', '/tables', { token, body: PRIV });
    expect([third.status, third.body]).toEqual([429, { error: { code: 'RATE_LIMITED' } }]);
    expect(third.headers.get('retry-after')).toBe('60');
  });

  it('ações por usuário e por IP acima do teto: 429 RATE_LIMITED', async () => {
    const perUser = await start({ lobby: { actionsPerUserPerMin: 2 } });
    const u = await perUser.guest();
    await perUser.call('GET', '/queue', { token: u.token });
    await perUser.call('GET', '/queue', { token: u.token });
    const blocked = await perUser.call('GET', '/queue', { token: u.token });
    expect([blocked.status, blocked.body.error.code]).toEqual([429, 'RATE_LIMITED']);

    const perIp = await start({ lobby: { actionsPerIpPerMin: 2 } });
    const a = await perIp.guest();
    const b = await perIp.guest();
    await perIp.call('GET', '/queue', { token: a.token });
    await perIp.call('GET', '/queue', { token: b.token });
    const ipBlocked = await perIp.call('GET', '/queue', { token: a.token });
    expect([ipBlocked.status, ipBlocked.body.error.code]).toEqual([429, 'RATE_LIMITED']);
    expect(ipBlocked.headers.get('retry-after')).toBe('60');
  });
});
