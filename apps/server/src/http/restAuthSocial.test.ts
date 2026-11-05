/**
 * Fase 6F: `POST /auth/google|apple|link` com o `TestIdentityVerifier` (token `test:<sub>[:<sufixo>]`) e
 * repositórios em memória. A validação real de JWT está em `auth/identity.test.ts`.
 */
import type { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';
import express from 'express';
import { DEFAULT_AVATAR_PARTS } from '@trucaco/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthService, hashRefresh } from '../auth/authService';
import { DEFAULT_LIMITS, type AuthConfig, type RestLimits } from '../auth/config';
import {
  IdentityUnavailableError,
  InvalidIdTokenError,
  TestIdentityVerifier,
} from '../auth/identity';
import type { IdentityVerifier } from '../auth/identity';
import { MemoryTokenStore, TokenStoreUnavailableError } from '../auth/tokenStore';
import { createMemoryRepositories } from '../db';
import type { FinishedMatchInput } from '../db/types';
import { setLogSink } from '../logger';
import { installBaseMiddleware, mountFallbacks, mountRest } from './rest';

const CFG: AuthConfig = {
  secret: new TextEncoder().encode('segredo-de-teste-com-32-bytes-ou-mais!!'),
  issuer: 'trucaco',
  audience: 'trucaco-api',
  accessTtlSec: 900,
  refreshTtlSec: 3600,
  refreshReuseGraceSec: 0,
  refreshFamilyMaxSec: 7_776_000,
  clockToleranceSec: 5,
};

const running: HttpServer[] = [];
afterEach(async () => {
  setLogSink(() => undefined);
  await Promise.all(running.splice(0).map((s) => new Promise((r) => s.close(r))));
});

interface Session {
  user: { id: string; nickname: string };
  accessToken: string;
  refreshToken: string;
}
interface SocialBody extends Session {
  created: boolean;
  expiresIn: number;
}

async function start(
  opts: {
    trustProxy?: boolean;
    limits?: Partial<RestLimits>;
    identity?: IdentityVerifier;
    tokens?: MemoryTokenStore;
  } = {},
) {
  const repos = createMemoryRepositories();
  const tokens = opts.tokens ?? new MemoryTokenStore();
  const auth = new AuthService(
    repos.users,
    tokens,
    CFG,
    Date.now,
    opts.identity ?? new TestIdentityVerifier('test'),
    10,
  );
  const app = express();
  installBaseMiddleware(app, { corsOrigins: [], hsts: false });
  mountRest(app, {
    auth,
    users: repos.users,
    matches: repos.matches,
    progression: repos.progression,
    limits: { ...DEFAULT_LIMITS, perIpPerMin: 10_000, perUserPerMin: 10_000, ...opts.limits },
    corsOrigins: [],
    trustProxy: opts.trustProxy ?? false,
  });
  mountFallbacks(app);
  const server = await new Promise<HttpServer>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  running.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (
    method: string,
    path: string,
    init: { body?: unknown; token?: string; headers?: Record<string, string> } = {},
  ): Promise<Response> =>
    fetch(`${base}${path}`, {
      method,
      headers: {
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(init.token !== undefined ? { authorization: `Bearer ${init.token}` } : {}),
        ...init.headers,
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  const guest = async (): Promise<Session> => {
    const { user, pair } = await auth.createGuest();
    return { user, accessToken: pair.accessToken, refreshToken: pair.refreshToken };
  };
  /** Nonce emitido pelo serviço (o que `GET /auth/nonce` faz); os testes de rota do nonce usam o HTTP. */
  const nonce = async (): Promise<string> => (await auth.issueNonce()).nonce;
  const login = async (provider: 'google' | 'apple', idToken: string, extra: object = {}) =>
    call('POST', `/auth/${provider}`, {
      body: { provider, idToken, nonce: await nonce(), ...extra },
    });
  const link = async (
    s: Session,
    provider: 'google' | 'apple',
    idToken: string,
    extra: object = {},
  ) =>
    call('POST', '/auth/link', {
      token: s.accessToken,
      body: { provider, idToken, nonce: await nonce(), ...extra },
    });
  return { call, guest, login, link, nonce, repos, auth, tokens, base };
}

const code = async (res: Response): Promise<string | undefined> =>
  ((await res.json()) as { error?: { code?: string } }).error?.code;

const finishedMatch = (ids: string[]): FinishedMatchInput => ({
  variant: 'paulista',
  format: 'single',
  ironHand: true,
  visibility: 'public',
  roomCode: null,
  seed: 1,
  options: {},
  events: [{ seq: 1, at: 1, event: { type: 'handStarted' } }],
  deals: [{ hand: 1, cards: ['4C'] }],
  winnerTeam: 0,
  games: [{ score: [12, 8] }],
  status: 'finished',
  startedAt: new Date('2026-11-01T11:00:00Z'),
  endedAt: new Date('2026-11-01T12:00:00Z'),
  players: ids.map((userId, seat) => ({
    seat,
    userId,
    team: (seat % 2) as 0 | 1,
    botFrom: null,
  })),
});

describe('POST /auth/google e /auth/apple', () => {
  it('conta nova: 201 created, apelido gerado (sem dado do provedor), par de tokens utilizável', async () => {
    const { login, call, repos } = await start();
    const res = await login('google', 'test:alice');
    expect(res.status).toBe(201);
    const body = (await res.json()) as SocialBody;
    expect(body.created).toBe(true);
    expect(body.user.nickname).toMatch(/^Jogador\d+$/);
    expect(body.expiresIn).toBe(900);
    const stored = await repos.users.findByProvider('google', 'alice');
    expect(stored?.id).toBe(body.user.id);
    expect(stored?.linkedAt).toBeNull();
    const me = (await (await call('GET', '/me', { token: body.accessToken })).json()) as {
      provider: string;
    };
    expect(me.provider).toBe('google');
  });

  it('conta existente: 200, mesmo id, sem criar outra; Apple e Google são contas distintas', async () => {
    const { login, repos } = await start();
    const first = (await (await login('google', 'test:bob:1')).json()) as SocialBody;
    const again = await login('google', 'test:bob:2');
    expect(again.status).toBe(200);
    const body = (await again.json()) as SocialBody;
    expect(body.created).toBe(false);
    expect(body.user.id).toBe(first.user.id);
    expect(repos.store.users.size).toBe(1);
    const apple = await login('apple', 'test:bob');
    expect(apple.status).toBe(201);
    expect(((await apple.json()) as SocialBody).user.id).not.toBe(first.user.id);
    expect(repos.store.users.size).toBe(2);
  });

  it('idToken é de uso único: a segunda apresentação é INVALID_ID_TOKEN (sem criar nem entrar)', async () => {
    const { login } = await start();
    expect((await login('google', 'test:carol')).status).toBe(201);
    const replay = await login('google', 'test:carol');
    expect(replay.status).toBe(401);
    expect(await code(replay)).toBe('INVALID_ID_TOKEN');
    // o mesmo texto em outro provedor é outro token
    expect((await login('apple', 'test:carol')).status).toBe(201);
  });

  it('token inválido: 401 INVALID_ID_TOKEN, nada é criado e a resposta não depende de a conta existir', async () => {
    const { login, repos } = await start();
    await login('google', 'test:dave');
    const before = repos.store.users.size;
    const a = await login('google', 'invalido');
    const b = await login('google', 'test:dave tem espaco');
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    const [bodyA, bodyB] = [await a.text(), await b.text()];
    expect(JSON.parse(bodyA)).toEqual({ error: { code: 'INVALID_ID_TOKEN' } });
    expect(bodyA).toBe(bodyB);
    expect(repos.store.users.size).toBe(before);
  });

  it('corpo inválido: provider diferente da rota, chaves extras, tipos errados, vazio e sem JSON', async () => {
    const { call } = await start();
    const bad: unknown[] = [
      { provider: 'apple', idToken: 'test:x' },
      { provider: 'guest', idToken: 'test:x' },
      { provider: 'google', idToken: 'test:x', extra: 1 },
      { provider: 'google', idToken: 5 },
      { provider: 'google', idToken: '' },
      { provider: 'google', idToken: 'x'.repeat(4097) },
      { provider: 'google', idToken: 'test:x', nonce: 5 },
      { provider: 'google', idToken: 'test:x', nonce: '' },
      { provider: 'google', idToken: 'test:x' },
      { idToken: 'test:x' },
      {},
      [],
    ];
    for (const body of bad) {
      const res = await call('POST', '/auth/google', { body });
      expect(res.status, JSON.stringify(body).slice(0, 60)).toBe(400);
      expect(await code(res)).toBe('INVALID_BODY');
    }
    const noBody = await call('POST', '/auth/google');
    expect(noBody.status).toBe(400);
  });

  it('só aceita POST e exige Content-Type JSON', async () => {
    const { call, base } = await start();
    const get = await call('GET', '/auth/google');
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
    const text = await fetch(`${base}/auth/apple`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'oi',
    });
    expect(text.status).toBe(415);
  });

  it('provedor desligado: SOCIAL_LOGIN_DISABLED (503) só para ele; o outro segue', async () => {
    const identity: IdentityVerifier = {
      isEnabled: (p) => p === 'google',
      verify: async (_p, token) => ({
        subject: token,
        expiresAt: Math.floor(Date.now() / 1000) + 60,
      }),
    };
    const { login, repos } = await start({ identity });
    const off = await login('apple', 'qualquer');
    expect(off.status).toBe(503);
    expect(await code(off)).toBe('SOCIAL_LOGIN_DISABLED');
    expect((await login('google', 'sub-1')).status).toBe(201);
    expect(repos.store.users.size).toBe(1);
  });

  it('servidor sem verificador (padrão): tudo desligado', async () => {
    const repos = createMemoryRepositories();
    const auth = new AuthService(repos.users, new MemoryTokenStore(), CFG);
    expect(auth.socialProviders()).toEqual([]);
    await expect(auth.loginSocial('google', 'test:x', 'n')).rejects.toMatchObject({
      code: 'SOCIAL_LOGIN_DISABLED',
    });
  });

  it('dois logins concorrentes do mesmo sub criam UMA conta (um 201, outro 200)', async () => {
    const { login, repos } = await start();
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => login('google', `test:corrida:${i}`)),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 200)).toHaveLength(5);
    const ids = new Set(
      await Promise.all(results.map(async (r) => ((await r.json()) as SocialBody).user.id)),
    );
    expect(ids.size).toBe(1);
    expect(repos.store.users.size).toBe(1);
  });

  it('rate limit por IP: excedeu, 429 com Retry-After (vale para as três rotas)', async () => {
    const { login, link, guest } = await start({ limits: { socialPerIpPerMin: 2 } });
    expect((await login('google', 'test:r1')).status).toBe(201);
    expect((await login('google', 'test:r2')).status).toBe(201);
    const limited = await login('google', 'test:r3');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    expect(await code(limited)).toBe('RATE_LIMITED');
    expect((await login('apple', 'test:r4')).status).toBe(429);
    expect((await link(await guest(), 'google', 'test:r5')).status).toBe(429);
  });

  it('token e sub não vão para o log', async () => {
    const lines: string[] = [];
    setLogSink((_l, msg, f) => lines.push(JSON.stringify({ msg, ...f })));
    const { login, link, guest } = await start();
    await login('google', 'test:segredinho:abc');
    await login('google', 'test:segredinho:abc');
    await login('google', 'lixo-secreto');
    await link(await guest(), 'google', 'test:segredinho:zzz');
    const text = lines.join('\n');
    expect(text).not.toContain('segredinho');
    expect(text).not.toContain('lixo-secreto');
    expect(text).toContain('login social');
  });
});

