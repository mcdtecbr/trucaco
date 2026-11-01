import {
  applySeriesAction,
  botAction,
  isSeriesOver,
  mulberry32,
  pendingSeat,
  publicEvent,
  startSeries,
  variantById,
} from '@trucaco/rules';
import type { PublicGameEvent, SeriesState } from '@trucaco/rules';
import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '../db/types';
import type { FinishedMatchInput, MatchRepository } from '../db/types';
import { JSON_LIMITS, assertFinishedMatch } from '../db/validation';
import { setLogSink } from '../logger';
import {
  MATCH_EVENTS_MAX,
  MATCH_EVENTS_MAX_BYTES,
  MatchRecorder,
  persistWithRetry,
} from './matchRecorder';

setLogSink(() => undefined);

const OPTIONS = {
  variant: 'paulista',
  format: 'bo3',
  ironHand: true,
  visibility: 'private',
} as const;
const USERS = new Map([
  [0, '11111111-1111-4111-8111-111111111111'],
  [1, '22222222-2222-4222-8222-222222222222'],
  [2, '33333333-3333-4333-8333-333333333333'],
  [3, '44444444-4444-4444-8444-444444444444'],
]);
const mk = (): MatchRecorder =>
  new MatchRecorder({ options: OPTIONS, roomCode: 'ABCDEFGH', seed: 5, startedAt: new Date(1000) });
const ev = (seq: number): { seq: number; at: number; event: PublicGameEvent } => ({
  seq,
  at: 1000 + seq,
  event: { type: 'betAccepted', seat: 1, value: 3 },
});
const finalize = (r: MatchRecorder): FinishedMatchInput =>
  r.finalize({
    status: 'finished',
    winnerTeam: 0,
    endReason: 'finished',
    endedAt: new Date(5000),
    users: USERS,
  })!;

describe('MatchRecorder', () => {
  it('grava eventos, jogos e jogadores; botFrom só a primeira vez', () => {
    const r = mk();
    r.addEvent(ev(1));
    r.addEvent({
      seq: 2,
      at: 1002,
      event: { type: 'gameDecided', winnerTeam: 1, scores: [3, 12] },
    });
    r.noteBot(2, 7);
    r.noteBot(2, 99);
    const input = finalize(r);
    expect(input.events).toHaveLength(2);
    expect(input.games).toEqual([{ game: 1, winnerTeam: 1, scores: [3, 12] }]);
    expect(input.players.map((p) => p.botFrom)).toEqual([null, null, 7, null]);
    expect(input.players[0]).toMatchObject({ seat: 0, team: 0, userId: USERS.get(0) });
    expect(input.options).toMatchObject({ ...OPTIONS, endReason: 'finished' });
    expect(() => assertFinishedMatch(input)).not.toThrow();
  });

  it('finalize é idempotente e fecha o recorder', () => {
    const r = mk();
    expect(finalize(r)).not.toBeNull();
    expect(
      r.finalize({
        status: 'cancelled',
        winnerTeam: null,
        endReason: 'cancelled',
        endedAt: new Date(),
        users: USERS,
      }),
    ).toBeNull();
    r.addEvent(ev(1));
    expect(r.eventCount).toBe(0);
  });

  it('teto de contagem: marca log truncado em vez de crescer sem limite', () => {
    const r = mk();
    for (let i = 1; i <= MATCH_EVENTS_MAX + 25; i++) r.addEvent(ev(i));
    expect(r.eventCount).toBe(MATCH_EVENTS_MAX);
    expect(r.truncated).toBe(true);
    const input = finalize(r);
    expect(input.options).toMatchObject({ logTruncated: true, eventsDropped: 25 });
    // mesmo no teto, cabe no CHECK do banco
    expect(() => assertFinishedMatch(input)).not.toThrow();
  });

  it('teto de bytes: eventos grandes não passam do orçamento (que fica sob o CHECK de 2 MiB)', () => {
    const r = mk();
    const fat = 'x'.repeat(5000);
    for (let i = 1; i <= 1000; i++) {
      r.addEvent({
        seq: i,
        at: i,
        event: { type: 'betAccepted', seat: 1, value: 3, pad: fat } as unknown as PublicGameEvent,
      });
    }
    expect(r.truncated).toBe(true);
    const input = finalize(r);
    const bytes = Buffer.byteLength(JSON.stringify(input.events));
    expect(bytes).toBeLessThanOrEqual(MATCH_EVENTS_MAX_BYTES);
    expect(MATCH_EVENTS_MAX_BYTES).toBeLessThan(JSON_LIMITS.events);
    expect(() => assertFinishedMatch(input)).not.toThrow();
  });

  it('bo3 real (bots até o fim): tamanho medido cabe com folga enorme e sem truncar', () => {
    const rng = mulberry32(42);
    let s: SeriesState;
    const r = mk();
    let seq = 0;
    const started = startSeries({
      variant: variantById('paulista'),
      config: { format: 'bo3', ironHand: true },
      pe: 0,
      rng,
    });
    s = started.state;
    for (const e of started.events) r.addEvent({ seq: ++seq, at: seq, event: publicEvent(e) });
    let guard = 0;
    while (!isSeriesOver(s) && guard++ < 20_000) {
      const seat = pendingSeat(s);
      if (seat === null) break;
      const action = botAction(s, seat, rng);
      if (action === null) break;
      const res = applySeriesAction(s, action, rng);
      if (!res.ok) break;
      s = res.state;
      for (const e of res.events) r.addEvent({ seq: ++seq, at: seq, event: publicEvent(e) });
    }
    expect(isSeriesOver(s)).toBe(true);
    expect(r.truncated).toBe(false);
    const input = finalize(r);
    const bytes = Buffer.byteLength(JSON.stringify(input.events));
    // folga mínima de 5x sobre o orçamento do recorder e de 10x sobre o CHECK
    expect(bytes * 5).toBeLessThan(MATCH_EVENTS_MAX_BYTES);
    expect(r.eventCount * 3).toBeLessThan(MATCH_EVENTS_MAX);
    expect(() => assertFinishedMatch(input)).not.toThrow();
  });

  it('save é idempotente: duas chamadas, uma gravação', async () => {
    const r = mk();
    const input = finalize(r);
    let calls = 0;
    const repo: MatchRepository = {
      saveMatch: async () => {
        calls++;
        return 'id';
      },
      listForUser: async () => ({ items: [], nextCursor: null }),
    };
    const [a, b] = await Promise.all([r.save(repo, input, 'room'), r.save(repo, input, 'room')]);
    expect([a, b]).toEqual([true, true]);
    expect(calls).toBe(1);
  });
});

describe('persistWithRetry', () => {
  const input = finalize(mk());
  const repoFailing = (err: Error, counter: { n: number }): MatchRepository => ({
    saveMatch: async () => {
      counter.n++;
      throw err;
    },
    listForUser: async () => ({ items: [], nextCursor: null }),
  });

  it('nunca lança: devolve false depois de tentativas limitadas', async () => {
    const c = { n: 0 };
    expect(await persistWithRetry(repoFailing(new Error('x'), c), input, 'r', 3, 1)).toBe(false);
    expect(c.n).toBe(3);
  });

  it('entrada recusada pelo banco não é repetida', async () => {
    const c = { n: 0 };
    expect(
      await persistWithRetry(repoFailing(new InvalidInputError('grande'), c), input, 'r', 3, 1),
    ).toBe(false);
    expect(c.n).toBe(1);
  });
});
