/**
 * Bots de VAGA (mesa privada): o host põe e tira bots na espera, a partida começa com os 4 assentos
 * ocupados (humano ou bot), bot joga, sinaliza e aceita/corre pela mão, e a partida com bot é gravada sem
 * pontuar. UM `Server` por arquivo (o matchmaker é global); `until`, nunca `settle`.
 */
import type { Room } from '@colyseus/core';
import { ColyseusTestServer, boot } from '@colyseus/testing';
import type { ErrorCode, RoomOptions } from '@trucaco/protocol';
import { SIGNAL_IDS } from '@trucaco/protocol';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FinishedMatchInput, MatchRepository, ProgressionRepository } from '../db/types';
import { leakViolations } from '../game/leakdetect';
import type { RefHolder } from '../game/leakdetect';
import { metrics } from '../metrics';
import { NO_EFFORT_POLICY } from '../progression/achievements';
import { buildColyseusServer } from '../server';
import { BOT_NAME_PREFIX, pickBotIdentity, randomBotAvatar } from './botRoster';
import {
  DEFAULT_BOT_THINK_MS,
  VACANCY_BOT_THINK_MAX_MS,
  VACANCY_BOT_THINK_MIN_MS,
  defineTrucoRoom,
} from './TrucoRoom';
import type { TrucoRoom, TrucoRoomConfig } from './TrucoRoom';
import type { SeriesState } from '@trucaco/rules';

const saved: FinishedMatchInput[] = [];
const repo: MatchRepository = {
  saveMatch: (input) => {
    saved.push(input);
    return Promise.resolve(String(saved.length));
  },
  listForUser: () => Promise.resolve({ items: [], nextCursor: null }),
};
const progressCalls: unknown[] = [];
const progression = {
  applyMatchProgress: (...args: unknown[]) => {
    progressCalls.push(args);
    return Promise.resolve({ applied: true, unlocked: [], missionsCompleted: [] });
  },
  countWinsTogether: () => Promise.resolve(0),
  countMatchesTogether: () => Promise.resolve(0),
  countGuests: () => Promise.resolve(0),
  countScoredPrivateMatches: () => Promise.resolve(0),
  listAchievements: () => Promise.resolve([]),
} as unknown as ProgressionRepository;

const FAST: TrucoRoomConfig = {
  patchRateMs: 5,
  actionMinIntervalMs: 0,
  finishDelayMs: 60_000,
  maxMessagesPerSecond: 10_000,
  botSignalChance: 0,
  botThinkMs: 5,
  turnTimeoutMs: 60_000,
  rngSeed: 7,
  matches: repo,
  progression,
  progressionPolicy: NO_EFFORT_POLICY,
};

const { botThinkMs: _unused, ...NO_THINK } = FAST;
void _unused;

const VARIANTS: Record<string, TrucoRoomConfig> = {
  'truco-bots': FAST,
  // 11x11 com mão de ferro: o jogo se decide numa mão.
  'truco-bots-ferro': { ...FAST, initialScores: [11, 11] },
  'truco-bots-sig': { ...FAST, botSignalChance: 1, signalCooldownMs: 50 },
  'truco-bots-default': NO_THINK,
};

let t: ColyseusTestServer;

beforeAll(async () => {
  const server = buildColyseusServer({ ...FAST }, { allowDevAuth: true });
  for (const [name, cfg] of Object.entries(VARIANTS)) defineTrucoRoom(server, cfg, name);
  t = await boot(server);
});

afterEach(async () => {
  await t.cleanup();
});