describe('POST /auth/link', () => {
  it('vincula o convidado: mesmo id e apelido, provider vira google, linkedAt gravado, par novo', async () => {
    const { guest, link, login, call, repos } = await start();
    const g = await guest();
    const res = await link(g, 'google', 'test:vinc1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as SocialBody;
    expect(body.created).toBe(false);
    expect(body.user).toEqual({ id: g.user.id, nickname: g.user.nickname });
    expect(body.accessToken).not.toBe(g.accessToken);
    expect(body.refreshToken).not.toBe(g.refreshToken);
    const stored = await repos.users.findById(g.user.id);
    expect(stored?.provider).toBe('google');
    expect(stored?.providerSubject).toBe('vinc1');
    expect(stored?.linkedAt).toBeInstanceOf(Date);
    const me = (await (await call('GET', '/me', { token: body.accessToken })).json()) as {
      provider: string;
    };
    expect(me.provider).toBe('google');
    // o login social posterior com o mesmo sub entra na MESMA conta
    const again = await login('google', 'test:vinc1:outro');
    expect(again.status).toBe(200);
    expect(((await again.json()) as SocialBody).user.id).toBe(g.user.id);
  });

  it('mantém histórico, avatar, estatísticas e combinados (o id não muda)', async () => {
    const { guest, link, call, repos } = await start();
    const [g, b, c, d] = [await guest(), await guest(), await guest(), await guest()];
    await repos.users.saveAvatar(g.user.id, DEFAULT_AVATAR_PARTS);
    await repos.matches.saveMatch(finishedMatch([g.user.id, b.user.id, c.user.id, d.user.id]));
    const body = (await (await link(g, 'apple', 'test:keeper')).json()) as SocialBody;
    const matches = (await (await call('GET', '/matches', { token: body.accessToken })).json()) as {
      items: unknown[];
    };
    expect(matches.items).toHaveLength(1);
    const me = (await (await call('GET', '/me', { token: body.accessToken })).json()) as {
      avatar: unknown;
      provider: string;
    };
    expect(me.avatar).toEqual(DEFAULT_AVATAR_PARTS);
    expect(me.provider).toBe('apple');
    expect(repos.store.matches[0]?.input.players[0]?.userId).toBe(g.user.id);
  });

  it('revoga as sessões de TODOS os aparelhos: access vigente e refresh de cada família morrem', async () => {
    const { guest, link, call, auth, tokens } = await start();
    const g = await guest();
    // segundo aparelho: outra família de refresh do mesmo usuário
    const access2 = await auth.jwt.sign(g.user.id);
    const refresh2 = 'B'.repeat(43);
    await tokens.createFamily({
      familyId: '11111111-1111-4111-8111-111111111111',
      userId: g.user.id,
      refreshHash: hashRefresh(refresh2),
      jti: access2.jti,
      ttlSec: 600,
    });
    expect((await call('GET', '/me', { token: access2.token })).status).toBe(200);
    const res = await link(g, 'google', 'test:revoga');
    expect(res.status).toBe(200);
    const fresh = (await res.json()) as SocialBody;
    expect((await call('GET', '/me', { token: g.accessToken })).status).toBe(401);
    expect((await call('GET', '/me', { token: access2.token })).status).toBe(401);
    await expect(auth.refresh(g.refreshToken)).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
    });
    await expect(auth.refresh(refresh2)).rejects.toMatchObject({ code: 'INVALID_REFRESH_TOKEN' });
    // o par novo funciona
    expect((await call('GET', '/me', { token: fresh.accessToken })).status).toBe(200);
    await expect(auth.refresh(fresh.refreshToken)).resolves.toMatchObject({ expiresIn: 900 });
  });

  it('exige autenticação', async () => {
    const { call } = await start();
    const res = await call('POST', '/auth/link', {
      body: { provider: 'google', idToken: 'test:x', nonce: 'n' },
    });
    expect(res.status).toBe(401);
    expect(await code(res)).toBe('UNAUTHORIZED');
  });

  it('ALREADY_LINKED: convidado já vinculado e conta nascida social (e o idToken não é gasto)', async () => {
    const { guest, link, login, repos } = await start();
    const g = await guest();
    const ok = (await (await link(g, 'google', 'test:uma')).json()) as SocialBody;
    const second = await link({ ...g, accessToken: ok.accessToken }, 'apple', 'test:duas');
    expect(second.status).toBe(409);
    expect(await code(second)).toBe('ALREADY_LINKED');
    expect((await repos.users.findById(g.user.id))?.provider).toBe('google');
    const social = (await (await login('apple', 'test:nativo')).json()) as SocialBody;
    const third = await link(social, 'google', 'test:tres');
    expect(third.status).toBe(409);
    expect(await code(third)).toBe('ALREADY_LINKED');
    // o token da tentativa recusada continua utilizável
    expect((await login('google', 'test:duas')).status).toBe(201);
  });

  it('PROVIDER_TAKEN: o sub é de outra conta; o idToken NÃO é gasto e serve para entrar nela', async () => {
    const { guest, link, login, call, repos } = await start();
    const owner = (await (await login('google', 'test:dono:1')).json()) as SocialBody;
    const g = await guest();
    const res = await link(g, 'google', 'test:dono:2');
    expect(res.status).toBe(409);
    expect(await code(res)).toBe('PROVIDER_TAKEN');
    expect((await repos.users.findById(g.user.id))?.provider).toBe('guest');
    const enter = await login('google', 'test:dono:2');
    expect(enter.status).toBe(200);
    expect(((await enter.json()) as SocialBody).user.id).toBe(owner.user.id);
    // a sessão do convidado continua viva (nada foi revogado) e o vínculo não foi gravado
    expect((await call('GET', '/me', { token: g.accessToken })).status).toBe(200);
    expect((await repos.users.findById(g.user.id))?.linkedAt).toBeNull();
  });

  it('token inválido, reapresentado ou provedor desligado: nada muda e a sessão segue', async () => {
    const { guest, link, call, repos } = await start();
    const g = await guest();
    const bad = await link(g, 'google', 'lixo');
    expect(bad.status).toBe(401);
    expect(await code(bad)).toBe('INVALID_ID_TOKEN');
    expect((await call('GET', '/me', { token: g.accessToken })).status).toBe(200);
    expect((await repos.users.findById(g.user.id))?.provider).toBe('guest');
    // vínculo ok, depois outro convidado reapresenta o MESMO token: o sub já é de outra conta
    expect((await link(g, 'google', 'test:uso')).status).toBe(200);
    const g2 = await guest();
    expect(await code(await link(g2, 'google', 'test:uso'))).toBe('PROVIDER_TAKEN');
  });

  it('corpo inválido (sem eco): provider fora do catálogo, chaves extras, tipos errados', async () => {
    const { guest, call } = await start();
    const g = await guest();
    for (const body of [
      { provider: 'guest', idToken: 'test:x' },
      { provider: 'google', idToken: 'test:x', userId: 'outro' },
      { provider: 'google' },
      { idToken: 'test:x' },
      {},
    ]) {
      const res = await call('POST', '/auth/link', { token: g.accessToken, body });
      expect(res.status).toBe(400);
      expect(await code(res)).toBe('INVALID_BODY');
    }
  });

  it('o userId vem só do token: não dá para vincular a conta de outro', async () => {
    const { guest, link, repos } = await start();
    const [a, b] = [await guest(), await guest()];
    await link(a, 'google', 'test:so-a');
    expect((await repos.users.findById(b.user.id))?.provider).toBe('guest');
    expect((await repos.users.findById(a.user.id))?.provider).toBe('google');
  });

  it('dois convidados disputando o mesmo sub: exatamente um vincula, o outro é PROVIDER_TAKEN', async () => {
    const { guest, link, repos } = await start();
    const gs = await Promise.all([guest(), guest(), guest(), guest()]);
    const results = await Promise.all(gs.map((g, i) => link(g, 'google', `test:disputa:${i}`)));
    const ok = results.filter((r) => r.status === 200);
    expect(ok).toHaveLength(1);
    for (const r of results.filter((x) => x.status !== 200)) {
      expect(r.status).toBe(409);
    }
    let linked = 0;
    for (const g of gs)
      if ((await repos.users.findById(g.user.id))?.provider === 'google') linked++;
    expect(linked).toBe(1);
  });

  it('o mesmo convidado vinculando dois provedores ao mesmo tempo: só um vale', async () => {
    const { guest, link, repos } = await start();
    const g = await guest();
    const results = await Promise.all([
      link(g, 'google', 'test:par:g'),
      link(g, 'apple', 'test:par:a'),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const loser = results.find((r) => r.status !== 200);
    expect([401, 409]).toContain(loser?.status);
    const user = await repos.users.findById(g.user.id);
    expect(user?.provider === 'google' || user?.provider === 'apple').toBe(true);
    // não sobrou conta social órfã: só o convidado original existe
    expect(repos.store.users.size).toBe(1);
  });
});

describe('POST /auth/link: falhas do Redis e retomada', () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('revogação falha depois do UPDATE: o par novo sai mesmo assim e a revogação é refeita', async () => {
    const tokens = new MemoryTokenStore();
    const { guest, link, call, repos, auth } = await start({ tokens });
    const g = await guest();
    const original = tokens.revokeAllForUser.bind(tokens);
    let failures = 1;
    tokens.revokeAllForUser = async (...a) => {
      if (failures-- > 0) throw new TokenStoreUnavailableError();
      return original(...a);
    };
    const res = await link(g, 'google', 'test:falha1');
    expect(res.status).toBe(200);
    const fresh = (await res.json()) as SocialBody;
    expect((await repos.users.findById(g.user.id))?.provider).toBe('google');
    // o par novo vale desde já
    expect((await call('GET', '/me', { token: fresh.accessToken })).status).toBe(200);
    await sleep(200);
    expect((await call('GET', '/me', { token: g.accessToken })).status).toBe(401);
    await expect(auth.refresh(g.refreshToken)).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
    });
    // o reagendamento NÃO matou o par novo (família preservada)
    expect((await call('GET', '/me', { token: fresh.accessToken })).status).toBe(200);
    await expect(auth.refresh(fresh.refreshToken)).resolves.toMatchObject({ expiresIn: 900 });
  });

  it('emissão do par falha depois do UPDATE: 503, nada revogado, e repetir o mesmo idToken retoma', async () => {
    const tokens = new MemoryTokenStore();
    const { guest, link, call, repos, auth } = await start({ tokens });
    const g = await guest();
    const original = tokens.createFamily.bind(tokens);
    let failures = 1;
    tokens.createFamily = async (i) => {
      if (failures-- > 0) throw new TokenStoreUnavailableError();
      return original(i);
    };
    const first = await link(g, 'google', 'test:falha2');
    expect(first.status).toBe(503);
    expect(await code(first)).toBe('SERVICE_UNAVAILABLE');
    expect((await repos.users.findById(g.user.id))?.provider).toBe('google');
    // sessão antiga intacta: o cliente não fica preso
    expect((await call('GET', '/me', { token: g.accessToken })).status).toBe(200);
    // retomada: mesma conta, mesmo sub, o MESMO idToken (já consumido) -> par novo
    const again = await link(g, 'google', 'test:falha2');
    expect(again.status).toBe(200);
    const fresh = (await again.json()) as SocialBody;
    expect(fresh.user.id).toBe(g.user.id);
    expect((await call('GET', '/me', { token: g.accessToken })).status).toBe(401);
    await expect(auth.refresh(g.refreshToken)).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
    });
    expect((await call('GET', '/me', { token: fresh.accessToken })).status).toBe(200);
  });

  it('conta já vinculada: mesmo provedor e mesmo sub = par novo; sub diferente, outro provedor ou token inválido não', async () => {
    const { guest, link } = await start();
    const g = await guest();
    const ok = (await (await link(g, 'google', 'test:mesmo:1')).json()) as SocialBody;
    const s2 = { ...g, accessToken: ok.accessToken };
    const again = await link(s2, 'google', 'test:mesmo:2');
    expect(again.status).toBe(200);
    const body = (await again.json()) as SocialBody;
    expect(body.user.id).toBe(g.user.id);
    expect(body.refreshToken).not.toBe(ok.refreshToken);
    const s3 = { ...g, accessToken: body.accessToken };
    expect(await code(await link(s3, 'google', 'test:outro'))).toBe('ALREADY_LINKED');
    expect(await code(await link(s3, 'apple', 'test:mesmo'))).toBe('ALREADY_LINKED');
    expect(await code(await link(s3, 'google', 'lixo'))).toBe('INVALID_ID_TOKEN');
  });

  it('conta nascida social não usa a retomada: continua ALREADY_LINKED mesmo com o mesmo sub', async () => {
    const { login, link } = await start();
    const social = (await (await login('google', 'test:nativo:1')).json()) as SocialBody;
    expect(await code(await link(social, 'google', 'test:nativo:2'))).toBe('ALREADY_LINKED');
  });

  it('JWKS fora do ar: 503 SERVICE_UNAVAILABLE no login e no vínculo, sem gastar o token nem mudar nada', async () => {
    let down = true;
    const identity: IdentityVerifier = {
      isEnabled: () => true,
      verify: async (_p, token) => {
        if (down) throw new IdentityUnavailableError();
        return { subject: token, expiresAt: Math.floor(Date.now() / 1000) + 60 };
      },
    };
    const { login, link, guest, repos } = await start({ identity });
    const g = await guest();
    const a = await login('google', 'sub-x');
    const b = await link(g, 'google', 'sub-y');
    for (const r of [a, b]) {
      expect(r.status).toBe(503);
      expect(await code(r)).toBe('SERVICE_UNAVAILABLE');
    }
    expect(repos.store.users.size).toBe(1);
    down = false;
    expect((await login('google', 'sub-x')).status).toBe(201);
    expect((await link(g, 'google', 'sub-y')).status).toBe(200);
  });
});

