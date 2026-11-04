/**
 * Fase 6E: `GET /me` com `stats`, `/me/achievements`, `/me/missions` e `GET /users/:id` (REST sobre
 * repositórios em memória). Mesmo esqueleto de `restSocial.test.ts`.
 */
import type { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import express from 'express';
import {
  ACHIEVEMENT_IDS,
  DAILY_MISSIONS_PER_DAY,
  DEFAULT_AVATAR_PARTS,
  MISSION_DEFINITIONS,
} from '@trucaco/protocol';
import type {
  AchievementsResponse,
  MeResponse,
  MissionsResponse,
  PublicProfileResponse,
} from '@trucaco/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthService } from '../auth/authService';
import { DEFAULT_LIMITS, type AuthConfig } from '../auth/config';
import { MemoryTokenStore } from '../auth/tokenStore';
import { createMemoryRepositories } from '../db';
import type { FinishedMatchInput, UserProgressDelta } from '../db/types';
import { setLogSink } from '../logger';
import { dailyMissionsFor } from '../progression/missions';
import { installBaseMiddleware, mountFallbacks, mountRest } from './rest';

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

async function start(opts: { noProgression?: boolean; clock?: { at: Date } } = {}) {
  const repos = createMemoryRepositories();
  const tokens = new MemoryTokenStore();
  const auth = new AuthService(repos.users, tokens, CFG);
  const clock = opts.clock ?? { at: new Date('2026-11-04T15:00:00Z') };
  const app = express();
  installBaseMiddleware(app, { corsOrigins: [], hsts: false });
  mountRest(app, {
    auth,
    users: repos.users,
    matches: repos.matches,
    ...(opts.noProgression === true ? {} : { progression: repos.progression }),
    now: () => clock.at,
    limits: { ...DEFAULT_LIMITS, perIpPerMin: 10_000, perUserPerMin: 10_000 },
    corsOrigins: [],
    trustProxy: false,
  });
  mountFallbacks(app);
  const server = await new Promise<HttpServer>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  running.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (method: string, path: string, token?: string, body?: unknown): Promise<Response> =>
    fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token !== undefined ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  const guest = async (): Promise<{ id: string; nickname: string; token: string }> => {
    const { user, pair } = await auth.createGuest();
    return { id: user.id, nickname: user.nickname, token: pair.accessToken };
  };
  /** Grava uma partida só para satisfazer a FK e aplica a progressão pedida. */
  const applyProgress = async (deltas: UserProgressDelta[]): Promise<void> => {
    const endedAt = new Date('2026-11-04T12:00:00Z');
    const input: FinishedMatchInput = {
      variant: 'paulista',
      format: 'single',
      ironHand: true,
      visibility: 'public',
      roomCode: null,
      seed: 1,
      options: {},
      events: [],
      deals: null,
      winnerTeam: 0,
      games: [],
      status: 'finished',
      startedAt: new Date(endedAt.getTime() - 60_000),
      endedAt,
      players: [],
    };
    const matchId = await repos.matches.saveMatch(input);
    await repos.progression.applyMatchProgress(matchId, deltas);
  };
  return { call, guest, repos, applyProgress, clock };
}

const code = async (res: Response): Promise<string | undefined> =>
  ((await res.json()) as { error?: { code?: string } }).error?.code;

describe('GET /me: stats reais', () => {
  it('zeros sem partidas e números reais depois da progressão', async () => {
    const { call, guest, applyProgress } = await start();
    const a = await guest();
    const before = (await (await call('GET', '/me', a.token)).json()) as MeResponse;
    expect(before.stats).toEqual({
      paulista: { played: 0, won: 0 },
      mineiro: { played: 0, won: 0 },
    });
    await applyProgress([
      { userId: a.id, variant: 'mineiro', played: 1, won: 1, achievements: [], missions: [] },
    ]);
    const after = (await (await call('GET', '/me', a.token)).json()) as MeResponse;
    expect(after.stats).toEqual({
      paulista: { played: 0, won: 0 },
      mineiro: { played: 1, won: 1 },
    });
  });

  it('sem repositório de progressão: zeros (sem 500)', async () => {
    const { call, guest } = await start({ noProgression: true });
    const a = await guest();
    const res = await call('GET', '/me', a.token);
    expect(res.status).toBe(200);
    expect(((await res.json()) as MeResponse).stats.paulista).toEqual({ played: 0, won: 0 });
  });
});

describe('GET /me/achievements', () => {
  it('exige autenticação e só aceita GET', async () => {
    const { call, guest } = await start();
    expect((await call('GET', '/me/achievements')).status).toBe(401);
    const a = await guest();
    const res = await call('POST', '/me/achievements', a.token, {});
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET');
  });

  it('devolve o catálogo inteiro (nível 0 sem progresso) e depois o progresso real', async () => {
    const { call, guest, applyProgress } = await start();
    const a = await guest();
    const first = (await (
      await call('GET', '/me/achievements', a.token)
    ).json()) as AchievementsResponse;
    expect(first.achievements.map((x) => x.id)).toEqual([...ACHIEVEMENT_IDS]);
    for (const x of first.achievements) {
      expect(x).toEqual({ id: x.id, level: 0, progress: 0, unlockedAt: null });
    }
    await applyProgress([
      {
        userId: a.id,
        variant: 'paulista',
        played: 1,
        won: 1,
        achievements: [
          { achievementId: 'primeira_vitoria', progressDelta: 1 },
          { achievementId: 'maratona', progressDelta: 3 },
        ],
        missions: [],
      },
    ]);
    const next = (await (
      await call('GET', '/me/achievements', a.token)
    ).json()) as AchievementsResponse;
    const by = Object.fromEntries(next.achievements.map((x) => [x.id, x]));
    expect(by['primeira_vitoria']).toMatchObject({ level: 1, progress: 1 });
    expect(by['primeira_vitoria']?.unlockedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(by['maratona']).toMatchObject({ level: 0, progress: 3, unlockedAt: null });
  });

  it('cada usuário vê só o seu', async () => {
    const { call, guest, applyProgress } = await start();
    const a = await guest();
    const b = await guest();
    await applyProgress([
      {
        userId: a.id,
        variant: 'paulista',
        played: 1,
        won: 0,
        achievements: [{ achievementId: 'maratona', progressDelta: 4 }],
        missions: [],
      },
    ]);
    const res = (await (
      await call('GET', '/me/achievements', b.token)
    ).json()) as AchievementsResponse;
    expect(res.achievements.every((x) => x.progress === 0)).toBe(true);
  });
});

describe('GET /me/missions', () => {
  it('3 diárias e a semanal da semana corrente, estáveis entre chamadas', async () => {
    const { call, guest } = await start();
    const a = await guest();
    const read = async (): Promise<MissionsResponse> =>
      (await (await call('GET', '/me/missions', a.token)).json()) as MissionsResponse;
    const first = await read();
    expect(first.missions).toHaveLength(DAILY_MISSIONS_PER_DAY + 1);
    const daily = first.missions.filter((m) => m.period === 'daily');
    const weekly = first.missions.filter((m) => m.period === 'weekly');
    expect(daily).toHaveLength(DAILY_MISSIONS_PER_DAY);
    expect(weekly).toEqual([
      {
        id: 'vencer_5_semana',
        period: 'weekly',
        periodKey: '2026-W45',
        target: 5,
        progress: 0,
        completedAt: null,
      },
    ]);
    for (const m of daily) {
      expect(m.periodKey).toBe('2026-11-04');
      expect(m.target).toBe(MISSION_DEFINITIONS[m.id].target);
      expect(m.progress).toBe(0);
    }
    expect(daily.map((m) => m.id)).toEqual(
      dailyMissionsFor(a.id, '2026-11-04').map((m) => m.missionId),
    );
    expect(await read()).toEqual(first);
  });

  it('o progresso aparece, nunca passa da meta e a conclusão vem em ISO', async () => {
    const { call, guest, applyProgress } = await start();
    const a = await guest();
    const first = dailyMissionsFor(a.id, '2026-11-04')[0];
    if (first === undefined) throw new Error('sem missão diária');
    await applyProgress([
      {
        userId: a.id,
        variant: 'paulista',
        played: 1,
        won: 1,
        achievements: [],
        missions: [
          {
            missionId: first.missionId,
            periodKey: '2026-11-04',
            target: first.target,
            progressDelta: 50,
          },
        ],
      },
    ]);
    const res = (await (await call('GET', '/me/missions', a.token)).json()) as MissionsResponse;
    const m = res.missions.find((x) => x.id === first.missionId);
    expect(m?.progress).toBe(first.target);
    expect(m?.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('meia-noite de Brasília renova o dia (outra chave); a semana só vira na segunda', async () => {
    const clock = { at: new Date('2026-11-04T02:59:59Z') }; // 23:59:59 de 03/11 em Brasília
    const { call, guest } = await start({ clock });
    const a = await guest();
    const read = async (): Promise<MissionsResponse> =>
      (await (await call('GET', '/me/missions', a.token)).json()) as MissionsResponse;
    const dailyKeys = (r: MissionsResponse): string[] =>
      r.missions.filter((m) => m.period === 'daily').map((m) => m.periodKey);
    const eve = await read();
    expect(new Set(dailyKeys(eve))).toEqual(new Set(['2026-11-03']));
    clock.at = new Date('2026-11-04T03:00:00Z');
    const morning = await read();
    expect(new Set(dailyKeys(morning))).toEqual(new Set(['2026-11-04']));
    expect(morning.missions.find((m) => m.period === 'weekly')?.periodKey).toBe('2026-W45');
    // Só os períodos correntes aparecem (a de ontem não).
    expect(morning.missions).toHaveLength(DAILY_MISSIONS_PER_DAY + 1);
    // Segunda-feira 00:00 local vira a semana.
    clock.at = new Date('2026-11-09T03:00:00Z');
    expect((await read()).missions.find((m) => m.period === 'weekly')?.periodKey).toBe('2026-W46');
  });

  it('sem repositório de progressão: lista vazia', async () => {
    const { call, guest } = await start({ noProgression: true });
    const a = await guest();
    const res = (await (await call('GET', '/me/missions', a.token)).json()) as MissionsResponse;
    expect(res.missions).toEqual([]);
  });

  it('exige autenticação', async () => {
    const { call } = await start();
    expect((await call('GET', '/me/missions')).status).toBe(401);
  });
});

describe('GET /users/:id (perfil público)', () => {
  it('exige autenticação e só aceita GET', async () => {
    const { call, guest } = await start();
    const a = await guest();
    expect((await call('GET', `/users/${a.id}`)).status).toBe(401);
    const res = await call('PUT', `/users/${a.id}`, a.token, {});
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET');
  });

  it('mostra apelido, avatar, medalhas desbloqueadas e partidas/vitórias, e nada mais', async () => {
    const { call, guest, repos, applyProgress } = await start();
    const a = await guest();
    const b = await guest();
    await repos.users.saveAvatar(b.id, DEFAULT_AVATAR_PARTS);
    await applyProgress([
      {
        userId: b.id,
        variant: 'paulista',
        played: 5,
        won: 3,
        achievements: [
          { achievementId: 'primeira_vitoria', progressDelta: 1 },
          { achievementId: 'maratona', progressDelta: 4 }, // abaixo do 1º degrau: não aparece
        ],
        missions: [
          { missionId: 'jogar_3_partidas', periodKey: '2026-11-04', target: 3, progressDelta: 1 },
        ],
      },
    ]);
    const res = await call('GET', `/users/${b.id.toUpperCase()}`, a.token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PublicProfileResponse;
    expect(body).toEqual({
      id: b.id,
      nickname: b.nickname,
      avatar: DEFAULT_AVATAR_PARTS,
      achievements: [{ id: 'primeira_vitoria', level: 1 }],
      stats: { paulista: { played: 5, won: 3 }, mineiro: { played: 0, won: 0 } },
    });
    // Sem vazar provedor, datas, progresso, missões nem histórico.
    expect(Object.keys(body).sort()).toEqual(['achievements', 'avatar', 'id', 'nickname', 'stats']);
    const text = JSON.stringify(body);
    for (const leak of ['provider', 'createdAt', 'lastSeen', 'unlockedAt', 'progress', 'mission']) {
      expect(text).not.toContain(leak);
    }
  });

  it('o próprio usuário pode abrir o próprio perfil público', async () => {
    const { call, guest } = await start();
    const a = await guest();
    const res = await call('GET', `/users/${a.id}`, a.token);
    expect(res.status).toBe(200);
    expect(((await res.json()) as PublicProfileResponse).id).toBe(a.id);
  });

  it('inexistente, malformado, apagado e bloqueado (nos dois sentidos) dão a MESMA resposta', async () => {
    const { call, guest, repos } = await start();
    const a = await guest();
    const blockedByMe = await guest();
    const blocker = await guest();
    const gone = await guest();
    await repos.users.addBlock(a.id, blockedByMe.id);
    await repos.users.addBlock(blocker.id, a.id);
    await repos.users.deleteUser(gone.id);
    const targets = [randomUUID(), 'nao-e-uuid', '123', gone.id, blockedByMe.id, blocker.id];
    for (const t of targets) {
      const res = await call('GET', `/users/${t}`, a.token);
      expect({ status: res.status, body: await res.json() }).toEqual({
        status: 404,
        body: { error: { code: 'USER_NOT_FOUND' } },
      });
    }
  });

  it('desbloquear reabre o perfil', async () => {
    const { call, guest, repos } = await start();
    const a = await guest();
    const b = await guest();
    await repos.users.addBlock(a.id, b.id);
    expect((await call('GET', `/users/${b.id}`, a.token)).status).toBe(404);
    await repos.users.removeBlock(a.id, b.id);
    expect((await call('GET', `/users/${b.id}`, a.token)).status).toBe(200);
  });

  it('sem repositório de progressão: perfil com medalhas vazias e stats zerados', async () => {
    const { call, guest } = await start({ noProgression: true });
    const a = await guest();
    const b = await guest();
    const body = (await (
      await call('GET', `/users/${b.id}`, a.token)
    ).json()) as PublicProfileResponse;
    expect(body.achievements).toEqual([]);
    expect(body.stats.paulista).toEqual({ played: 0, won: 0 });
    expect(await code(await call('GET', `/users/${randomUUID()}`, a.token))).toBe('USER_NOT_FOUND');
  });
});