afterAll(async () => {
  await t.shutdown();
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function until(cond: () => boolean, what: string, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return;
    await sleep(2);
  }
  throw new Error(`timeout esperando: ${what}`);
}

const OPTS: RoomOptions = {
  variant: 'paulista',
  format: 'single',
  ironHand: true,
  visibility: 'private',
};

type SdkRoom = Awaited<ReturnType<ColyseusTestServer['connectTo']>>;

interface Human {
  seat: number;
  room: SdkRoom;
  errors: ErrorCode[];
  signals: { seat: number; signalId: string }[];
  presences: { seat: number; status: string }[];
}

interface PlayerView {
  seat: number;
  nickname: string;
  status: string;
  isBot: boolean;
}

const stateOf = (h: Human): { hostSeat: number; phase: string; matchNumber: number } =>
  h.room.state as unknown as { hostSeat: number; phase: string; matchNumber: number };
const playersOf = (h: Human): PlayerView[] =>
  (h.room.state as unknown as { players: { toJSON(): PlayerView[] } }).players.toJSON();
const json = (h: Human): { privates: Record<string, { legalActions: string[] }> } =>
  (h.room.state as unknown as { toJSON(): never }).toJSON();

async function open(name = 'truco-bots'): Promise<TrucoRoom> {
  return t.createRoom<TrucoRoom>(name, OPTS);
}

async function join(server: TrucoRoom, n: number): Promise<Human> {
  const room = await t.connectTo<Room>(server as unknown as Room, {
    userId: `user-${n}`,
    nickname: `Jogador ${n}`,
  });
  const h: Human = { seat: -1, room, errors: [], signals: [], presences: [] };
  room.onMessage('error', (m: { code: ErrorCode }) => h.errors.push(m.code));
  room.onMessage('signal', (m: { seat: number; signalId: string }) => h.signals.push(m));
  room.onMessage('presence', (m: { seat: number; status: string }) => h.presences.push(m));
  await until(() => playersOf(h).length === 4, 'estado');
  await until(() => playersOf(h).some((p) => p.nickname === `Jogador ${n}`), 'meu assento');
  h.seat = playersOf(h).findIndex((p) => p.nickname === `Jogador ${n}`);
  return h;
}

function toMessage(id: string): { type: string; payload?: unknown } {
  const m = /^(play|playCovered):(.+?)(paus|copas|espadas|ouros)$/.exec(id);
  if (m !== null) return { type: 'play', payload: { card: { rank: m[2], suit: m[3] } } };
  const b = /^playBlind:(\d)$/.exec(id);
  if (b !== null) return { type: 'playBlind', payload: { index: Number(b[1]) } };
  if (id === 'specialPlay') return { type: 'special', payload: { decision: 'play' } };
  return { type: id };
}

const quiet = (ids: string[]): string =>
  ids.find((i) => i === 'specialPlay') ??
  ids.find((i) => i.startsWith('play:')) ??
  ids.find((i) => i.startsWith('playBlind:')) ??
  ids.find((i) => i === 'accept') ??
  (ids[0] as string);

/** O humano joga sempre a primeira jogada calma (nunca aposta) até `stop()`; os bots movem o resto. */
async function playUntil(server: TrucoRoom, h: Human, stop: () => boolean): Promise<void> {
  const end = Date.now() + 15_000;
  while (!stop()) {
    if (Date.now() > end) throw new Error('timeout jogando');
    const mine = Object.values(json(h).privates)[0];
    if (mine === undefined || mine.legalActions.length === 0) {
      await sleep(5);
      continue;
    }
    const before = server.eventLog.length;
    const msg = toMessage(quiet(mine.legalActions));
    if (msg.payload === undefined) h.room.send(msg.type);
    else h.room.send(msg.type, msg.payload);
    await until(() => server.eventLog.length > before || stop(), `processar ${msg.type}`);
    // Espera o patch refletir a jogada no cliente (senão reenviaria a mesma ação com estado velho).
    const sent = mine.legalActions.join();
    await until(
      () => (Object.values(json(h).privates)[0]?.legalActions ?? []).join() !== sent || stop(),
      'cliente ver a jogada',
    );
  }
}

const finished = (server: TrucoRoom): boolean => (server.series?.winner ?? null) !== null;

describe('bots de vaga: o host põe e tira bots na espera', () => {
  it('adiciona e remove um bot; nome com prefixo e avatar válido; hostSeat publicado', async () => {
    const server = await open();
    const host = await join(server, 0);
    await until(() => stateOf(host).hostSeat === 0, 'hostSeat 0');
    host.room.send('botSeat', { target: 2, enabled: true });
    await until(() => playersOf(host)[2]?.status === 'bot', 'bot no assento 2');
    const bot = playersOf(host)[2] as PlayerView;
    expect(bot.isBot).toBe(true);
    expect(bot.nickname.startsWith(BOT_NAME_PREFIX)).toBe(true);
    expect(stateOf(host).phase).toBe('waiting');
    expect(server.series).toBeNull();
    expect(host.errors).toEqual([]);
    await until(
      () => host.presences.some((p) => p.seat === 2 && p.status === 'bot'),
      'presença do bot',
    );
    // Idempotente: pôr de novo não troca o bot.
    host.room.send('botSeat', { target: 2, enabled: true });
    await sleep(60);
    expect(playersOf(host)[2]?.nickname).toBe(bot.nickname);
    host.room.send('botSeat', { target: 2, enabled: false });
    await until(() => playersOf(host)[2]?.status === 'empty', 'assento 2 livre');
    expect(playersOf(host)[2]?.isBot).toBe(false);
    expect(playersOf(host)[2]?.nickname).toBe('');
    expect(host.errors).toEqual([]);
  });

  it('quem não é o host recebe NOT_HOST e o estado não muda', async () => {
    const server = await open();
    const host = await join(server, 0);
    const guest = await join(server, 1);
    await until(() => stateOf(guest).hostSeat === 0, 'hostSeat 0');
    guest.room.send('botSeat', { target: 3, enabled: true });
    guest.room.send('fillBots');
    await until(() => guest.errors.length === 2, 'dois erros');
    expect(guest.errors).toEqual(['NOT_HOST', 'NOT_HOST']);
    await sleep(40);
    expect(playersOf(host)[3]?.status).toBe('empty');
    expect(playersOf(host)[2]?.status).toBe('empty');
    expect(server.series).toBeNull();
  });

  it('mesa da fila recebe BOTS_NOT_ALLOWED', async () => {
    const server = await open();
    (server as unknown as { grant: unknown }).grant = {
      kind: 'queue',
      code: 'ABCDEFGH',
      creator: null,
      allowed: null,
      seats: null,
      creatorMs: 1000,
      fillMs: 60_000,
      waitMs: 60_000,
    };
    const host = await join(server, 0);
    host.room.send('botSeat', { target: 1, enabled: true });
    host.room.send('fillBots');
    await until(() => host.errors.length === 2, 'dois erros');
    expect(host.errors).toEqual(['BOTS_NOT_ALLOWED', 'BOTS_NOT_ALLOWED']);
    expect(playersOf(host)[1]?.status).toBe('empty');
  });

  it('assento ocupado por humano recebe SEAT_OCCUPIED (pôr e tirar)', async () => {
    const server = await open();
    const host = await join(server, 0);
    const guest = await join(server, 1);
    await until(() => playersOf(host)[guest.seat]?.nickname === 'Jogador 1', 'host vê o convidado');
    host.room.send('botSeat', { target: guest.seat, enabled: true });
    host.room.send('botSeat', { target: guest.seat, enabled: false });
    host.room.send('botSeat', { target: host.seat, enabled: true });
    await until(() => host.errors.length === 3, 'três erros');
    expect(host.errors).toEqual(['SEAT_OCCUPIED', 'SEAT_OCCUPIED', 'SEAT_OCCUPIED']);
    expect(playersOf(host)[guest.seat]?.nickname).toBe('Jogador 1');
    expect(playersOf(host)[guest.seat]?.isBot).toBe(false);
  });

  it('payload inválido (seat, target fora de 0..3, campo extra) é recusado sem mudar nada', async () => {
    const server = await open();
    const host = await join(server, 0);
    host.room.send('botSeat', { target: 7, enabled: true });
    host.room.send('botSeat', { seat: 1, target: 2, enabled: true });
    host.room.send('botSeat', { target: 2, enabled: true, extra: 1 });
    host.room.send('fillBots', { x: 1 });
    await until(() => host.errors.length === 4, 'quatro erros');
    expect(host.errors).toEqual(Array(4).fill('INVALID_PAYLOAD'));
    expect(playersOf(host).every((p) => !p.isBot)).toBe(true);
  });

  it('se o host sai na espera, o host passa ao menor assento humano', async () => {
    const server = await open();
    const host = await join(server, 0);
    const second = await join(server, 1);
    const third = await join(server, 2);
    await until(() => stateOf(second).hostSeat === 0, 'hostSeat 0');
    await host.room.leave();
    await until(() => stateOf(second).hostSeat === second.seat, 'novo host');
    expect(stateOf(third).hostSeat).toBe(second.seat);
    third.room.send('botSeat', { target: 3, enabled: true });
    await until(() => third.errors.includes('NOT_HOST'), 'o terceiro não é host');
    second.room.send('botSeat', { target: 3, enabled: true });
    await until(() => playersOf(second)[3]?.status === 'bot', 'o novo host põe bot');
  });
});

describe('bots de vaga: início da partida', () => {
  it('só começa com os 4 assentos ocupados (humano ou bot)', async () => {
    const server = await open();
    const host = await join(server, 0);
    host.room.send('botSeat', { target: 1, enabled: true });
    host.room.send('botSeat', { target: 2, enabled: true });
    await until(() => playersOf(host)[2]?.status === 'bot', 'dois bots');
    await sleep(80);
    expect(server.series).toBeNull();
    expect(server.locked).toBe(false);
    // Tirar e pôr não inicia; o 4º ocupado inicia.
    host.room.send('botSeat', { target: 2, enabled: false });
    await until(() => playersOf(host)[2]?.status === 'empty', 'assento 2 livre');
    await sleep(40);
    expect(server.series).toBeNull();
    host.room.send('botSeat', { target: 2, enabled: true });
    host.room.send('botSeat', { target: 3, enabled: true });
    await until(() => server.series !== null, 'série iniciada');
    expect(server.locked).toBe(true);
    await until(() => stateOf(host).phase === 'playing', 'fase playing');
  });

  it('um humano entra no assento livre que o bot não ocupa e completa a mesa', async () => {
    const server = await open();
    const host = await join(server, 0);
    host.room.send('botSeat', { target: 1, enabled: true });
    host.room.send('botSeat', { target: 2, enabled: true });
    await until(() => playersOf(host)[2]?.status === 'bot', 'dois bots');
    const guest = await join(server, 1);
    expect(guest.seat).toBe(3);
    await until(() => server.series !== null, 'série iniciada com 2 humanos e 2 bots');
    expect(playersOf(host).filter((p) => p.isBot)).toHaveLength(2);
  });

  it('fillBots preenche todas as vagas e inicia', async () => {
    const server = await open();
    const host = await join(server, 0);
    host.room.send('fillBots');
    await until(() => server.series !== null, 'série iniciada');
    expect(server.locked).toBe(true);
    await until(
      () =>
        playersOf(host)
          .slice(1)
          .every((p) => p.isBot),
      'três bots no estado',
    );
    const players = playersOf(host);
    expect(players[0]?.isBot).toBe(false);
    expect(players.slice(1).every((p) => p.isBot && p.status === 'bot')).toBe(true);
    const names = players.slice(1).map((p) => p.nickname);
    expect(new Set(names).size).toBe(3);
    // Depois de iniciada, mudar bots é recusado.
    host.room.send('botSeat', { target: 1, enabled: false });
    await until(() => host.errors.length === 1, 'erro');
    expect(host.errors).toEqual(['BOTS_NOT_ALLOWED']);
    expect(playersOf(host)[1]?.isBot).toBe(true);
  });
});

describe('bots de vaga: jogo, registro e revanche', () => {
  it('1 humano + 3 bots joga até o fim; grava com userId null e não pontua', async () => {
    saved.length = 0;
    progressCalls.length = 0;
    const invalidBefore = metrics.count('progressionInvalid');
    const server = await open('truco-bots-ferro');
    const host = await join(server, 0);
    host.room.send('fillBots');
    await until(() => server.series !== null, 'série iniciada');
    await playUntil(server, host, () => finished(server));
    await until(() => saved.length === 1, 'partida gravada');
    const match = saved[0] as FinishedMatchInput;
    expect(match.status).toBe('finished');
    const byseat = [...match.players].sort((a, b) => a.seat - b.seat);
    expect(byseat[0]?.userId).toBe('user-0');
    expect(byseat[0]?.botFrom).toBeNull();
    for (const p of byseat.slice(1)) {
      expect(p.userId).toBeNull();
      expect(p.botFrom).not.toBeNull();
    }
    // `isValidMatch` recusa (4 humanos distintos): nada de estatística, conquista ou missão.
    await until(
      () => metrics.count('progressionInvalid') === invalidBefore + 1,
      'progressão recusada',
    );
    await sleep(50);
    expect(progressCalls).toEqual([]);
  });

  it('o humano nunca recebe carta de outro assento (bots incluídos)', async () => {
    const server = await open('truco-bots-ferro');
    const host = await join(server, 0);
    host.room.send('fillBots');
    await until(() => server.series !== null, 'série iniciada');
    await until(
      () => playersOf(host)[0]?.status !== undefined && stateOf(host).phase === 'playing',
      'playing',
    );
    await sleep(60);
    const decoder = (host.room as unknown as { serializer: { decoder: RefHolder } }).serializer
      .decoder;
    const bad = leakViolations(json(host), server.series as SeriesState, 0, 'bots', { decoder });
    expect(bad).toEqual([]);
    expect(Object.keys(json(host).privates)).toEqual(['0']);
  });

  it('revanche com 1 humano e 3 bots de vaga começa na unanimidade do humano', async () => {
    saved.length = 0;
    const server = await open('truco-bots-ferro');
    const host = await join(server, 0);
    host.room.send('fillBots');
    await until(() => server.series !== null, 'série iniciada');
    await playUntil(server, host, () => finished(server));
    await until(() => stateOf(host).phase === 'finished', 'fim');
    host.room.send('voteRematch');
    await until(() => stateOf(host).matchNumber === 2, 'revanche iniciada');
    await until(() => server.series !== null && !finished(server), 'nova série');
    expect(server.locked).toBe(true);
    expect(
      playersOf(host)
        .slice(1)
        .every((p) => p.isBot),
    ).toBe(true);
    expect(host.errors).toEqual([]);
  });

  it('bot de vaga sinaliza no início da mão, com o seat do bot', async () => {
    const server = await open('truco-bots-sig');
    const host = await join(server, 0);
    host.room.send('fillBots');
    await until(() => host.signals.length >= 1, 'sinal de bot');
    for (const m of host.signals) {
      expect([1, 2, 3]).toContain(m.seat);
      expect(SIGNAL_IDS as readonly string[]).toContain(m.signalId);
    }
    // Nunca de chat: bot não fala.
    expect(host.errors).toEqual([]);
  });
});

describe('bots de vaga: atraso e perfil', () => {
  type Internals = {
    thinkMs(seat: number): number;
    profileOf(seat: number): string;
    absenceBotSeats: Set<number>;
    botSeats: Set<number>;
  };

  it('vaga pensa 900 a 1800 ms (sorteado); ausência mantém 600', async () => {
    const server = await open('truco-bots-default');
    const host = await join(server, 0);
    host.room.send('botSeat', { target: 1, enabled: true });
    await until(() => playersOf(host)[1]?.status === 'bot', 'bot');
    const room = server as unknown as Internals;
    const values = new Set<number>();
    for (let i = 0; i < 60; i++) {
      const ms = room.thinkMs(1);
      expect(ms).toBeGreaterThanOrEqual(VACANCY_BOT_THINK_MIN_MS);
      expect(ms).toBeLessThanOrEqual(VACANCY_BOT_THINK_MAX_MS);
      values.add(ms);
    }
    expect(values.size).toBeGreaterThan(1);
    expect(room.thinkMs(2)).toBe(DEFAULT_BOT_THINK_MS);
    expect(room.profileOf(1)).toBe('vacancy');
    expect(room.profileOf(0)).toBe('absence');
    // Bot de vaga nunca é de ausência (não tem dono para voltar).
    expect(room.absenceBotSeats.has(1)).toBe(false);
    expect(room.botSeats.has(1)).toBe(true);
  });
});

describe('botRoster', () => {
  it('nome sempre com "Bot " (espaço: apelido de humano não tem espaço) e sem repetir', () => {
    const taken = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const id = pickBotIdentity(taken);
      expect(id.nickname.startsWith(BOT_NAME_PREFIX)).toBe(true);
      expect(taken.has(id.nickname)).toBe(false);
      taken.add(id.nickname);
      expect(JSON.parse(id.avatar)).toHaveProperty('hair');
    }
    expect(JSON.parse(randomBotAvatar())).toHaveProperty('hat');
  });
});