describe('GET /auth/nonce e o nonce do login social', () => {
  /** Verificador que amarra o idToken ao nonce, como a claim `nonce` faz: `tok:<sub>:<nonce>`. */
  const bound: IdentityVerifier = {
    isEnabled: () => true,
    verify: async (_p, token, nonce) => {
      const [kind, sub, n] = token.split(':');
      if (kind !== 'tok' || sub === undefined || n !== nonce) throw new InvalidIdTokenError();
      return { subject: sub, expiresAt: Math.floor(Date.now() / 1000) + 60 };
    },
  };

  it('emite nonce aleatório de uso único com validade de 300 s, sem cache', async () => {
    const { call } = await start();
    const a = await call('GET', '/auth/nonce');
    expect(a.status).toBe(200);
    expect(a.headers.get('cache-control')).toBe('no-store');
    const body = (await a.json()) as { nonce: string; expiresIn: number };
    expect(body.expiresIn).toBe(300);
    expect(body.nonce).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const b = (await (await call('GET', '/auth/nonce')).json()) as { nonce: string };
    expect(b.nonce).not.toBe(body.nonce);
  });

  it('só GET; sem provedor ligado responde 503 SOCIAL_LOGIN_DISABLED e não grava nada', async () => {
    const { call } = await start();
    const post = await call('POST', '/auth/nonce', { body: {} });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET');
    const off = await start({ identity: { isEnabled: () => false, verify: bound.verify } });
    const res = await off.call('GET', '/auth/nonce');
    expect(res.status).toBe(503);
    expect(await code(res)).toBe('SOCIAL_LOGIN_DISABLED');
  });

  it('rate limit por IP próprio (não gasta o limite do login)', async () => {
    const { call, login } = await start({ limits: { noncePerIpPerMin: 2 } });
    expect((await call('GET', '/auth/nonce')).status).toBe(200);
    expect((await call('GET', '/auth/nonce')).status).toBe(200);
    const limited = await call('GET', '/auth/nonce');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    expect((await login('google', 'test:ok')).status).toBe(201);
  });

  it('limite GLOBAL do nonce vale para IPs diferentes (proxy confiável)', async () => {
    const { call } = await start({ limits: { nonceGlobalPerMin: 2 }, trustProxy: true });
    const ask = (ip: string) => call('GET', '/auth/nonce', { headers: { 'x-forwarded-for': ip } });
    expect((await ask('1.1.1.1')).status).toBe(200);
    expect((await ask('2.2.2.2')).status).toBe(200);
    const limited = await ask('3.3.3.3');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
  });

  it('login exige nonce emitido por nós: inventado, reusado e já consumido dão INVALID_ID_TOKEN', async () => {
    const { call, nonce } = await start();
    const invented = await call('POST', '/auth/google', {
      body: { provider: 'google', idToken: 'test:n1', nonce: 'inventado-pelo-cliente' },
    });
    expect(invented.status).toBe(401);
    expect(await code(invented)).toBe('INVALID_ID_TOKEN');
    const n = await nonce();
    const ok = await call('POST', '/auth/google', {
      body: { provider: 'google', idToken: 'test:n2', nonce: n },
    });
    expect(ok.status).toBe(201);
    // o mesmo nonce com OUTRO idToken (outro sub): consumido, recusado, nada criado
    const replay = await call('POST', '/auth/apple', {
      body: { provider: 'apple', idToken: 'test:n3', nonce: n },
    });
    expect(replay.status).toBe(401);
    expect(await code(replay)).toBe('INVALID_ID_TOKEN');
  });

  it('nonce expira em 5 minutos', async () => {
    let clock = 1_000_000;
    const tokens = new MemoryTokenStore(() => clock);
    const { call, nonce } = await start({ tokens });
    const n = await nonce();
    clock += 301_000;
    const res = await call('POST', '/auth/google', {
      body: { provider: 'google', idToken: 'test:exp', nonce: n },
    });
    expect(res.status).toBe(401);
    expect(await code(res)).toBe('INVALID_ID_TOKEN');
  });

  it('a claim tem de bater com o nonce enviado; idToken recusado NÃO queima o nonce', async () => {
    const { call, nonce, repos } = await start({ identity: bound });
    const n = await nonce();
    const wrong = await call('POST', '/auth/google', {
      body: { provider: 'google', idToken: 'tok:ana:outro-nonce', nonce: n },
    });
    expect(wrong.status).toBe(401);
    expect(repos.store.users.size).toBe(0);
    const ok = await call('POST', '/auth/google', {
      body: { provider: 'google', idToken: `tok:ana:${n}`, nonce: n },
    });
    expect(ok.status).toBe(201);
    // consumido: o mesmo par não entra de novo
    const again = await call('POST', '/auth/google', {
      body: { provider: 'google', idToken: `tok:ana:${n}`, nonce: n },
    });
    expect(again.status).toBe(401);
  });

  it('vínculo: PROVIDER_TAKEN não gasta o nonce (serve para entrar na conta dona); sucesso o gasta', async () => {
    const { call, nonce, guest } = await start({ identity: bound });
    const owner = await nonce();
    await call('POST', '/auth/google', {
      body: { provider: 'google', idToken: `tok:dono:${owner}`, nonce: owner },
    });
    const g = await guest();
    const n = await nonce();
    const token = `tok:dono:${n}`;
    const taken = await call('POST', '/auth/link', {
      token: g.accessToken,
      body: { provider: 'google', idToken: token, nonce: n },
    });
    expect(taken.status).toBe(409);
    expect(await code(taken)).toBe('PROVIDER_TAKEN');
    const enter = await call('POST', '/auth/google', {
      body: { provider: 'google', idToken: token, nonce: n },
    });
    expect(enter.status).toBe(200);
    // vínculo bem-sucedido consome o nonce
    const g2 = await guest();
    const n2 = await nonce();
    const linked = await call('POST', '/auth/link', {
      token: g2.accessToken,
      body: { provider: 'apple', idToken: `tok:novo:${n2}`, nonce: n2 },
    });
    expect(linked.status).toBe(200);
    const g3 = await guest();
    const reuse = await call('POST', '/auth/link', {
      token: g3.accessToken,
      body: { provider: 'apple', idToken: `tok:outro:${n2}`, nonce: n2 },
    });
    expect(reuse.status).toBe(401);
  });

  it('o nonce não vai para o log', async () => {
    const lines: string[] = [];
    setLogSink((_l, msg, f) => lines.push(JSON.stringify({ msg, ...f })));
    const { call, nonce } = await start();
    const n = await nonce();
    await call('POST', '/auth/google', {
      body: { provider: 'google', idToken: 'test:logn', nonce: n },
    });
    await call('POST', '/auth/google', {
      body: { provider: 'google', idToken: 'test:logn2', nonce: n },
    });
    expect(lines.join('\n')).not.toContain(n);
  });
});
