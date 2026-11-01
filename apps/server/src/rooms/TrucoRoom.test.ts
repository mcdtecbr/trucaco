/**
 * Testes de sala da `TrucoRoom` com `@colyseus/testing` (4 clientes reais por WebSocket).
 * UM `Server` por arquivo (o matchmaker é global). Variações de configuração do SERVIDOR (semente,
 * prazo, placar inicial) entram como nomes de sala extras; o cliente nunca as controla.
 */
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { matchMaker } from '@colyseus/core';
import type { Room } from '@colyseus/core';
import { ColyseusTestServer, boot } from '@colyseus/testing';
import { MAX_MESSAGE_BYTES } from '@trucaco/protocol';
import type { ErrorCode, RoomOptions } from '@trucaco/protocol';
import { mulberry32, pendingSeat } from '@trucaco/rules';
import type { Card, SeriesState } from '@trucaco/rules';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { TruthLog, eventViolations, leakViolations } from '../game/leakdetect';
import type { RefHolder } from '../game/leakdetect';
import { setLogSink } from '../logger';
import { buildColyseusServer } from '../server';
import { defineTrucoRoom, devAuth, devReconnectUserId } from './TrucoRoom';
import type { TrucoRoom, TrucoRoomConfig } from './TrucoRoom';

type SdkRoom = Awaited<ReturnType<ColyseusTestServer['connectTo']>>;

const FAST: TrucoRoomConfig = {
  patchRateMs: 5,
  actionMinIntervalMs: 0,
  finishDelayMs: 60_000,
  maxMessagesPerSecond: 10_000,
};

const VARIANTS: Record<string, TrucoRoomConfig> = {
  'truco-onze': { ...FAST, rngSeed: 11, initialScores: [11, 3] },
  'truco-onze-mineiro': { ...FAST, rngSeed: 12, initialScores: [4, 10] },
  'truco-ferro': { ...FAST, rngSeed: 13, initialScores: [11, 11] },
  'truco-ferro-mineiro': { ...FAST, rngSeed: 14, initialScores: [10, 10] },
  'truco-timeout': { ...FAST, rngSeed: 21, turnTimeoutMs: 150 },
  'truco-rate': { patchRateMs: 5, rngSeed: 22, finishDelayMs: 60_000 },
  // 2E: reconexão e bot de ausência. Turno longo: só o bot ou o teste movem o jogo.
  'truco-rec': { ...FAST, rngSeed: 31, reconnectSeconds: 5, botThinkMs: 20, turnTimeoutMs: 60_000 },
  'truco-rec-short': {
    ...FAST,
    rngSeed: 32,
    reconnectSeconds: 0.4,
    botThinkMs: 20,
    turnTimeoutMs: 60_000,
  },
  'truco-rec-slow': {
    ...FAST,
    rngSeed: 33,
    reconnectSeconds: 5,
    botThinkMs: 3000,
    turnTimeoutMs: 60_000,
  },
  'truco-rec-log': {
    ...FAST,
    rngSeed: 37,
    reconnectSeconds: 5,
    botThinkMs: 20,
    turnTimeoutMs: 60_000,
    eventLogMax: 2,
  },
  'truco-rec-abandon': {
    ...FAST,
    rngSeed: 34,
    reconnectSeconds: 5,
    abandonMs: 300,
    finishDelayMs: 100,
    turnTimeoutMs: 60_000,
  },
  'truco-rec-rate': {
    patchRateMs: 5,
    rngSeed: 35,
    finishDelayMs: 60_000,
    reconnectSeconds: 5,
    actionMinIntervalMs: 2000,
    turnTimeoutMs: 60_000,
  },
  'truco-rec-cap': {
    ...FAST,
    rngSeed: 36,
    reconnectSeconds: 5,
    botThinkMs: 20,
    turnTimeoutMs: 60_000,
    maxReconnects: 1,
  },
  'truco-rec-ferro': {
    ...FAST,
    rngSeed: 13,
    initialScores: [11, 11],
    reconnectSeconds: 5,
    botThinkMs: 20,
    turnTimeoutMs: 60_000,
  },
  'truco-rec-onze': {
    ...FAST,
    rngSeed: 11,
    initialScores: [11, 3],
    reconnectSeconds: 5,
    botThinkMs: 20,
    turnTimeoutMs: 60_000,
  },
};

let t: ColyseusTestServer;
const logLines: string[] = [];
let restoreLog: () => void = () => undefined;

beforeAll(async () => {
  restoreLog = setLogSink((level, msg, fields) => {
    logLines.push(JSON.stringify({ level, msg, ...fields }));
  });
  const server = buildColyseusServer({ ...FAST, rngSeed: 1 });
  for (const [name, cfg] of Object.entries(VARIANTS)) defineTrucoRoom(server, cfg, name);
  t = await boot(server);
});

afterEach(async () => {
  await t.cleanup();
});

