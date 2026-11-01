/**
 * Testes de sala da `TrucoRoom` com `@colyseus/testing` (4 clientes reais por WebSocket).
 * UM `Server` por arquivo (o matchmaker é global). Variações de configuração do SERVIDOR (semente,
 * prazo, placar inicial) entram como nomes de sala extras; o cliente nunca as controla.
 */
import type { Room } from '@colyseus/core';
import { ColyseusTestServer, boot } from '@colyseus/testing';
import { MAX_MESSAGE_BYTES } from '@trucaco/protocol';
import type { ErrorCode, RoomOptions } from '@trucaco/protocol';
import { mulberry32 } from '@trucaco/rules';
import type { Card, SeriesState } from '@trucaco/rules';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eventViolations, leakViolations } from '../game/leakdetect';
import { setLogSink } from '../logger';
import { buildColyseusServer } from '../server';
import { defineTrucoRoom, devAuth } from './TrucoRoom';
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
}

interface Game {
  server: TrucoRoom;
  players: Player[];
  /** Violações de vazamento vistas em QUALQUER patch ou evento recebido por qualquer cliente. */
  leaks: string[];
  patches: number;
}

/** Converte ArraySchema do cliente em array simples. */
const plain = <T>(a: unknown): T[] => (a as { toJSON(): T[] }).toJSON();

const json = (p: Player): unknown => (p.room.state as { toJSON(): unknown }).toJSON();

async function createGame(name: string, options: RoomOptions): Promise<Game> {
  const server = await t.createRoom<TrucoRoom>(name, options);
  const game: Game = { server, players: [], leaks: [], patches: 0 };
  for (let seat = 0; seat < 4; seat++) {
    const room = await t.connectTo<Room>(server as unknown as Room, {
      userId: `user-${seat}`,
      nickname: `Jogador ${seat}`,
    });
    const p: Player = { seat, room, events: [], errors: [], turnTimers: [] };
    room.onMessage('event', (m: Received) => {
      p.events.push(m);
      game.leaks.push(...eventViolations(m.event, seat, `evento seq ${m.seq} assento ${seat}`));
    });
    room.onMessage('error', (m: { code: ErrorCode }) => p.errors.push(m.code));
    room.onMessage('turnTimer', (m: { seat: number; deadlineAt: number }) => p.turnTimers.push(m));
    room.onStateChange(() => {
      game.patches++;
      const series = server.series;
      if (series === null) return;
      // A CADA patch recebido por ESTE cliente: nada proibido, só o bloco privado dele.
      game.leaks.push(
        ...leakViolations(json(p), series, seat, `patch ${game.patches} assento ${seat}`, {
          exact: false,
        }),
      );
    });
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
    bad = game.players.flatMap((p) => leakViolations(json(p), series, p.seat, label));
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
    await sleep(60);
    expect(p.errors).toEqual([]);
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
