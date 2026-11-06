/**
 * Fase 6B: `GET /matches`, bloqueio, denúncia e `DELETE /me` (REST sobre repositórios em memória).
 * Mesmo esqueleto de `rest.test.ts`.
 */
import type { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { DEFAULT_AVATAR_PARTS } from '@trucaco/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthService } from '../auth/authService';
import { DEFAULT_LIMITS, type AuthConfig, type RestLimits } from '../auth/config';
import { MemoryTokenStore } from '../auth/tokenStore';
import { createMemoryRepositories } from '../db';
import type { FinishedMatchInput, UserRepository } from '../db/types';
import { setLogSink } from '../logger';
import { emitBlockChange, onBlockChange, onUserDeleted } from '../social/blockBus';
import type { BlockChange } from '../social/blockBus';
import {
  MAX_BLOCKS_PER_USER,
  REPORTS_PER_REPORTED_PER_HOUR,
  installBaseMiddleware,
  mountFallbacks,
  mountRest,
} from './rest';

setLogSink(() => undefined);

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
  await Promise.all(running.splice(0).map((s) => new Promise((r) => s.close(r))));
});

interface Session {
  user: { id: string; nickname: string };
  accessToken: string;
  refreshToken: string;
}

async function start(
  opts: {
    limits?: Partial<RestLimits>;
    noMatches?: boolean;
    wrapUsers?: (base: UserRepository) => UserRepository;
  } = {},
) {
  const repos = createMemoryRepositories();
  const users = opts.wrapUsers === undefined ? repos.users : opts.wrapUsers(repos.users);
  const tokens = new MemoryTokenStore();
  const auth = new AuthService(users, tokens, CFG);
  const app = express();
  installBaseMiddleware(app, { corsOrigins: ['https://app.test'], hsts: false });
  mountRest(app, {
    auth,
    users,
    ...(opts.noMatches === true ? {} : { matches: repos.matches }),
    limits: { ...DEFAULT_LIMITS, perIpPerMin: 10_000, perUserPerMin: 10_000, ...opts.limits },
    corsOrigins: ['https://app.test'],
    trustProxy: false,
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
  return { call, guest, repos, auth, tokens };
}

const code = async (res: Response): Promise<string | undefined> =>
  ((await res.json()) as { error?: { code?: string } }).error?.code;

const finishedMatch = (
  ids: (string | null)[],
  endedAt: Date,
  extra: Partial<FinishedMatchInput> = {},
): FinishedMatchInput => ({
  variant: 'paulista',
  format: 'single',
  ironHand: true,
  visibility: 'public',
  roomCode: null,
  seed: 123456,
  options: { secretOption: 1 },
  events: [{ seq: 1, at: 1, event: { type: 'handStarted' } }],
  deals: [{ hand: 1, cards: ['4C'] }],
  winnerTeam: 0,
  games: [{ score: [12, 8] }],
  status: 'finished',
  startedAt: new Date(endedAt.getTime() - 60_000),
  endedAt,
  players: ids.map((userId, seat) => ({
    seat,
    userId,
    team: (seat % 2) as 0 | 1,
    botFrom: userId === null ? 0 : null,
  })),
  ...extra,
});

describe('GET /matches', () => {
  it('exige autenticação e só aceita GET', async () => {
    const { call, guest } = await start();
    expect((await call('GET', '/matches')).status).toBe(401);
    const a = await guest();
    const res = await call('POST', '/matches', { token: a.accessToken });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET');
  });

  it('lista só as partidas do usuário, datas ISO, sem events/deals/seed nem opções', async () => {
    const { call, guest, repos } = await start();
    const [a, b, c, d, x, y] = [
      await guest(),
      await guest(),
      await guest(),
      await guest(),
      await guest(),
      await guest(),
    ];
    const ended = new Date('2026-11-01T12:00:00Z');
    await repos.matches.saveMatch(
      finishedMatch([a.user.id, b.user.id, c.user.id, d.user.id], ended),
    );
    await repos.matches.saveMatch(
      finishedMatch([x.user.id, y.user.id, null, null], new Date('2026-11-02T12:00:00Z')),
    );
    const res = await call('GET', '/matches', { token: a.accessToken });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toMatch(/"(events|deals|seed|options)"/);
    expect(text).not.toContain('4C');
    expect(text).not.toContain(x.user.id);
    const body = JSON.parse(text) as {
      items: {
        id: string;
        endedAt: string;
        startedAt: string;
        status: string;
        players: { userId: string | null; nickname: string | null; seat: number }[];
      }[];
      nextCursor: string | null;
    };
    expect(body.nextCursor).toBeNull();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.endedAt).toBe(ended.toISOString());
    expect(body.items[0]?.startedAt).toBe(new Date(ended.getTime() - 60_000).toISOString());
    expect(body.items[0]?.players.map((p) => p.nickname)).toEqual(
      [a, b, c, d].map((s) => s.user.nickname),
    );
    // quem não jogou vê lista vazia
    const none = await call('GET', '/matches', { token: (await guest()).accessToken });
    expect(await none.json()).toEqual({ items: [], nextCursor: null });
  });

  it('pagina por cursor e recusa parâmetros inválidos', async () => {
    const { call, guest, repos } = await start();
    const a = await guest();
    for (let i = 1; i <= 3; i++) {
      await repos.matches.saveMatch(
        finishedMatch([a.user.id, null, null, null], new Date(`2026-11-0${i}T12:00:00Z`)),
      );
    }
    const first = (await (
      await call('GET', '/matches?limit=2', { token: a.accessToken })
    ).json()) as {
      items: { endedAt: string }[];
      nextCursor: string | null;
    };
    expect(first.items.map((i) => i.endedAt.slice(0, 10))).toEqual(['2026-11-03', '2026-11-02']);
    expect(first.nextCursor).not.toBeNull();
    const second = (await (
      await call(
        'GET',
        `/matches?limit=2&cursor=${encodeURIComponent(first.nextCursor as string)}`,
        {
          token: a.accessToken,
        },
      )
    ).json()) as { items: { endedAt: string }[]; nextCursor: string | null };
    expect(second.items.map((i) => i.endedAt.slice(0, 10))).toEqual(['2026-11-01']);
    expect(second.nextCursor).toBeNull();
    for (const q of [
      'limit=0',
      'limit=51',
      'limit=abc',
      'limit=1&limit=2',
      'cursor=lixo',
      'cursor=',
    ]) {
      const res = await call('GET', `/matches?${q}`, { token: a.accessToken });
      expect(res.status, q).toBe(400);
      expect(await code(res), q).toBe('INVALID_INPUT');
    }
  });

  it('sem repositório de partidas: página vazia', async () => {
    const { call, guest } = await start({ noMatches: true });
    const a = await guest();
    expect(await (await call('GET', '/matches', { token: a.accessToken })).json()).toEqual({
      items: [],
      nextCursor: null,
    });
  });
});

const afterEachOff: (() => void)[] = [];
afterEach(() => {
  for (const off of afterEachOff.splice(0)) off();
});

describe('bloqueio', () => {
  it('POST bloqueia (204), GET lista com apelido, é idempotente e publica a mudança', async () => {
    const { call, guest } = await start();
    const [a, b] = [await guest(), await guest()];
    const seen: BlockChange[] = [];
    const off = onBlockChange((c) => seen.push(c));
    try {
      for (let i = 0; i < 2; i++) {
        const res = await call('POST', '/me/blocks', {
          token: a.accessToken,
          body: { userId: b.user.id.toUpperCase() },
        });
        expect(res.status).toBe(204);
      }
    } finally {
      off();
    }
    expect(seen).toEqual([
      { blockerId: a.user.id, blockedId: b.user.id, active: true },
      { blockerId: a.user.id, blockedId: b.user.id, active: true },
    ]);
    const list = await call('GET', '/me/blocks', { token: a.accessToken });
    expect(await list.json()).toEqual({
      blocks: [{ userId: b.user.id, nickname: b.user.nickname }],
    });
    // o bloqueado não vê nada
    expect(await (await call('GET', '/me/blocks', { token: b.accessToken })).json()).toEqual({
      blocks: [],
    });
  });

  it('a si mesmo: INVALID_BLOCK; inexistente ou apagado: 204 igual ao sucesso, sem gravar nem publicar', async () => {
    const { call, guest, repos } = await start();
    const [a, b] = [await guest(), await guest()];
    const seen: BlockChange[] = [];
    const off = onBlockChange((c) => seen.push(c));
    afterEachOff.push(off);
    const self = await call('POST', '/me/blocks', {
      token: a.accessToken,
      body: { userId: a.user.id },
    });
    expect(self.status).toBe(400);
    expect(await code(self)).toBe('INVALID_BLOCK');
    await repos.users.deleteUser(b.user.id);
    const gone = await call('POST', '/me/blocks', {
      token: a.accessToken,
      body: { userId: b.user.id },
    });
    const ghost = await call('POST', '/me/blocks', {
      token: a.accessToken,
      body: { userId: randomUUID() },
    });
    expect(gone.status).toBe(204);
    expect(ghost.status).toBe(204);
    expect(await gone.text()).toBe(await ghost.text());
    expect(await repos.users.listBlockedIds(a.user.id)).toEqual([]);
    expect(seen).toEqual([]);
  });

  it('com o teto cheio, alvo existente e inexistente dão a MESMA resposta (400)', async () => {
    const { call, guest, repos } = await start();
    const a = await guest();
    for (let i = 0; i < MAX_BLOCKS_PER_USER; i++) {
      const u = await repos.users.createGuest({
        providerSubject: `g${i}`,
        nickname: `Cheio${String(i).padStart(3, '0')}`,
      });
      await repos.users.addBlock(a.user.id, u.id);
    }
    const real = await guest();
    const answers: unknown[] = [];
    for (const userId of [real.user.id, randomUUID()]) {
      const res = await call('POST', '/me/blocks', { token: a.accessToken, body: { userId } });
      answers.push([res.status, await res.json()]);
    }
    expect(answers[0]).toEqual([400, { error: { code: 'INVALID_BLOCK' } }]);
    expect(answers[1]).toEqual(answers[0]);
  });

  it('corpo inválido: INVALID_BODY (id que não é UUID, chave extra, vazio)', async () => {
    const { call, guest } = await start();
    const a = await guest();
    for (const body of [{ userId: 'x' }, { userId: randomUUID(), extra: 1 }, {}, { userId: 5 }]) {
      const res = await call('POST', '/me/blocks', { token: a.accessToken, body });
      expect(res.status).toBe(400);
      expect(await code(res)).toBe('INVALID_BODY');
    }
    expect((await call('POST', '/me/blocks', { body: { userId: randomUUID() } })).status).toBe(401);
  });

  it('teto de bloqueios por usuário (reblocar quem já está na lista continua permitido)', async () => {
    const { call, guest, repos } = await start();
    const a = await guest();
    const first = await repos.users.createGuest({ providerSubject: 'f0', nickname: 'Alvo000' });
    await repos.users.addBlock(a.user.id, first.id);
    for (let i = 1; i < MAX_BLOCKS_PER_USER; i++) {
      const u = await repos.users.createGuest({
        providerSubject: `f${i}`,
        nickname: `Alvo${String(i).padStart(3, '0')}`,
      });
      await repos.users.addBlock(a.user.id, u.id);
    }
    const extra = await guest();
    const res = await call('POST', '/me/blocks', {
      token: a.accessToken,
      body: { userId: extra.user.id },
    });
    expect(res.status).toBe(400);
    expect(await code(res)).toBe('INVALID_BLOCK');
    expect(
      (await call('POST', '/me/blocks', { token: a.accessToken, body: { userId: first.id } }))
        .status,
    ).toBe(204);
  });

  it('DELETE desbloqueia, é idempotente e publica; id inválido: INVALID_BLOCK', async () => {
    const { call, guest, repos } = await start();
    const [a, b] = [await guest(), await guest()];
    await repos.users.addBlock(a.user.id, b.user.id);
    const seen: BlockChange[] = [];
    const off = onBlockChange((c) => seen.push(c));
    try {
      for (let i = 0; i < 2; i++) {
        const res = await call('DELETE', `/me/blocks/${b.user.id}`, { token: a.accessToken });
        expect(res.status).toBe(204);
      }
      const unknown = await call('DELETE', `/me/blocks/${randomUUID()}`, { token: a.accessToken });
      expect(unknown.status).toBe(204);
    } finally {
      off();
    }
    expect(seen[0]).toEqual({ blockerId: a.user.id, blockedId: b.user.id, active: false });
    expect(await repos.users.listBlockedIds(a.user.id)).toEqual([]);
    const bad = await call('DELETE', '/me/blocks/nao-e-uuid', { token: a.accessToken });
    expect(bad.status).toBe(400);
    expect(await code(bad)).toBe('INVALID_BLOCK');
    expect((await call('DELETE', `/me/blocks/${b.user.id}`)).status).toBe(401);
    expect((await call('GET', `/me/blocks/${b.user.id}`, { token: a.accessToken })).status).toBe(
      405,
    );
  });

  it('rate limit por usuário nas escritas (429 com Retry-After); leitura segue', async () => {
    const { call, guest } = await start({ limits: { perUserPerMin: 12 } });
    const a = await guest();
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await call('POST', '/me/blocks', {
        token: a.accessToken,
        body: { userId: randomUUID() },
      });
      statuses.push(res.status);
      if (res.status === 429) {
        expect(res.headers.get('retry-after')).toBe('60');
        expect(await code(res)).toBe('RATE_LIMITED');
      }
    }
    expect(statuses).toEqual([204, 204, 429]);
  });

  it('preflight do navegador libera o método DELETE', async () => {
    const { call } = await start();
    const res = await call('OPTIONS', '/me/blocks/x', {
      headers: { origin: 'https://app.test', 'access-control-request-method': 'DELETE' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-methods')).toContain('DELETE');
  });
});

type Repos = Awaited<ReturnType<typeof start>>['repos'];
/** Partida terminada em comum entre os usuários (valida denúncia sem `matchId`). */
const shareMatch = (repos: Repos, ids: string[], endedAt: Date = new Date()): Promise<string> =>
  repos.matches.saveMatch(finishedMatch([...ids, null, null, null].slice(0, 4), endedAt));

describe('POST /reports', () => {
  const report = (reportedId: string, extra: object = {}) => ({
    userId: reportedId,
    reason: 'abusive_chat',
    ...extra,
  });

  it('grava, responde 201 {} sem eco e normaliza o texto', async () => {
    const { call, guest, repos } = await start();
    const [a, b] = [await guest(), await guest()];
    await shareMatch(repos, [a.user.id, b.user.id]);
    const res = await call('POST', '/reports', {
      token: a.accessToken,
      body: report(b.user.id.toUpperCase(), { text: 'xingou\nna mesa' }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({});
    expect(repos.store.reports).toHaveLength(1);
    expect(repos.store.reports[0]).toMatchObject({
      reporterId: a.user.id,
      reportedId: b.user.id,
      matchId: null,
      reason: 'abusive_chat',
      text: 'xingou na mesa',
      status: 'open',
    });
  });

  it('contra si mesmo, inexistente ou apagado: INVALID_REPORT (mesma resposta) e nada gravado', async () => {
    const { call, guest, repos } = await start();
    const [a, b] = [await guest(), await guest()];
    await shareMatch(repos, [a.user.id, b.user.id]);
    const self = await call('POST', '/reports', { token: a.accessToken, body: report(a.user.id) });
    expect(self.status).toBe(400);
    expect(await code(self)).toBe('INVALID_REPORT');
    await repos.users.deleteUser(b.user.id);
    const gone = await call('POST', '/reports', { token: a.accessToken, body: report(b.user.id) });
    const ghost = await call('POST', '/reports', {
      token: a.accessToken,
      body: report(randomUUID()),
    });
    // apagado some de `match_players`: sem partida em comum, igual a um id que nunca existiu
    expect(gone.status).toBe(400);
    expect(ghost.status).toBe(400);
    expect(await gone.json()).toEqual(await ghost.json());
    expect(repos.store.reports).toHaveLength(0);
  });

  it('sem matchId: só com partida terminada em comum na janela de 7 dias (qualquer dupla)', async () => {
    const { call, guest, repos } = await start();
    const [a, b, c, d] = [await guest(), await guest(), await guest(), await guest()];
    const stranger = await call('POST', '/reports', {
      token: a.accessToken,
      body: report(b.user.id),
    });
    expect(stranger.status).toBe(400);
    expect(await code(stranger)).toBe('INVALID_REPORT');
    // partida antiga (fora da janela)
    await shareMatch(repos, [a.user.id, b.user.id], new Date(Date.now() - 8 * 24 * 3_600_000));
    expect(
      (await call('POST', '/reports', { token: a.accessToken, body: report(b.user.id) })).status,
    ).toBe(400);
    // adversários (assentos 0 e 1, duplas diferentes) numa partida recente
    await shareMatch(repos, [c.user.id, d.user.id], new Date(Date.now() - 6 * 24 * 3_600_000));
    expect(
      (await call('POST', '/reports', { token: c.accessToken, body: report(d.user.id) })).status,
    ).toBe(201);
    expect(repos.store.reports).toHaveLength(1);
  });

  it('teto global por denunciado: acima de REPORTS_PER_REPORTED_PER_HOUR responde 201 e grava com throttled', async () => {
    const { call, guest, repos } = await start();
    const target = await guest();
    for (let i = 0; i < REPORTS_PER_REPORTED_PER_HOUR + 2; i++) {
      const r = await guest();
      await shareMatch(repos, [r.user.id, target.user.id]);
      const res = await call('POST', '/reports', {
        token: r.accessToken,
        body: report(target.user.id),
      });
      expect(res.status).toBe(201);
    }
    // todas gravadas; só as acima do teto ficam marcadas throttled (fora da fila prioritária)
    expect(repos.store.reports).toHaveLength(REPORTS_PER_REPORTED_PER_HOUR + 2);
    expect(repos.store.reports.filter((r) => r.throttled)).toHaveLength(2);
    expect(
      repos.store.reports.slice(0, REPORTS_PER_REPORTED_PER_HOUR).some((r) => r.throttled),
    ).toBe(false);
  });

  it('repetida com matchId: o UNIQUE barra a corrida (InvalidInputError) e nada é regravado', async () => {
    const { guest, repos } = await start();
    const [a, b] = [await guest(), await guest()];
    const matchId = await shareMatch(repos, [a.user.id, b.user.id]);
    const input = {
      reporterId: a.user.id,
      reportedId: b.user.id,
      matchId,
      reason: 'other',
    } as const;
    await repos.users.createReport(input);
    await expect(repos.users.createReport(input)).rejects.toThrow(/duplicado/);
    expect(repos.store.reports).toHaveLength(1);
  });

  it('matchId: só vale se denunciante e denunciado jogaram; repetida (mesma partida) é 201 sem regravar', async () => {
    const { call, guest, repos } = await start();
    const [a, b, c, outsider] = [await guest(), await guest(), await guest(), await guest()];
    const matchId = await repos.matches.saveMatch(
      finishedMatch([a.user.id, b.user.id, c.user.id, null], new Date('2026-11-01T12:00:00Z')),
    );
    const notThere = await call('POST', '/reports', {
      token: outsider.accessToken,
      body: report(b.user.id, { matchId }),
    });
    expect(notThere.status).toBe(400);
    expect(await code(notThere)).toBe('INVALID_REPORT');
    const reportedAbsent = await call('POST', '/reports', {
      token: a.accessToken,
      body: report(outsider.user.id, { matchId }),
    });
    expect(await code(reportedAbsent)).toBe('INVALID_REPORT');
    const unknownMatch = await call('POST', '/reports', {
      token: a.accessToken,
      body: report(b.user.id, { matchId: randomUUID() }),
    });
    expect(await code(unknownMatch)).toBe('INVALID_REPORT');
    for (let i = 0; i < 2; i++) {
      const ok = await call('POST', '/reports', {
        token: a.accessToken,
        body: report(b.user.id, { matchId }),
      });
      expect(ok.status).toBe(201);
    }
    expect(repos.store.reports).toHaveLength(1);
    expect(repos.store.reports[0]?.matchId).toBe(matchId);
    // outra partida/denunciado segue possível
    expect(
      (
        await call('POST', '/reports', {
          token: a.accessToken,
          body: report(c.user.id, { matchId }),
        })
      ).status,
    ).toBe(201);
    expect(repos.store.reports).toHaveLength(2);
  });

  it('com matchId: inexistente, apagado e existente-sem-partida dão a MESMA resposta', async () => {
    const { call, guest, repos } = await start();
    const [a, b, gone, outsider] = [await guest(), await guest(), await guest(), await guest()];
    const matchId = await repos.matches.saveMatch(
      finishedMatch([a.user.id, b.user.id, gone.user.id, null], new Date('2026-11-01T12:00:00Z')),
    );
    await repos.users.deleteUser(gone.user.id);
    const answers: unknown[] = [];
    for (const reportedId of [randomUUID(), gone.user.id, outsider.user.id]) {
      const res = await call('POST', '/reports', {
        token: a.accessToken,
        body: report(reportedId, { matchId }),
      });
      answers.push([res.status, await res.json()]);
    }
    expect(answers[0]).toEqual([400, { error: { code: 'INVALID_REPORT' } }]);
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
    expect(repos.store.reports).toHaveLength(0);
  });

  it('sem repositório de partidas, matchId é recusado (não dá para validar)', async () => {
    const { call, guest } = await start({ noMatches: true });
    const [a, b] = [await guest(), await guest()];
    const res = await call('POST', '/reports', {
      token: a.accessToken,
      body: report(b.user.id, { matchId: randomUUID() }),
    });
    expect(await code(res)).toBe('INVALID_REPORT');
  });

  it('corpo inválido: motivo desconhecido, texto com controle/bidi, chave extra, texto longo', async () => {
    const { call, guest } = await start();
    const b = await guest();
    const bad: object[] = [
      { userId: b.user.id, reason: 'spam' },
      { userId: b.user.id, reason: 'other', text: 'a‮b' },
      { userId: b.user.id, reason: 'other', text: 'x'.repeat(501) },
      { userId: b.user.id, reason: 'other', text: '' },
      { userId: b.user.id, reason: 'other', extra: true },
      { userId: 'x', reason: 'other' },
    ];
    for (const body of bad) {
      // Um denunciante por tentativa: toda tentativa (inclusive inválida) conta no limite horário.
      const res = await call('POST', '/reports', { token: (await guest()).accessToken, body });
      expect(res.status).toBe(400);
      expect(await code(res)).toBe('INVALID_BODY');
    }
    expect((await call('POST', '/reports', { body: report(b.user.id) })).status).toBe(401);
  });

  it('5 denúncias por hora por usuário: a 6ª é 429 (mesmo inválida conta); outro usuário não é afetado', async () => {
    const { call, guest, repos } = await start();
    const [a, b, other] = [await guest(), await guest(), await guest()];
    await shareMatch(repos, [a.user.id, b.user.id, other.user.id]);
    for (let i = 0; i < 5; i++) {
      const res = await call('POST', '/reports', { token: a.accessToken, body: report(b.user.id) });
      expect(res.status).toBe(201);
    }
    const limited = await call('POST', '/reports', {
      token: a.accessToken,
      body: report(b.user.id),
    });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('3600');
    expect(await code(limited)).toBe('RATE_LIMITED');
    expect(
      (await call('POST', '/reports', { token: other.accessToken, body: report(b.user.id) }))
        .status,
    ).toBe(201);
  });
});

describe('DELETE /me', () => {
  it('apaga a conta: 204, sessões revogadas, usuário e dados sumidos, partidas anonimizadas', async () => {
    const { call, guest, repos, auth } = await start();
    const [a, b, c, d] = [await guest(), await guest(), await guest(), await guest()];
    await repos.users.saveAvatar(a.user.id, DEFAULT_AVATAR_PARTS);
    await repos.users.addBlock(a.user.id, b.user.id);
    const matchId = await repos.matches.saveMatch(
      finishedMatch([a.user.id, b.user.id, c.user.id, d.user.id], new Date('2026-11-01T12:00:00Z')),
    );
    await repos.users.createReport({
      reporterId: b.user.id,
      reportedId: a.user.id,
      matchId,
      reason: 'cheating',
      text: 'texto do b contra a',
    });
    await repos.users.createReport({
      reporterId: a.user.id,
      reportedId: c.user.id,
      matchId,
      reason: 'other',
      text: 'texto livre da a',
    });
    const deleted: string[] = [];
    const off = onUserDeleted((id) => deleted.push(id));
    let res: Response;
    try {
      res = await call('DELETE', '/me', {
        token: a.accessToken,
        body: { refreshToken: a.refreshToken },
      });
    } finally {
      off();
    }
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(deleted).toEqual([a.user.id]);
    expect(await repos.users.findById(a.user.id)).toBeNull();
    expect(await repos.users.listBlockerIds(b.user.id)).toEqual([]);
    // o access antigo e o refresh morrem
    expect((await call('GET', '/me', { token: a.accessToken })).status).toBe(401);
    await expect(auth.refresh(a.refreshToken)).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
    });
    // partida e denúncia ficam, anonimizadas
    expect(repos.store.reports).toHaveLength(2);
    // contra o titular: fica (prova de moderação), com o texto de quem denunciou
    const against = repos.store.reports.find((r) => r.reporterId === b.user.id);
    expect(against).toMatchObject({ reportedId: null, text: 'texto do b contra a' });
    // escrita pelo titular: o texto livre some (LGPD); o resto da linha fica anonimizado
    const filed = repos.store.reports.find((r) => r.reportedId === c.user.id);
    expect(filed).toMatchObject({ reporterId: null, text: null, reason: 'other' });
    const page = await repos.matches.listForUser(b.user.id);
    expect(page.items[0]?.players.map((p) => p.userId)).toEqual([
      null,
      b.user.id,
      c.user.id,
      d.user.id,
    ]);
    expect(JSON.stringify(page)).not.toContain(a.user.nickname);
  });

  it('exige o refresh token do PRÓPRIO usuário e vivo: access sozinho, refresh alheio, lixo ou reusado não apagam', async () => {
    const { call, guest, repos, auth } = await start();
    const [a, b] = [await guest(), await guest()];
    const attempts: { body: unknown; status: number; code: string }[] = [
      { body: {}, status: 400, code: 'INVALID_BODY' },
      { body: { refreshToken: 5 }, status: 400, code: 'INVALID_BODY' },
      { body: { refreshToken: a.refreshToken, all: true }, status: 400, code: 'INVALID_BODY' },
      { body: { refreshToken: 'lixo' }, status: 401, code: 'INVALID_REFRESH_TOKEN' },
      { body: { refreshToken: b.refreshToken }, status: 401, code: 'INVALID_REFRESH_TOKEN' },
    ];
    for (const t of attempts) {
      const res = await call('DELETE', '/me', { token: a.accessToken, body: t.body });
      expect(res.status, JSON.stringify(t.body)).toBe(t.status);
      expect(await code(res)).toBe(t.code);
    }
    // refresh já rotacionado (reuso) também não vale
    const rotated = await auth.refresh(a.refreshToken);
    const reused = await call('DELETE', '/me', {
      token: rotated.accessToken,
      body: { refreshToken: a.refreshToken },
    });
    expect(reused.status).toBe(401);
    expect(await repos.users.findById(a.user.id)).not.toBeNull();
    expect(await repos.users.findById(b.user.id)).not.toBeNull();
    // sem token de acesso: 401
    expect((await call('DELETE', '/me', { body: { refreshToken: b.refreshToken } })).status).toBe(
      401,
    );
  });

  it('falha do banco ao apagar: 500, nada é gasto e o refresh original segue válido', async () => {
    const { call, guest, repos, auth } = await start({
      wrapUsers: (base) => {
        const boom = Object.create(base) as UserRepository;
        boom.deleteUser = () => Promise.reject(new Error('banco fora'));
        return boom;
      },
    });
    const a = await guest();
    const res = await call('DELETE', '/me', {
      token: a.accessToken,
      body: { refreshToken: a.refreshToken },
    });
    expect(res.status).toBe(500);
    expect(await repos.users.findById(a.user.id)).not.toBeNull();
    // sessão intacta: o access antigo ainda vale e o MESMO refresh ainda rotaciona
    expect((await call('GET', '/me', { token: a.accessToken })).status).toBe(200);
    await expect(auth.refresh(a.refreshToken)).resolves.toMatchObject({ expiresIn: 900 });
  });

  it('access ainda válido de uma conta já apagada cai em 401 em toda rota autenticada', async () => {
    const { call, guest, repos } = await start();
    const a = await guest();
    await repos.users.deleteUser(a.user.id);
    for (const [method, path] of [
      ['GET', '/me'],
      ['GET', '/matches'],
      ['GET', '/me/blocks'],
    ] as const) {
      expect((await call(method, path, { token: a.accessToken })).status, path).toBe(401);
    }
    const post = await call('POST', '/reports', {
      token: a.accessToken,
      body: { userId: randomUUID(), reason: 'other' },
    });
    expect(post.status).toBe(401);
  });

  it('o evento de bloqueio sem assinantes não quebra a resposta', () => {
    expect(() => emitBlockChange({ blockerId: 'a', blockedId: 'b', active: true })).not.toThrow();
  });
});