afterAll(async () => {
  await t.shutdown();
  restoreLog();
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function until(cond: () => boolean, what: string, ms = 3000): Promise<void> {
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

interface Received {
  seq: number;
  at: number;
  event: { type: string; [k: string]: unknown };
}

interface Player {
  seat: number;
  room: SdkRoom;
  events: Received[];
  errors: ErrorCode[];
  turnTimers: { seat: number; deadlineAt: number }[];
  presences: { seat: number; status: string }[];
  /** Socket derrubado de propósito pelo teste (o cliente SDK não conta como jogando). */
  gone: boolean;
}

interface Game {
  server: TrucoRoom;
  players: Player[];
  /** Violações de vazamento vistas em QUALQUER patch ou evento recebido por qualquer cliente. */
  leaks: string[];
  patches: number;
  /** Uma entrada por versão da série do servidor: cada patch é conferido contra a da sua época. */
  log: TruthLog;
}

/** Converte ArraySchema do cliente em array simples. */
const plain = <T>(a: unknown): T[] => (a as { toJSON(): T[] }).toJSON();

const json = (p: Player): unknown => (p.room.state as { toJSON(): unknown }).toJSON();

/** Decoder real do cliente: permite varrer todos os refs, não só a árvore do `toJSON`. */
const decoderOf = (p: Player): RefHolder =>
  (p.room as unknown as { serializer: { decoder: RefHolder } }).serializer.decoder;

/** Registra no `log` toda série atribuída à sala (a sala nunca é alterada: só observada). */
function recordSeries(server: TrucoRoom, log: TruthLog): void {
  let current = server.series;
  Object.defineProperty(server, 'series', {
    configurable: true,
    enumerable: true,
    get: () => current,
    set: (v: typeof current) => {
      current = v;
      if (v !== null) log.record(v);
    },
  });
}

/** Liga handlers e o detector de vazamento a um cliente (entrada normal ou reconexão). */
function wirePlayer(game: Game, p: Player): void {
  const { room, seat } = p;
  room.onMessage('event', (m: Received) => {
    p.events.push(m);
    game.leaks.push(...eventViolations(m.event, seat, `evento seq ${m.seq} assento ${seat}`));
  });
  room.onMessage('error', (m: { code: ErrorCode }) => p.errors.push(m.code));
  room.onMessage('turnTimer', (m: { seat: number; deadlineAt: number }) => p.turnTimers.push(m));
  room.onMessage('presence', (m: { seat: number; status: string }) => p.presences.push(m));
  room.onStateChange(() => {
    game.patches++;
    if (game.log.size === 0) return;
    // A CADA patch recebido por ESTE cliente: nada proibido (árvore, strings e todos os refs do
    // decoder), só o bloco privado dele, tudo contra a verdade da ÉPOCA do patch.
    game.leaks.push(
      ...game.log.violations(json(p), seat, `patch ${game.patches} assento ${seat}`, {
        decoder: decoderOf(p),
      }),
    );
  });
}

async function createGame(name: string, options: RoomOptions): Promise<Game> {
  const server = await t.createRoom<TrucoRoom>(name, options);
  const game: Game = { server, players: [], leaks: [], patches: 0, log: new TruthLog() };
  recordSeries(server, game.log);
  for (let seat = 0; seat < 4; seat++) {
    const room = await t.connectTo<Room>(server as unknown as Room, {
      userId: `user-${seat}`,
      nickname: `Jogador ${seat}`,
    });
    const p: Player = {
      seat,
      room,
      events: [],
      errors: [],
      turnTimers: [],
      presences: [],
      gone: false,
    };
    wirePlayer(game, p);
    game.players.push(p);
  }
  return game;
}

/** Espera todos os clientes alcançarem a verdade do servidor e confere vazamento/consistência. */
async function settle(game: Game, label: string): Promise<void> {
  const end = Date.now() + 3000;
  let bad: string[] = [];
  while (Date.now() < end) {
    const series = game.server.series as SeriesState;
    bad = game.players
      .filter((p) => !p.gone)
      .flatMap((p) => leakViolations(json(p), series, p.seat, label, { decoder: decoderOf(p) }));
    if (bad.length === 0) return;
    await sleep(2);
  }
  throw new Error(bad.join('\n'));
}

interface Msg {
  type: string;
  payload?: unknown;
}

/** Traduz um id de `privates[seat].legalActions` para a mensagem do cliente. */
function toMessage(id: string): Msg {
  const m = /^(play|playCovered):(.+?)(paus|copas|espadas|ouros)$/.exec(id);
  if (m !== null) {
    const card = { rank: m[2], suit: m[3] };
    return m[1] === 'play'
      ? { type: 'play', payload: { card } }
      : { type: 'play', payload: { card, covered: true } };
  }
  const b = /^playBlind:(\d)$/.exec(id);
  if (b !== null) return { type: 'playBlind', payload: { index: Number(b[1]) } };
  if (id === 'specialPlay') return { type: 'special', payload: { decision: 'play' } };
  if (id === 'specialRun') return { type: 'special', payload: { decision: 'run' } };
  return { type: id };
}

interface Privates {
  privates: Record<string, { legalActions: string[] }>;
}

function actorOf(game: Game): { player: Player; ids: string[] } | null {
  for (const p of game.players) {
    if (p.gone) continue;
    const mine = Object.values((json(p) as Privates).privates)[0];
    if (mine !== undefined && mine.legalActions.length > 0) {
      return { player: p, ids: mine.legalActions };
    }
  }
  return null;
}

type Policy = (ids: string[], rng: () => number) => string;

/** Aleatória com apostas, cobertas e fuga: percorre as fases do jogo. */
const randomPolicy: Policy = (ids, rng) => {
  const pick = (xs: string[]): string => xs[Math.floor(rng() * xs.length)] as string;
  if (ids.includes('accept')) {
    const r = rng();
    if (r < 0.55) return 'accept';
    if (r < 0.8 && ids.includes('bet')) return 'bet';
    return 'run';
  }
  if (ids.includes('bet') && rng() < 0.2) return 'bet';
  const plays = ids.filter((i) => i !== 'bet');
  return pick(plays.length > 0 ? plays : ids);
};

/** Sempre a primeira ação legal (acelera). */
const firstPolicy: Policy = (ids) => ids[0] as string;

/** Joga uma ação do assento da vez. Devolve false se ninguém tem ação. */
async function step(
  game: Game,
  policy: Policy,
  rng: () => number,
  label: string,
): Promise<boolean> {
  const actor = actorOf(game);
  if (actor === null) return false;
  const msg = toMessage(policy(actor.ids, rng));
  const before = game.server.eventLog.length;
  if (msg.payload === undefined) actor.player.room.send(msg.type);
  else actor.player.room.send(msg.type, msg.payload);
  await until(
    () => game.server.eventLog.length > before,
    `${label}: servidor processar ${msg.type} (assento ${actor.player.seat}, erros ${actor.player.errors.join(',')})`,
  );
  await settle(game, label);
  return true;
}

function seen(game: Game, type: string): number {
  return (game.players[0] as Player).events.filter((e) => e.event.type === type).length;
}

function assertNoLeaks(game: Game): void {
  expect(game.leaks).toEqual([]);
  expect(game.patches).toBeGreaterThan(0);
}

function assertEventStream(game: Game): void {
  for (const p of game.players) {
    p.events.forEach((e, i) => {
      if (i > 0) expect(e.seq).toBe((p.events[i - 1] as Received).seq + 1);
      expect(Math.abs(e.at - Date.now())).toBeLessThan(10 * 60_000);
    });
  }
  // O log do servidor tem todos os eventos, em ordem, sem identidade de carta coberta.
  const log = game.server.eventLog;
  log.forEach((e, i) => expect(e.seq).toBe(i + 1));
  expect(eventViolations({ type: 'cardPlayed', seat: 9, covered: false }, 0, 'x')).toEqual([]);
  for (const e of log) expect(eventViolations(e.event, -1, `log ${e.seq}`)).toEqual([]);
}

describe('TrucoRoom: entrada e assentos', () => {
  it('atribui assentos por ordem de chegada, tranca no 4º e inicia a série', async () => {
    const game = await createGame('truco', OPTS);
    expect(game.players.map((p) => p.seat)).toEqual([0, 1, 2, 3]);
    await until(() => game.server.series !== null, 'série iniciada');
    expect(game.server.locked).toBe(true);
    const state = (game.players[2] as Player).room.state as {
      phase: string;
      players: { nickname: string; status: string }[];
    };
    await until(() => state.phase === 'playing', 'fase playing no cliente');
    expect(state.players.map((p) => p.nickname)).toEqual([
      'Jogador 0',
      'Jogador 1',
      'Jogador 2',
      'Jogador 3',
    ]);
    expect(state.players.every((p) => p.status === 'connected')).toBe(true);
    expect(game.server.series?.match.pe).toBe(0);
    await settle(game, 'início');
    assertNoLeaks(game);
  });

  it('rejeita opções de sala inválidas e campos extras do cliente', async () => {
    await expect(
      t.createRoom('truco', { ...OPTS, format: 'bo3', visibility: 'public' }),
    ).rejects.toThrow();
    await expect(t.createRoom('truco', { ...OPTS, rngSeed: 1 })).rejects.toThrow();
    await expect(t.createRoom('truco', { variant: 'x' })).rejects.toThrow();
  });

  it('o mesmo userId não senta duas vezes', async () => {
    const server = await t.createRoom<TrucoRoom>('truco', OPTS);
    await t.connectTo(server, { userId: 'dup', nickname: 'A' });
    await expect(t.connectTo(server, { userId: 'dup', nickname: 'B' })).rejects.toThrow();
  });
});

describe('TrucoRoom: saída antes do início e estado por assento', () => {
  it('quem sai entre o 4º join e o tick não deixa a série começar com assento vazio', async () => {
    const server = await t.createRoom<TrucoRoom>('truco', OPTS);
    // Segura o tick de início: simula a saída chegando antes de `startGame` rodar.
    const held: { fn: () => void; cleared: boolean }[] = [];
    const clock = server.clock as unknown as {
      setTimeout: (fn: () => void, ms: number) => { clear: () => void };
    };
    const original = clock.setTimeout.bind(server.clock);
    clock.setTimeout = (fn) => {
      const entry = { fn, cleared: false };
      held.push(entry);
      return {
        clear: () => {
          entry.cleared = true;
        },
      };
    };
    try {
      for (let i = 0; i < 3; i++) {
        await t.connectTo(server as unknown as Room, { userId: `r${i}`, nickname: `R${i}` });
      }
      const fourth = await t.connectTo(server as unknown as Room, { userId: 'r3', nickname: 'R3' });
      expect(held.length).toBe(1);
      expect(server.locked).toBe(true);
      await fourth.leave();
      await until(() => server.clients.length === 3, 'sala com 3 clientes');
      await until(() => !server.locked, 'sala destrancada');
      expect(held[0]?.cleared).toBe(true);
      // Mesmo que o tick já estivesse na fila, o guarda impede a série com assento vazio.
      held[0]?.fn();
      expect(server.series).toBeNull();
      expect(server.state.phase).toBe('waiting');
    } finally {
      clock.setTimeout = original;
    }
    await t.connectTo(server as unknown as Room, { userId: 'r4', nickname: 'R4' });
    await until(() => server.series !== null, 'série iniciada');
    expect(server.state.players.map((p) => p.status)).toEqual([
      'connected',
      'connected',
      'connected',
      'connected',
    ]);
    expect(server.state.players.map((p) => p.nickname)).toEqual(['R0', 'R1', 'R2', 'R4']);
  });

  it('o próximo ocupante do assento não herda strikes de payload inválido', async () => {
    const server = await t.createRoom<TrucoRoom>('truco', OPTS);
    await t.connectTo(server as unknown as Room, { userId: 'k', nickname: 'K' });
    const a = await t.connectTo(server as unknown as Room, { userId: 'a', nickname: 'A' });
    let aErrors = 0;
    a.onMessage('error', () => aErrors++);
    for (let i = 0; i < 4; i++) a.send('play', { card: 1 });
    await until(() => aErrors === 4, '4 erros de A');
    await a.leave();
    await until(() => server.clients.length === 1, 'A saiu');
    const b = await t.connectTo(server as unknown as Room, { userId: 'b', nickname: 'B' });
    let code = -1;
    b.onLeave((c) => {
      code = c;
    });
    let bErrors = 0;
    b.onMessage('error', () => bErrors++);
    for (let i = 0; i < 4; i++) b.send('play', { card: 1 });
    await until(() => bErrors === 4, '4 erros de B');
    expect(code).toBe(-1);
    expect(server.clients.length).toBe(2);
    b.send('play', { card: 1 });
    await until(() => code === 1008, 'B expulso no 5º');
  });

  it('o userId nunca entra no estado compartilhado', async () => {
    const game = await createGame('truco', OPTS);
    await until(() => game.server.series !== null, 'série iniciada');
    await settle(game, 'início');
    for (const p of game.players) {
      const text = JSON.stringify(json(p));
      expect(text).not.toContain('user-');
      expect(text).not.toContain('userId');
    }
  });
});

describe('TrucoRoom: sinal e sfx inválidos contam para a expulsão e o log é limitado', () => {
  it('INVALID_SIGNAL/INVALID_SFX expulsam no 5º e geram um único warn por janela', async () => {
    const game = await createGame('truco', OPTS);
    await until(() => game.server.series !== null, 'série iniciada');
    const victim = game.players[2] as Player;
    let code = -1;
    victim.room.onLeave((c) => {
      code = c;
    });
    const before = logLines.filter((l) => l.includes('mensagem inválida')).length;
    victim.room.send('signal', { signalId: 'nao-existe' });
    victim.room.send('sfx', { sfxId: 'nao-existe' });
    victim.room.send('signal', { signalId: 'nao-existe' });
    victim.room.send('sfx', { sfxId: 'nao-existe' });
    victim.room.send('play', { card: 1 });
    await until(() => code !== -1, 'saída do cliente');
    expect(code).toBe(1008);
    expect(victim.errors).toEqual(
      expect.arrayContaining(['INVALID_SIGNAL', 'INVALID_SFX', 'INVALID_PAYLOAD']),
    );
    const warns = logLines.filter((l) => l.includes('mensagem inválida')).length - before;
    expect(warns).toBe(1);
  });
});

describe('TrucoRoom: auth temporária (TODO 2G) falha fechado', () => {
  it('devAuth: aceita userId/nickname válidos fora de produção e rejeita lixo', () => {
    expect(devAuth({ userId: 'u1', nickname: ' Ana ' }, 'test')).toEqual({
      userId: 'u1',
      nickname: 'Ana',
    });
    expect(devAuth({ userId: 'u1', nickname: 'Ana' }, 'development').userId).toBe('u1');
    for (const bad of [
      undefined,
      null,
      'x',
      [],
      {},
      { userId: '', nickname: 'a' },
      { userId: 'u', nickname: '' },
      { userId: 'u', nickname: 'a'.repeat(25) },
      { userId: 'u', nickname: 'a\u0000b' },
      { userId: 5, nickname: 'a' },
    ]) {
      expect(() => devAuth(bad, 'test')).toThrow();
    }
  });

  it('devAuth: production, qualquer outro valor e NODE_ENV ausente rejeitam tudo', () => {
    for (const env of ['production', 'staging', 'PRODUCTION', '', undefined]) {
      expect(() => devAuth({ userId: 'u1', nickname: 'Ana' }, env)).toThrow();
    }
  });

  it('em NODE_ENV=production a sala recusa a entrada mesmo com opções válidas', async () => {
    const server = await t.createRoom<TrucoRoom>('truco', OPTS);
    // Um jogador legítimo já sentado mantém a sala viva (sala vazia é descartada).
    await t.connectTo(server, { userId: 'u0', nickname: 'Zero' });
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(t.connectTo(server, { userId: 'u1', nickname: 'Ana' })).rejects.toThrow();
      expect(server.clients.length).toBe(1);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
    await expect(t.connectTo(server, { userId: 'u1', nickname: 'Ana' })).resolves.toBeDefined();
    expect(server.clients.length).toBe(2);
  });
});

describe('TrucoRoom: partida', () => {
  it('(a) 4 clientes jogam uma mão completa só com legalActions; nada vaza em nenhum patch', async () => {
    const game = await createGame('truco', OPTS);
    await until(() => game.server.series !== null, 'série iniciada');
    await settle(game, 'início');
    const rng = mulberry32(7);
    let steps = 0;
    while (seen(game, 'handDecided') === 0 && steps < 200) {
      expect(await step(game, randomPolicy, rng, `passo ${steps}`)).toBe(true);
      steps++;
    }
    expect(seen(game, 'handDecided')).toBe(1);
    for (const p of game.players) {
      const types = p.events.map((e) => e.event.type);
      expect(types).toContain('cardPlayed');
      expect(types).toContain('trickDecided');
    }
    // placar do cliente == placar do motor
    const st = (game.players[0] as Player).room.state as { game: { scores: number[] } };
    expect(plain<number>(st.game.scores)).toEqual([
      ...(game.server.series as SeriesState).match.scores,
    ]);
    assertEventStream(game);
    assertNoLeaks(game);
  });

  it('(b) série bo3 INTEIRA até seriesDecided, placar e winnerTeam conferem', async () => {
    const game = await createGame('truco', {
      variant: 'mineiro',
      format: 'bo3',
      ironHand: true,
      visibility: 'private',
    });
    await until(() => game.server.series !== null, 'série iniciada');
    await settle(game, 'início');
    const rng = mulberry32(99);
    let steps = 0;
    while (seen(game, 'seriesDecided') === 0 && steps < 2500) {
      // metade das ações vem da política aleatória (apostas), metade da primeira legal (acelera)
      const policy = steps % 2 === 0 ? randomPolicy : firstPolicy;
      if (!(await step(game, policy, rng, `passo ${steps}`))) break;
      steps++;
    }
    const series = game.server.series as SeriesState;
    expect(series.winner).not.toBeNull();
    expect(seen(game, 'seriesDecided')).toBe(1);
    expect(seen(game, 'gameDecided')).toBeGreaterThanOrEqual(2);
    expect(Math.max(...series.games)).toBe(2);
    for (const p of game.players) {
      const decided = p.events.find((e) => e.event.type === 'seriesDecided');
      expect(decided?.event.winnerTeam).toBe(series.winner);
      expect(decided?.event.games).toEqual([...series.games]);
      const st = p.room.state as {
        phase: string;
        series: { winnerTeam: number; games: number[]; gameNumber: number };
      };
      expect(st.phase).toBe('finished');
      expect(st.series.winnerTeam).toBe(series.winner);
      expect(plain<number>(st.series.games)).toEqual([...series.games]);
    }
    // série acabada: nenhum assento tem ação; a sala segue aberta pelo atraso configurado
    expect(actorOf(game)).toBeNull();
    // ação depois do fim: SERIES_FINISHED
    const p0 = game.players[0] as Player;
    p0.room.send('bet');
    await until(() => p0.errors.length > 0, 'erro após o fim');
    expect(p0.errors).toEqual(['SERIES_FINISHED']);
    assertEventStream(game);
    assertNoLeaks(game);
    expect(logLines.filter((l) => /\b(paus|copas|espadas|ouros)\b/.test(l))).toEqual([]);
  }, 120_000);

  for (const [name, options, expectSpecial] of [
    ['truco-onze', OPTS, 'maoDeOnze'],
    ['truco-onze-mineiro', { ...OPTS, variant: 'mineiro' }, 'maoDeOnze'],
    ['truco-ferro', OPTS, 'maoDeFerro'],
    ['truco-ferro-mineiro', { ...OPTS, variant: 'mineiro' }, 'maoDeFerro'],
  ] as const) {
    it(`(i) ${name}: mão de ${expectSpecial === 'maoDeOnze' ? 'onze/dez' : 'ferro'} sem vazamento`, async () => {
      const game = await createGame(name, options);
      await until(() => game.server.series !== null, 'série iniciada');
      await settle(game, 'início');
      expect(game.server.series?.match.hand.special).toBe(expectSpecial);
      const rng = mulberry32(5);
      let steps = 0;
      let sawDecision = false;
      while (seen(game, 'handDecided') === 0 && steps < 200) {
        const actor = actorOf(game);
        if (actor?.ids.includes('specialPlay')) sawDecision = true;
        // na decisão de onze/dez joga (não foge) para exercitar a mão inteira
        const policy: Policy = (ids, r) =>
          ids.includes('specialPlay') ? 'specialPlay' : randomPolicy(ids, r);
        expect(await step(game, policy, rng, `passo ${steps}`)).toBe(true);
        steps++;
      }
      expect(seen(game, 'handDecided')).toBe(1);
      if (expectSpecial === 'maoDeOnze') expect(sawDecision).toBe(true);
      if (expectSpecial === 'maoDeFerro') {
        const started = (game.players[0] as Player).events.find(
          (e) => e.event.type === 'handStarted',
        );
        expect(started?.event.special).toBe('maoDeFerro');
        // às cegas: as cartas jogadas são abertas, mas ninguém recebeu mão própria
      }
      assertEventStream(game);
      assertNoLeaks(game);
    });
  }
});

describe('TrucoRoom: mensagens inválidas e erros', () => {
  async function started(name = 'truco'): Promise<Game> {
    const game = await createGame(name, OPTS);
    await until(() => game.server.series !== null, 'série iniciada');
    await settle(game, 'início');
    return game;
  }

  /** Um assento que NÃO é o da vez e uma carta qualquer da mão dele. */
  function bystander(game: Game): { player: Player; card: Card } {
    const series = game.server.series as SeriesState;
    const turn = series.match.hand.turn;
    const seat = (turn + 1) % 4;
    const card = series.match.hand.hands[seat]?.[0] as Card;
    return { player: game.players[seat] as Player, card };
  }

  it('(c) ação fora do turno -> NOT_YOUR_TURN e estado inalterado', async () => {
    const game = await started();
    const before = game.server.series;
    const before01 = JSON.stringify(before);
    const { player, card } = bystander(game);
    const events = game.server.eventLog.length;
    player.room.send('play', { card });
    await until(() => player.errors.length > 0, 'erro');
    expect(player.errors).toEqual(['NOT_YOUR_TURN']);
    expect(game.server.series).toBe(before);
    expect(JSON.stringify(game.server.series)).toBe(before01);
    expect(game.server.eventLog.length).toBe(events);
    await settle(game, 'após erro');
    assertNoLeaks(game);
  });

  it('(d) mensagem com seat forjado -> INVALID_PAYLOAD e nada muda', async () => {
    const game = await started();
    const before = game.server.series;
    const turn = (before as SeriesState).match.hand.turn;
    const owner = game.players[turn] as Player;
    const card = (before as SeriesState).match.hand.hands[turn]?.[0] as Card;
    const forger = game.players[(turn + 1) % 4] as Player;
    const third = game.players[(turn + 2) % 4] as Player;
    forger.room.send('play', { card, seat: turn });
    owner.room.send('play', { card, seat: turn });
    forger.room.send('bet', { seat: turn });
    forger.room.send('play', { type: 'accept', card });
    third.room.send('voteCancel', { seat: 1 });
    third.room.send('nao-existe', {});
    third.room.send('play', 'texto');
    await until(
      () => forger.errors.length >= 3 && owner.errors.length >= 1 && third.errors.length >= 3,
      'erros',
    );
    expect([...forger.errors, ...third.errors].every((c) => c === 'INVALID_PAYLOAD')).toBe(true);
    expect(owner.errors).toEqual(['INVALID_PAYLOAD']);
    expect(game.server.series).toBe(before);
    expect(game.server.state.cancelVotes.length).toBe(0);
  });

  it('(e) carta que não está na mão -> erro do motor', async () => {
    const game = await started();
    const series = game.server.series as SeriesState;
    const turn = series.match.hand.turn;
    const owner = game.players[turn] as Player;
    const foreign = series.match.hand.hands[(turn + 1) % 4]?.[0] as Card;
    owner.room.send('play', { card: foreign });
    await until(() => owner.errors.length > 0, 'erro');
    expect(owner.errors).toEqual(['CARD_NOT_IN_HAND']);
    expect(game.server.series).toBe(series);
  });

  it('bet fora de hora e playBlind fora da mão de ferro devolvem erro do motor', async () => {
    const game = await started();
    const series = game.server.series as SeriesState;
    const { player } = bystander(game);
    player.room.send('bet');
    player.room.send('accept');
    player.room.send('special', { decision: 'play' });
    player.room.send('playBlind', { index: 0 });
    await until(() => player.errors.length >= 4, 'erros');
    expect(player.errors.every((c) => c !== 'INVALID_PAYLOAD' && c !== 'RATE_LIMITED')).toBe(true);
    expect(game.server.series).toBe(series);
  });

  it('(f) rate limit por assento -> RATE_LIMITED', async () => {
    const game = await createGame('truco-rate', OPTS);
    await until(() => game.server.series !== null, 'série iniciada');
    const { player, card } = bystander(game);
    player.room.send('play', { card });
    player.room.send('play', { card });
    player.room.send('play', { card });
    await until(() => player.errors.length >= 3, 'erros');
    expect(player.errors[0]).toBe('NOT_YOUR_TURN');
    expect(player.errors.slice(1)).toEqual(['RATE_LIMITED', 'RATE_LIMITED']);
    // outro assento não é afetado
    const other = game.players[(player.seat + 1) % 4] as Player;
    other.room.send('play', { card });
    await until(() => other.errors.length >= 1, 'erro do outro');
    expect(other.errors[0]).not.toBe('RATE_LIMITED');
  });

  it('payload inválido repetido (5 em 10 s) expulsa o cliente com código de política', async () => {
    const game = await started();
    const victim = game.players[1] as Player;
    let code = -1;
    victim.room.onLeave((c) => {
      code = c;
    });
    for (let i = 0; i < 5; i++) victim.room.send('play', { card: 1 });
    await until(() => code !== -1, 'saída do cliente');
    expect(code).toBe(1008);
    expect(game.server.series).not.toBeNull();
    await until(() => game.server.clients.length === 3, 'sala com 3 clientes');
  });

  it('flood de mensagens por segundo derruba a conexão (maxMessagesPerSecond)', async () => {
    const game = await createGame('truco-rate', OPTS);
    await until(() => game.server.series !== null, 'série iniciada');
    const victim = game.players[3] as Player;
    let code = -1;
    victim.room.onLeave((c) => {
      code = c;
    });
    for (let i = 0; i < 80; i++) victim.room.send('ready');
    await until(() => code !== -1, 'conexão encerrada');
    expect(code).not.toBe(1000);
  });

  it('mensagem acima de MAX_MESSAGE_BYTES derruba a conexão (limite do transporte)', async () => {
    const game = await started();
    const victim = game.players[2] as Player;
    let code = -1;
    victim.room.onLeave((c) => {
      code = c;
    });
    victim.room.send('chat', { scope: 'table', text: 'x'.repeat(MAX_MESSAGE_BYTES * 2) });
    await until(() => code !== -1, 'conexão encerrada');
    expect(code).not.toBe(1000);
  });

  it('signal, sfx, chat e ready são ignorados por enquanto (sem erro, sem efeito)', async () => {
    const game = await started();
    const series = game.server.series;
    const p = game.players[0] as Player;
    p.room.send('ready');
    p.room.send('chat', { scope: 'table', text: 'oi' });
    // Sentinela: as mensagens são processadas em ordem, então qualquer erro das anteriores viria antes.
    p.room.send('play', { card: 1 });
    await until(() => p.errors.length > 0, 'erro da sentinela');
    await sleep(60);
    expect(p.errors).toEqual(['INVALID_PAYLOAD']);
    expect(game.server.series).toBe(series);
  });

  it('voteCancel: 4 votos cancelam a série (phase finished, sem vencedor)', async () => {
    const game = await started();
    for (const p of game.players.slice(0, 3)) p.room.send('voteCancel');
    await until(() => (game.server.state.cancelVotes.length as number) === 3, '3 votos');
    expect(game.server.series?.cancelled).toBe(false);
    (game.players[3] as Player).room.send('voteCancel');
    await until(() => game.server.series?.cancelled === true, 'cancelada');
    await until(
      () => game.players.every((p) => (p.room.state as { phase: string }).phase === 'finished'),
      'phase finished',
    );
    expect(seenAll(game, 'seriesCancelled')).toBe(true);
    for (const p of game.players) {
      expect((p.room.state as { series: { winnerTeam: number } }).series.winnerTeam).toBe(-1);
    }
  });
});

function seenAll(game: Game, type: string): boolean {
  return game.players.every((p) => p.events.some((e) => e.event.type === type));
}

describe('TrucoRoom: timer de turno', () => {
  it('(g) estouro prepara jogada automática do motor e o turno avança', async () => {
    const game = await createGame('truco-timeout', OPTS);
    await until(() => game.server.series !== null, 'série iniciada');
    const first = game.server.series as SeriesState;
    const seat = first.match.hand.turn;
    const p0 = game.players[0] as Player;
    await until(() => p0.turnTimers.length > 0, 'turnTimer');
    expect(p0.turnTimers[0]?.seat).toBe(seat);
    expect(p0.turnTimers[0]?.deadlineAt).toBeGreaterThan(Date.now() - 1000);
    const played = (): Received | undefined => p0.events.find((e) => e.event.type === 'cardPlayed');
    await until(() => played() !== undefined, 'jogada automática', 2000);
    const ev = played() as Received;
    expect(ev.event.seat).toBe(seat);
    expect(ev.event.covered).toBe(false);
    expect(game.server.series).not.toBe(first);
    expect(game.server.timeouts.get(seat)).toBe(1);
    // o turno avançou: novo turnTimer para outro assento
    await until(() => p0.turnTimers.length >= 2, 'novo turnTimer');
    expect(p0.turnTimers[1]?.seat).not.toBe(seat);
    await settle(game, 'após timeout');
    assertNoLeaks(game);
  });

  it('o timer nunca fica armado depois do fim da série (cancelada)', async () => {
    const game = await createGame('truco-timeout', OPTS);
    await until(() => game.server.series !== null, 'série iniciada');
    for (const p of game.players) p.room.send('voteCancel');
    await until(() => game.server.series?.cancelled === true, 'cancelada');
    await until(() => seenAll(game, 'seriesCancelled'), 'evento de cancelamento');
    const count = (game.players[0] as Player).events.length;
    await sleep(400);
    expect((game.players[0] as Player).events.length).toBe(count);
    expect((game.players[0] as Player).errors).toEqual([]);
  });
});

describe('TrucoRoom: semente do RNG', () => {
  it('a semente fixa do servidor (nunca do cliente) reproduz as mesmas mãos', async () => {
    const a = await createGame('truco', OPTS);
    await until(() => a.server.series !== null, 'a');
    const b = await createGame('truco', OPTS);
    await until(() => b.server.series !== null, 'b');
    expect(a.server.seed).toBe(1);
    expect(JSON.stringify(a.server.series?.match.hand.hands)).toBe(
      JSON.stringify(b.server.series?.match.hand.hands),
    );
  });
});

// ------------------------------------------------------------------------------------------------
// 2E: reconexão em 60 s e bot de ausência
// ------------------------------------------------------------------------------------------------

const devToken = (seat: number): string => `dev:user-${seat}`;
const live = (game: Game): Player[] => game.players.filter((p) => !p.gone);
const pending = (game: Game): number | null => pendingSeat(game.server.series as SeriesState);
const logCount = (game: Game, type: string): number =>
  game.server.eventLog.filter((e) => e.event.type === type).length;
const statusOf = (game: Game, seat: number): string =>
  (game.server.state.players[seat] as { status: string }).status;

/** Joga o que não arrisca: decisão de onze, coberta, aberta, às cegas, aceitar. Nunca aposta. */
const quietPolicy: Policy = (ids) =>
  ids.find((i) => i === 'specialPlay') ??
  ids.find((i) => i.startsWith('playCovered:')) ??
  ids.find((i) => i.startsWith('play:')) ??
  ids.find((i) => i.startsWith('playBlind:')) ??
  ids.find((i) => i === 'accept') ??
  (ids[0] as string);

/** Joga com os clientes vivos até `stop()`; o bot e o timer movem o resto. */
async function drive(
  game: Game,
  stop: () => boolean,
  label: string,
  policy: Policy = quietPolicy,
  ms = 10_000,
): Promise<void> {
  const rng = mulberry32(3);
  const end = Date.now() + ms;
  while (!stop()) {
    if (Date.now() > end) throw new Error(`timeout: ${label}`);
    if (!(await step(game, policy, rng, label))) await sleep(5);
  }
}

async function startedRec(name: string, options: RoomOptions = OPTS): Promise<Game> {
  const game = await createGame(name, options);
  await until(() => game.server.series !== null, 'série iniciada');
  await settle(game, 'início');
  // O 1º cliente já recebeu os eventos de abertura (o último a sentar os recebe antes de ligar o handler).
  await until(
    () => (game.players[0] as Player).events.length === game.server.eventLog.length,
    'eventos de abertura',
  );
  return game;
}

/** Derruba o socket SEM consentimento (o servidor vê queda, não saída) e espera o `away`. */
async function dropSeat(game: Game, seat: number): Promise<void> {
  const p = game.players[seat] as Player;
  p.room.reconnection.enabled = false;
  p.gone = true;
  p.room.connection.close();
  await until(() => statusOf(game, seat) === 'away', `assento ${seat} away`);
}

/** Tenta reconectar com o token de reconexão de `from` apresentando a identidade `auth`. */
async function reconnectWith(from: Player, auth: string | undefined): Promise<SdkRoom> {
  t.sdk.http.authToken = auth;
  try {
    return (await t.sdk.reconnect(from.room.reconnectionToken)) as unknown as SdkRoom;
  } finally {
    t.sdk.http.authToken = undefined;
  }
}

/** Reconecta o assento com o token de reconexão e a identidade dele; liga o detector ao novo socket. */
async function rejoin(game: Game, seat: number): Promise<Player> {
  const room = await reconnectWith(game.players[seat] as Player, devToken(seat));
  const p: Player = {
    seat,
    room,
    events: [],
    errors: [],
    turnTimers: [],
    presences: [],
    gone: false,
  };
  // Sem `await` entre a resposta e a ligação: o estado completo ainda não chegou.
  wirePlayer(game, p);
  game.players[seat] = p;
  return p;
}

/** Volta por um NOVO join (sem token de reconexão), como após reabrir o app. */
async function joinAgain(game: Game, seat: number): Promise<Player> {
  const room = await t.connectTo<Room>(game.server as unknown as Room, {
    userId: `user-${seat}`,
    nickname: `Jogador ${seat}`,
  });
  const p: Player = {
    seat,
    room,
    events: [],
    errors: [],
    turnTimers: [],
    presences: [],
    gone: false,
  };
  wirePlayer(game, p);
  game.players[seat] = p;
  return p;
}

const seenPresence = (game: Game, seat: number, status: string): boolean =>
  live(game).every(
    (p) => p.seat === seat || p.presences.some((m) => m.seat === seat && m.status === status),
  );

describe('TrucoRoom: reconexão e bot de ausência (2E)', () => {
  it('(a) cai e reconecta na janela: continua jogando, status volta e o replay vem em ordem', async () => {
    const game = await startedRec('truco-rec');
    const d = ((pending(game) as number) + 3) % 4;
    const lastSeen = game.server.eventLog.length; // tudo isto já foi enviado ao socket de d
    await dropSeat(game, d);
    await until(() => seenPresence(game, d, 'away'), 'presence away para a mesa');
    expect((game.server.state.players[d] as { isBot: boolean }).isBot).toBe(false);
    // os outros três jogam enquanto d está fora
    await drive(game, () => pending(game) === d, 'até a vez de d');
    const p = await rejoin(game, d);
    const expected = game.server.eventLog.filter((e) => e.seq > lastSeen).map((e) => e.seq);
    expect(expected.length).toBeGreaterThanOrEqual(3);
    await until(() => p.events.length >= expected.length, 'replay');
    expect(p.events.slice(0, expected.length).map((e) => e.seq)).toEqual(expected);
    await until(() => statusOf(game, d) === 'connected', 'status connected');
    await until(() => seenPresence(game, d, 'online'), 'presence online para a mesa');
    // o novo cliente vê o estado completo e o relógio do turno
    await until(() => (p.room.state as { phase: string }).phase === 'playing', 'estado completo');
    await until(() => p.turnTimers.some((m) => m.seat === d), 'turnTimer reenviado');
    await settle(game, 'após reconectar');
    // d joga a vez dele e a mão segue até o fim
    await drive(game, () => logCount(game, 'handDecided') > 0, 'mão decidida');
    expect(game.server.timeouts.get(d)).toBe(0);
    assertNoLeaks(game);
    expect(live(game).flatMap((x) => x.errors)).toEqual([]);
  });

  it('(b) cai e NÃO volta: passada a janela o bot assume e a partida avança sem travar', async () => {
    const game = await startedRec('truco-rec-short');
    const d = pending(game) as number;
    await dropSeat(game, d);
    // só o bot (depois de 0,4 s) pode mover a vez de d: o timer de turno é de 60 s
    await until(
      () => (game.server.state.players[d] as { isBot: boolean }).isBot,
      'bot assumiu',
      3000,
    );
    expect(statusOf(game, d)).toBe('bot');
    await until(() => seenPresence(game, d, 'bot'), 'presence bot para a mesa');
    await drive(game, () => logCount(game, 'handDecided') > 0, 'mão decidida com o bot');
    const playedByBot = game.server.eventLog.filter(
      (e) => e.event.type === 'cardPlayed' && e.event.seat === d,
    );
    expect(playedByBot.length).toBeGreaterThanOrEqual(2);
    // o bot nunca pede nem aumenta aposta
    const bets = game.server.eventLog.filter(
      (e) => (e.event.type === 'betCalled' || e.event.type === 'betRaised') && e.event.seat === d,
    );
    expect(bets).toEqual([]);
    assertNoLeaks(game);
  });

  it('(c) o dono volta depois do bot assumir: substitui o bot, e estranho não entra', async () => {
    const game = await startedRec('truco-rec-short');
    const d = ((pending(game) as number) + 1) % 4;
    await dropSeat(game, d);
    await until(
      () => (game.server.state.players[d] as { isBot: boolean }).isBot,
      'bot assumiu',
      3000,
    );
    await until(() => !game.server.locked, 'sala destrancada');
    await sleep(30);
    // quem não é dono não ocupa o assento do bot
    await expect(
      t.connectTo(game.server as unknown as Room, { userId: 'intruso', nickname: 'Intruso' }),
    ).rejects.toThrow();
    expect((game.server.state.players[d] as { nickname: string }).nickname).toBe(`Jogador ${d}`);
    expect(statusOf(game, d)).toBe('bot');
    // o dono (mesmo userId) volta por um novo join e retoma o assento
    const p = await joinAgain(game, d);
    await until(() => statusOf(game, d) === 'connected', 'status connected');
    expect((game.server.state.players[d] as { isBot: boolean }).isBot).toBe(false);
    await until(() => seenPresence(game, d, 'online'), 'presence online');
    await settle(game, 'após retomar');
    const before = logCount(game, 'cardPlayed');
    await drive(game, () => logCount(game, 'handDecided') > 0, 'mão decidida com o dono');
    expect(logCount(game, 'cardPlayed')).toBeGreaterThan(before);
    expect(p.errors).toEqual([]);
    assertNoLeaks(game);
  });

  it('(d) saída consentida em playing: o bot assume na hora e a janela não se abre', async () => {
    const game = await startedRec('truco-rec');
    const d = ((pending(game) as number) + 2) % 4;
    const p = game.players[d] as Player;
    const token = p.room.reconnectionToken;
    p.gone = true;
    const started = Date.now();
    await p.room.leave();
    await until(
      () => (game.server.state.players[d] as { isBot: boolean }).isBot,
      'bot na hora',
      1500,
    );
    expect(Date.now() - started).toBeLessThan(2500); // janela configurada: 5 s
    expect(statusOf(game, d)).toBe('bot');
    await until(() => seenPresence(game, d, 'bot'), 'presence bot');
    // o token de reconexão não vale: saída consentida não abre janela
    t.sdk.http.authToken = devToken(d);
    try {
      await expect(t.sdk.reconnect(token)).rejects.toBeDefined();
    } finally {
      t.sdk.http.authToken = undefined;
    }
    await drive(game, () => logCount(game, 'handDecided') > 0, 'mão decidida com o bot');
    assertNoLeaks(game);
  });

  describe('(e) segurança da retomada', () => {
    it('outro userId com o token do assento é recusado e o assento fica intacto', async () => {
      const game = await startedRec('truco-rec');
      const victim = game.players[0] as Player;
      await dropSeat(game, 0);
      const clientsBefore = game.server.clients.length;
      // jogador do assento 1 usa o token de reconexão do assento 0 apresentando a própria identidade
      await expect(reconnectWith(victim, devToken(1))).rejects.toBeDefined();
      // sem identidade, ou com formato inválido, ou identidade inexistente
      await expect(reconnectWith(victim, undefined)).rejects.toBeDefined();
      await expect(reconnectWith(victim, 'user-0')).rejects.toBeDefined();
      await expect(reconnectWith(victim, 'dev:')).rejects.toBeDefined();
      await expect(reconnectWith(victim, 'dev:intruso')).rejects.toBeDefined();
      expect(game.server.clients.length).toBe(clientsBefore);
      expect(statusOf(game, 0)).toBe('away');
      expect(game.server.authorizeReconnect(victim.room.sessionId, 'user-0')).toBe(true);
      expect(game.server.authorizeReconnect(victim.room.sessionId, 'user-1')).toBe(false);
      expect(game.server.authorizeReconnect('inexistente', 'user-0')).toBe(false);
      // o token não foi gasto: o dono ainda reconecta
      const p = await rejoin(game, 0);
      await until(() => statusOf(game, 0) === 'connected', 'dono reconectou');
      await settle(game, 'dono de volta');
      expect(p.errors).toEqual([]);
      assertNoLeaks(game);
    });

    it('o token de reconexão de uma sessão não serve a outro assento', async () => {
      const game = await startedRec('truco-rec');
      const victim = game.players[0] as Player;
      const attacker = game.players[1] as Player;
      await dropSeat(game, 0);
      const tokenOfVictim = victim.room.reconnectionToken.split(':')[1] as string;
      // sessão do atacante + token da vítima + identidade do atacante (confere com o assento 1)
      t.sdk.http.authToken = devToken(1);
      try {
        await expect(
          t.sdk.consumeSeatReservation({
            name: 'truco',
            sessionId: attacker.room.sessionId,
            roomId: game.server.roomId,
            processId: matchMaker.processId,
            reconnectionToken: tokenOfVictim,
          } as never),
        ).rejects.toBeDefined();
      } finally {
        t.sdk.http.authToken = undefined;
      }
      // o assento 1 segue conectado e jogando; o 0 segue ausente
      expect(statusOf(game, 0)).toBe('away');
      expect(statusOf(game, 1)).toBe('connected');
      expect(game.server.clients.length).toBe(3);
      await rejoin(game, 0);
      await until(() => statusOf(game, 0) === 'connected', 'dono reconectou');
      await settle(game, 'depois da tentativa');
      assertNoLeaks(game);
    });

    it('Host forjado com # ou ? não esconde a reconexão do guard (upgrade real)', async () => {
      const game = await startedRec('truco-rec');
      const victim = game.players[0] as Player;
      await dropSeat(game, 0);
      const port = ((t.server.transport.server as { address(): unknown }).address() as AddressInfo)
        .port;
      const tokenOfVictim = victim.room.reconnectionToken.split(':')[1] as string;
      const path =
        `/${matchMaker.processId}/${game.server.roomId}?sessionId=${victim.room.sessionId}` +
        `&reconnectionToken=${tokenOfVictim}&_authToken=${encodeURIComponent(devToken(1))}`;
      const upgrade = (host: string): Promise<number | 'upgrade'> =>
        new Promise((resolve, reject) => {
          const req = request({
            host: '127.0.0.1',
            port,
            path,
            headers: {
              Host: host,
              Connection: 'Upgrade',
              Upgrade: 'websocket',
              'Sec-WebSocket-Key': Buffer.from('0123456789abcdef').toString('base64'),
              'Sec-WebSocket-Version': '13',
            },
          });
          req.on('response', (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          });
          req.on('upgrade', (_res, socket) => {
            socket.destroy();
            resolve('upgrade');
          });
          req.on('error', reject);
          req.end();
        });
      // Controle: Host honesto + identidade errada -> 403 (guard vê a reconexão)
      expect(await upgrade('localhost')).toBe(403);
      // Hosts forjados: o guard antigo não via o token e deixava o upgrade passar
      for (const host of ['x#', 'x?a=', 'x/y', 'x@y', 'a b', 'x#frag?reconnectionToken=1']) {
        expect(await upgrade(host)).toBe(400);
      }
      expect(game.server.clients.length).toBe(3);
      expect(statusOf(game, 0)).toBe('away');
      const p = await rejoin(game, 0);
      await until(() => statusOf(game, 0) === 'connected', 'dono reconectou');
      expect(p.errors).toEqual([]);
    });

    it('POST /matchmake/reconnect com token de sessão CONECTADA não derruba a vítima', async () => {
      const game = await startedRec('truco-rec');
      const victim = game.players[1] as Player;
      const tokenLive = victim.room.reconnectionToken;
      for (const auth of [devToken(2), undefined]) {
        await expect(reconnectWith(victim, auth)).rejects.toBeDefined();
      }
      // a própria identidade dela também não pode ser usada para derrubar o socket vivo
      await expect(t.sdk.reconnect(tokenLive)).rejects.toBeDefined();
      await sleep(150);
      expect(game.server.clients.length).toBe(4);
      expect(statusOf(game, 1)).toBe('connected');
      expect(victim.room.connection.isOpen).toBe(true);
      expect(game.server.authorizeReconnect(victim.room.sessionId, 'user-1')).toBe(true);
      await settle(game, 'vítima intacta');
    });

    it('devReconnectUserId só aceita dev:<userId> em development/test', () => {
      expect(devReconnectUserId('dev:ana', 'test')).toBe('ana');
      expect(devReconnectUserId('dev:ana', 'development')).toBe('ana');
      for (const env of ['production', 'staging', '', undefined]) {
        expect(devReconnectUserId('dev:ana', env)).toBeUndefined();
      }
      for (const bad of [undefined, null, '', 'ana', 'dev:', 'DEV:ana', `dev:${'x'.repeat(65)}`]) {
        expect(devReconnectUserId(bad, 'test')).toBeUndefined();
      }
    });
  });

  it('(f) todos os humanos ausentes além de abandonMs: série cancelada e sala encerrada', async () => {
    const game = await startedRec('truco-rec-abandon');
    const roomId = game.server.roomId;
    for (let s = 0; s < 4; s++) await dropSeat(game, s);
    await until(() => game.server.series?.cancelled === true, 'série cancelada', 3000);
    expect(game.server.state.phase).toBe('finished');
    expect(game.server.eventLog.some((e) => e.event.type === 'seriesCancelled')).toBe(true);
    expect((game.server.state.series as { winnerTeam: number }).winnerTeam).toBe(-1);
    await until(() => t.getRoomById(roomId) === undefined, 'sala encerrada', 3000);
  });

  it('(f2) com um humano conectado a série não é cancelada por abandono', async () => {
    const game = await startedRec('truco-rec-abandon');
    for (let s = 1; s < 4; s++) await dropSeat(game, s);
    await sleep(700); // mais que o dobro de abandonMs
    expect(game.server.series?.cancelled).toBe(false);
    expect(game.server.state.phase).toBe('playing');
  });

  it('(f3) reconectar antes de abandonMs desarma o cancelamento', async () => {
    const game = await startedRec('truco-rec-abandon');
    const abandonTimer = (): unknown =>
      (game.server as unknown as { abandonTimer: unknown }).abandonTimer;
    for (let s = 0; s < 4; s++) await dropSeat(game, s);
    expect(abandonTimer()).not.toBeNull();
    await rejoin(game, 2);
    await until(() => statusOf(game, 2) === 'connected', 'assento 2 de volta');
    expect(abandonTimer()).toBeNull(); // falha se `clearAbandon` for removido
    await sleep(700);
    expect(game.server.series?.cancelled).toBe(false);
  });

  describe('(g) rate limit e strikes persistem na reconexão', () => {
    it('payload inválido: os 4 strikes de antes valem e o 5º expulsa', async () => {
      const game = await startedRec('truco-rec');
      const v = game.players[1] as Player;
      for (let i = 0; i < 4; i++) v.room.send('play', { card: 1 });
      await until(() => v.errors.length === 4, '4 erros');
      await dropSeat(game, 1);
      const p = await rejoin(game, 1);
      let code = -1;
      p.room.onLeave((c) => {
        code = c;
      });
      p.room.send('play', { card: 1 });
      await until(() => code !== -1, 'expulso no 5º', 3000);
      expect(code).toBe(1008);
    });

    it('rate limit por assento: reconectar não zera o intervalo mínimo', async () => {
      const game = await createGame('truco-rec-rate', OPTS);
      await until(() => game.server.series !== null, 'série iniciada');
      const series = game.server.series as SeriesState;
      const seat = (series.match.hand.turn + 1) % 4;
      const card = series.match.hand.hands[seat]?.[0] as Card;
      const v = game.players[seat] as Player;
      v.room.send('play', { card });
      await until(() => v.errors.length === 1, 'primeiro erro');
      expect(v.errors).toEqual(['NOT_YOUR_TURN']);
      await dropSeat(game, seat);
      const p = await rejoin(game, seat);
      p.room.send('play', { card });
      await until(() => p.errors.length === 1, 'erro após reconectar', 3000);
      expect(p.errors).toEqual(['RATE_LIMITED']);
    });
  });

  describe('(h) voteCancel', () => {
    it('unânime entre os humanos conectados (um ausente, um bot) cancela; voto de quem cai some', async () => {
      const game = await startedRec('truco-rec');
      const [p0, p1, p2, p3] = game.players as [Player, Player, Player, Player];
      p3.gone = true;
      await p3.room.leave(); // bot na hora
      await until(() => statusOf(game, 3) === 'bot', 'assento 3 bot');
      p2.room.send('voteCancel');
      await until(
        () => (game.server.state.cancelVotes.toJSON() as number[]).join() === '2',
        'voto de 2',
      );
      await dropSeat(game, 2); // o voto de quem fica ausente é descartado
      await until(() => game.server.state.cancelVotes.length === 0, 'voto de 2 descartado');
      p0.room.send('voteCancel');
      await until(
        () => (game.server.state.cancelVotes.toJSON() as number[]).join() === '0',
        'voto de 0',
      );
      await sleep(50);
      expect(game.server.series?.cancelled).toBe(false);
      p1.room.send('voteCancel');
      await until(() => game.server.series?.cancelled === true, 'cancelada', 3000);
      expect(game.server.state.phase).toBe('finished');
    });

    it('queda do último que faltava votar fecha a unanimidade dos que restam', async () => {
      const game = await startedRec('truco-rec');
      for (const s of [0, 1]) (game.players[s] as Player).room.send('voteCancel');
      await until(() => game.server.state.cancelVotes.length === 2, '2 votos');
      await dropSeat(game, 2);
      expect(game.server.series?.cancelled).toBe(false);
      await dropSeat(game, 3);
      await until(() => game.server.series?.cancelled === true, 'cancelada', 3000);
    });

    it('o voto zera a cada nova mão', async () => {
      const game = await startedRec('truco-rec');
      (game.players[0] as Player).room.send('voteCancel');
      await until(() => game.server.state.cancelVotes.length === 1, 'voto de 0');
      await drive(game, () => logCount(game, 'handStarted') >= 2, 'nova mão');
      expect(game.server.state.cancelVotes.length).toBe(0);
      expect(game.server.series?.cancelled).toBe(false);
    });
  });

  it('expulso por strikes não ganha janela de 60 s: o bot assume e ele não reentra', async () => {
    const game = await startedRec('truco-rec');
    const v = game.players[1] as Player;
    const token = v.room.reconnectionToken;
    v.room.reconnection.enabled = false;
    for (let i = 0; i < 5; i++) v.room.send('play', { card: 1 });
    v.gone = true;
    // janela configurada: 5 s; bot em bem menos que isso
    await until(() => statusOf(game, 1) === 'bot', 'bot assumiu o expulso', 1500);
    await until(() => !game.server.locked, 'sala destrancada');
    await sleep(30);
    // não volta pelo token, nem por novo join com o mesmo userId
    t.sdk.http.authToken = devToken(1);
    try {
      await expect(t.sdk.reconnect(token)).rejects.toBeDefined();
    } finally {
      t.sdk.http.authToken = undefined;
    }
    await expect(joinAgain(game, 1)).rejects.toThrow();
    expect(statusOf(game, 1)).toBe('bot');
    // os outros seguem o jogo normalmente
    await drive(game, () => logCount(game, 'handDecided') > 0, 'mão decidida com o bot');
  });

  it('sala em série com bot não volta à lista pública: joinOrCreate de estranho não dá ROOM_FULL', async () => {
    const game = await startedRec('truco-rec');
    const d = ((pending(game) as number) + 1) % 4;
    const p = game.players[d] as Player;
    p.gone = true;
    await p.room.leave();
    await until(() => statusOf(game, d) === 'bot', 'bot assumiu');
    await until(() => !game.server.locked, 'sala destrancada');
    // fora da lista pública: o matchmaker não a oferece a `joinOrCreate`
    const open = await matchMaker.query({ name: 'truco-rec', private: false, locked: false });
    expect(open.map((r) => r.roomId)).not.toContain(game.server.roomId);
    // e o estranho não toma ROOM_FULL da sala em série (aqui falha ao CRIAR outra: opções de join
    // não são opções de sala; o ponto é não casar com a sala em andamento)
    await expect(
      t.sdk.joinOrCreate('truco-rec', { ...OPTS, userId: 'estranho', nickname: 'Estranho' }),
    ).rejects.toThrow(/INVALID_OPTIONS/);
    expect(game.server.clients.length).toBe(3);
    // o dono ainda reentra por joinById
    await joinAgain(game, d);
    await until(() => statusOf(game, d) === 'connected', 'dono de volta');
  });

  it('reconectar não estende o prazo do turno', async () => {
    const game = await startedRec('truco-rec');
    const d = pending(game) as number;
    const turn = (): { seat: number; deadlineAt: number } =>
      (game.server as unknown as { currentTurn: { seat: number; deadlineAt: number } }).currentTurn;
    const original = turn().deadlineAt;
    await dropSeat(game, d);
    await sleep(120);
    const p = await rejoin(game, d);
    await until(() => p.turnTimers.length > 0, 'turnTimer ao reconectar');
    expect(turn()).toEqual({ seat: d, deadlineAt: original });
    expect(p.turnTimers.at(-1)).toEqual({ seat: d, deadlineAt: original });
    expect((game.server.state as unknown as { turnDeadlineAt: number }).turnDeadlineAt).toBe(
      original,
    );
  });

  it('eventLog com teto: descartados contam em eventsEvicted e lacuna não gera replay parcial', async () => {
    const game = await startedRec('truco-rec-log');
    const total = (): number => game.server.eventsEvicted + game.server.eventLog.length;
    const q = ((pending(game) as number) + 3) % 4;
    await dropSeat(game, q);
    const before = total();
    while (pending(game) !== q) {
      const actor = actorOf(game);
      if (actor === null) throw new Error('sem ator');
      const n = total();
      const msg = toMessage(quietPolicy(actor.ids, mulberry32(1)));
      if (msg.payload === undefined) actor.player.room.send(msg.type);
      else actor.player.room.send(msg.type, msg.payload);
      await until(() => total() > n, 'jogada processada');
      await settle(game, 'após jogada');
    }
    expect(total() - before).toBeGreaterThanOrEqual(3);
    expect(game.server.eventLog.length).toBeLessThanOrEqual(2);
    expect(game.server.eventsEvicted).toBeGreaterThan(0);
    const p = await rejoin(game, q);
    await until(() => (p.room.state as { phase: string }).phase === 'playing', 'estado completo');
    await settle(game, 'após lacuna');
    await sleep(50);
    expect(p.events).toEqual([]); // sem replay parcial; vale o estado completo
    const mine = Object.values((json(p) as Privates).privates)[0];
    expect(mine?.legalActions.length).toBeGreaterThan(0);
    assertNoLeaks(game);
  });

  it('(i) o dono volta com o bot agendado: sem ação dupla no turno', async () => {
    const game = await startedRec('truco-rec-slow');
    const d = pending(game) as number;
    const p0 = game.players[d] as Player;
    p0.gone = true;
    await p0.room.leave(); // bot agendado para daqui a 3 s
    await until(() => statusOf(game, d) === 'bot', 'bot agendado');
    await until(() => !game.server.locked, 'sala destrancada');
    await sleep(30);
    const before = game.server.eventLog.filter(
      (e) => e.event.type === 'cardPlayed' && e.event.seat === d,
    ).length;
    const p = await joinAgain(game, d);
    await until(() => statusOf(game, d) === 'connected', 'dono de volta');
    expect(pending(game)).toBe(d);
    // o bot agendado (3 s) foi cancelado na retomada, sem depender de corrida de relógio
    expect((game.server as unknown as { botTimer: unknown }).botTimer).toBeNull();
    // o dono joga a vez dele antes de o bot disparar
    await settle(game, 'dono de volta');
    expect(await step(game, quietPolicy, mulberry32(1), 'dono joga')).toBe(true);
    await sleep(300);
    const after = game.server.eventLog.filter(
      (e) => e.event.type === 'cardPlayed' && e.event.seat === d,
    ).length;
    expect(after - before).toBe(1);
    expect(p.errors).toEqual([]);
    expect(live(game).flatMap((x) => x.errors)).toEqual([]);
    assertNoLeaks(game);
  });

  it('teto de reconexões: estourado o limite, a próxima queda vai direto para o bot', async () => {
    const game = await startedRec('truco-rec-cap');
    await dropSeat(game, 2);
    await rejoin(game, 2);
    await until(() => statusOf(game, 2) === 'connected', 'primeira reconexão');
    (game.players[2] as Player).gone = true;
    (game.players[2] as Player).room.reconnection.enabled = false;
    (game.players[2] as Player).room.connection.close();
    // janela de 5 s não abriu: o bot assume rápido
    await until(() => statusOf(game, 2) === 'bot', 'bot imediato', 1500);
  });

  describe('(j) vazamento no caminho de reconexão', () => {
    it('mão normal, com cobertas alheias no replay: nada vaza no estado completo, patches e replay', async () => {
      const game = await startedRec('truco-rec');
      // 1ª vaza com todos; depois o 2º a jogar na 2ª vaza cai e volta na vez dele
      await drive(game, () => logCount(game, 'trickDecided') >= 1, '1ª vaza');
      const q = ((pending(game) as number) + 1) % 4;
      await dropSeat(game, q);
      await drive(game, () => pending(game) === q, 'vez de q na 2ª vaza');
      const p = await rejoin(game, q);
      await until(() => (p.room.state as { phase: string }).phase === 'playing', 'estado completo');
      await settle(game, 'estado completo ao reconectar');
      await until(
        () => p.events.length >= 1 && p.events.at(-1)?.seq === game.server.eventLog.length,
        'replay completo',
      );
      const coveredByOthers = p.events.filter(
        (e) => e.event.type === 'cardPlayed' && e.event.covered === true && e.event.seat !== q,
      );
      expect(coveredByOthers.length).toBeGreaterThan(0);
      for (const e of coveredByOthers) {
        expect(JSON.stringify(e.event)).not.toMatch(/"(rank|suit)"/);
      }
      // q joga uma coberta própria e reconecta de novo: a identidade vem de privates.ownCovered
      expect(await step(game, quietPolicy, mulberry32(2), 'q joga')).toBe(true);
      await dropSeat(game, q);
      const p2 = await rejoin(game, q);
      await until(
        () => (p2.room.state as { phase: string }).phase === 'playing',
        'estado completo 2',
      );
      await settle(game, 'segunda reconexão');
      const mine = Object.values(
        (json(p2) as { privates: Record<string, { ownCovered: unknown[] }> }).privates,
      )[0];
      expect(mine?.ownCovered.length).toBe(1);
      await drive(game, () => logCount(game, 'handDecided') > 0, 'mão decidida');
      assertNoLeaks(game);
    });

    it('mão de ferro: o reconectado não recebe mão nem cartas às cegas alheias antes de jogadas', async () => {
      const game = await startedRec('truco-rec-ferro');
      expect(game.server.series?.match.hand.special).toBe('maoDeFerro');
      const q = ((pending(game) as number) + 3) % 4;
      await dropSeat(game, q);
      await drive(game, () => pending(game) === q, 'vez de q');
      const p = await rejoin(game, q);
      await until(() => (p.room.state as { phase: string }).phase === 'playing', 'estado completo');
      await settle(game, 'ferro: estado completo');
      const mine = Object.values(
        (json(p) as { privates: Record<string, { hand: unknown[] }> }).privates,
      )[0];
      expect(mine?.hand).toEqual([]);
      await drive(game, () => logCount(game, 'handDecided') > 0, 'mão de ferro decidida');
      assertNoLeaks(game);
    });

    it('mão de onze: quem decide vê as cartas do parceiro ao reconectar; o outro time não vê nada', async () => {
      const game = await startedRec('truco-rec-onze');
      expect(game.server.series?.match.hand.special).toBe('maoDeOnze');
      expect(game.server.series?.match.hand.phase).toBe('specialDecision');
      // 0 e 2 são a dupla com 11; 1 é do time adversário
      for (const s of [2, 1]) {
        await dropSeat(game, s);
        const p = await rejoin(game, s);
        await until(() => (p.room.state as { phase: string }).phase === 'playing', `estado ${s}`);
        await settle(game, `onze: assento ${s} reconectado`);
        const mine = Object.values(
          (json(p) as { privates: Record<string, { partnerCards: unknown[] }> }).privates,
        )[0];
        expect(mine?.partnerCards.length).toBe(s === 2 ? 3 : 0);
      }
      await drive(game, () => logCount(game, 'handDecided') > 0, 'mão de onze decidida');
      assertNoLeaks(game);
    });
  });
});
