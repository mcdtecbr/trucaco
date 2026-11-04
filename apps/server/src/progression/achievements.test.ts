import { randomUUID } from 'node:crypto';
import {
  PAULISTA,
  applySeriesAction,
  botAction,
  isManilha,
  mulberry32,
  pendingSeat,
  publicEvent,
  startSeries,
} from '@trucaco/rules';
import type { Card, GameEvent, PublicGameEvent, SeriesState } from '@trucaco/rules';
import { describe, expect, it } from 'vitest';
import type { FinishedMatchInput, JsonValue, MatchEventLogEntry } from '../db/types';
import {
  DEFAULT_PROGRESSION_POLICY,
  MIN_HANDS_FOR_PROGRESSION,
  MIN_MATCH_DURATION_MS,
  NO_EFFORT_POLICY,
  countHands,
  evaluateMatch,
  isEligibleForProgression as isEligibleWith,
  isZap,
} from './achievements';
import type { ProgressionPolicy } from './achievements';
import type { EvaluateInput, PartnerWins, PlayerEvaluation } from './achievements';

const IDS = [randomUUID(), randomUUID(), randomUUID(), randomUUID()] as const;

/** Monta o log de uma partida a mão: `ev` numera, `hand` abre uma mão e registra a vira em `deals`. */
class Log {
  seq = 0;
  readonly events: MatchEventLogEntry[] = [];
  readonly deals: JsonValue[] = [];
  ev(event: PublicGameEvent): void {
    this.events.push({ seq: ++this.seq, at: 0, event: event as unknown as JsonValue });
  }
  hand(
    vira: Card | null,
    scores: readonly [number, number] = [0, 0],
    special: 'normal' | 'maoDeOnze' | 'maoDeFerro' = 'normal',
  ): void {
    this.ev({ type: 'handStarted', handNumber: 1, pe: 0, scores, special });
    this.deals.push({
      seq: this.seq,
      vira: vira === null ? null : { rank: vira.rank, suit: vira.suit },
    });
  }
  play(seat: number, card: Card | null, covered = false): void {
    this.ev({ type: 'cardPlayed', seat, card, covered, blind: false });
  }
  trick(winnerSeat: number | null): void {
    this.ev({
      type: 'trickDecided',
      index: 0,
      winnerSeat,
      winnerTeam: winnerSeat === null ? null : ((winnerSeat % 2) as 0 | 1),
    });
  }
  handEnd(
    winnerTeam: 0 | 1 | null,
    points: number,
    scores: readonly [number, number],
    reason: 'tricks' | 'betRun' | 'specialRun' | 'draw' = 'tricks',
  ): void {
    this.ev({ type: 'handDecided', winnerTeam, points, reason, scores });
  }
  gameEnd(winnerTeam: 0 | 1, scores: readonly [number, number]): void {
    this.ev({ type: 'gameDecided', winnerTeam, scores });
  }
}

const C = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

function match(log: Log, over: Partial<FinishedMatchInput> = {}): FinishedMatchInput {
  const endedAt = new Date('2026-11-04T15:00:00Z');
  return {
    variant: 'paulista',
    format: 'single',
    ironHand: true,
    visibility: 'public',
    roomCode: 'ABCD2345',
    seed: 1,
    options: {},
    events: log.events,
    deals: log.deals,
    winnerTeam: 0,
    games: [{ game: 1, winnerTeam: 0, scores: [12, 3] }],
    status: 'finished',
    startedAt: new Date(endedAt.getTime() - 60_000),
    endedAt,
    players: IDS.map((userId, seat) => ({
      seat,
      userId,
      team: (seat % 2) as 0 | 1,
      botFrom: null,
    })),
    ...over,
  };
}

function run(
  m: FinishedMatchInput,
  extra: Partial<Omit<EvaluateInput, 'match'>> = {},
): PlayerEvaluation[] {
  return evaluateMatch({
    match: m,
    signalsBySeat: new Map(),
    partnerWins: new Map(),
    policy: NO_EFFORT_POLICY,
    ...extra,
  });
}

/** Progresso por conquista de um jogador (somando `progressDelta`; `progressSet` entra como está). */
const got = (e: PlayerEvaluation | undefined): Record<string, number> =>
  Object.fromEntries(
    (e?.achievements ?? []).map((a) => [a.achievementId, a.progressDelta ?? a.progressSet ?? 0]),
  );

const empty = new Log();
const isEligibleForProgression = (
  m: FinishedMatchInput,
  policy: ProgressionPolicy = NO_EFFORT_POLICY,
): boolean => isEligibleWith(m, policy);

/** Log com `n` mãos decididas. */
function logWithHands(n: number): Log {
  const l = new Log();
  for (let i = 0; i < n; i++) {
    l.hand(null);
    l.handEnd(0, 1, [1, 0]);
  }
  return l;
}

describe('isEligibleForProgression', () => {
  it('aceita 4 humanos distintos, sem bot, partida terminada', () => {
    expect(isEligibleForProgression(match(empty))).toBe(true);
  });

  it('recusa cancelada, bot de ausência, bot de vaga, conta repetida e lista incompleta', () => {
    const m = match(empty);
    expect(isEligibleForProgression({ ...m, status: 'cancelled', winnerTeam: null })).toBe(false);
    expect(isEligibleForProgression({ ...m, winnerTeam: null })).toBe(false);
    const players = [...m.players];
    expect(
      isEligibleForProgression({
        ...m,
        players: players.map((p) => (p.seat === 3 ? { ...p, botFrom: 40 } : p)),
      }),
    ).toBe(false);
    expect(
      isEligibleForProgression({
        ...m,
        players: players.map((p) => (p.seat === 3 ? { ...p, userId: null } : p)),
      }),
    ).toBe(false);
    expect(
      isEligibleForProgression({
        ...m,
        players: players.map((p) => (p.seat === 3 ? { ...p, userId: IDS[1] } : p)),
      }),
    ).toBe(false);
    expect(isEligibleForProgression({ ...m, players: players.slice(0, 3) })).toBe(false);
  });

  it('anti-farm: exige o mínimo de mãos e a duração mínima (padrões)', () => {
    const d = DEFAULT_PROGRESSION_POLICY;
    const long = (m: FinishedMatchInput): FinishedMatchInput => ({
      ...m,
      startedAt: new Date(m.endedAt.getTime() - MIN_MATCH_DURATION_MS),
    });
    const ok = long(match(logWithHands(MIN_HANDS_FOR_PROGRESSION)));
    expect(countHands(ok)).toBe(MIN_HANDS_FOR_PROGRESSION);
    expect(isEligibleForProgression(ok, d)).toBe(true);
    // mãos a menos
    expect(
      isEligibleForProgression(long(match(logWithHands(MIN_HANDS_FOR_PROGRESSION - 1))), d),
    ).toBe(false);
    expect(isEligibleForProgression(long(match(empty)), d)).toBe(false);
    // duração a menos (1 ms)
    expect(
      isEligibleForProgression(
        { ...ok, startedAt: new Date(ok.endedAt.getTime() - MIN_MATCH_DURATION_MS + 1) },
        d,
      ),
    ).toBe(false);
    // log truncado: não dá para contar mãos, só a duração vale
    expect(
      isEligibleForProgression({ ...long(match(empty)), options: { logTruncated: true } }, d),
    ).toBe(true);
    // e a avaliação respeita a política padrão
    expect(run(match(logWithHands(1)), { policy: d })).toEqual([]);
    expect(run(ok, { policy: d })).toHaveLength(4);
  });

  it('partida inelegível não avalia ninguém', () => {
    expect(run(match(empty, { status: 'cancelled', winnerTeam: null }))).toEqual([]);
  });
});

describe('estatísticas, primeira_vitoria e maratona', () => {
  it('todos jogam (maratona); só a dupla vencedora vence (primeira_vitoria)', () => {
    const out = run(match(empty));
    expect(out.map((e) => [e.seat, e.won])).toEqual([
      [0, true],
      [1, false],
      [2, true],
      [3, false],
    ]);
    expect(got(out[0])).toEqual({ primeira_vitoria: 1, maratona: 1 });
    expect(got(out[1])).toEqual({ maratona: 1 });
    expect(out[0]?.counters).toMatchObject({ played: 1, won: 1 });
    expect(out[1]?.counters).toMatchObject({ played: 1, won: 0 });
    expect(out[0]?.variant).toBe('paulista');
  });
});

describe('zap_na_mao', () => {
  it('conta a vaza vencida com o zap (manilha de paus), só para quem o jogou', () => {
    const log = new Log();
    // vira 4 de ouros: manilha 5; zap = 5 de paus.
    log.hand(C('4', 'ouros'));
    log.play(0, C('5', 'paus'));
    log.play(1, C('3', 'copas'));
    log.play(2, C('A', 'ouros'));
    log.play(3, C('K', 'copas'));
    log.trick(0);
    const out = run(match(log));
    expect(got(out[0]).zap_na_mao).toBe(1);
    expect(got(out[2]).zap_na_mao).toBeUndefined(); // parceiro não jogou o zap
    expect(got(out[1]).zap_na_mao).toBeUndefined();
  });

  it('manilha que não é de paus, zap coberto e vaza perdida não contam', () => {
    const log = new Log();
    log.hand(C('4', 'ouros'));
    log.play(0, C('5', 'copas')); // manilha, mas não o zap
    log.play(1, C('3', 'copas'));
    log.trick(0);
    log.play(0, C('5', 'paus'), true); // coberta: a identidade some do log público
    log.play(1, null, true);
    log.trick(null);
    log.play(2, C('5', 'paus'));
    log.play(3, C('5', 'paus'));
    log.trick(null); // empate: sem vencedor
    expect(got(run(match(log))[0]).zap_na_mao).toBeUndefined();
  });

  it('soma várias vazas e usa a vira de cada mão', () => {
    const log = new Log();
    log.hand(C('4', 'ouros'));
    log.play(1, C('5', 'paus'));
    log.trick(1);
    log.play(1, C('5', 'paus'));
    log.trick(1);
    // Outra mão, vira 7: manilha Q; o 5 de paus deixa de ser zap.
    log.hand(C('7', 'copas'));
    log.play(1, C('5', 'paus'));
    log.trick(1);
    log.play(1, C('Q', 'paus'));
    log.trick(1);
    expect(got(run(match(log))[1]).zap_na_mao).toBe(3);
  });

  it('Mineiro: o zap é o 4 de paus (manilha fixa), sem depender de vira', () => {
    const log = new Log();
    log.hand(null);
    log.play(2, C('4', 'paus'));
    log.trick(2);
    log.play(2, C('7', 'copas')); // segunda manilha, não é o zap
    log.trick(2);
    expect(got(run(match(log, { variant: 'mineiro' }))[2]).zap_na_mao).toBe(1);
  });

  it('isZap coerente com o motor (nenhuma outra carta de paus vira zap)', () => {
    const vira = C('4', 'ouros');
    const zaps = (['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3'] as const)
      .flatMap((rank) => (['paus', 'copas', 'espadas', 'ouros'] as const).map((s) => C(rank, s)))
      .filter((c) => isZap(PAULISTA, vira, c));
    expect(zaps).toEqual([C('5', 'paus')]);
    expect(isManilha(PAULISTA, vira, C('5', 'paus'))).toBe(true);
  });
});

describe('doze_na_mesa', () => {
  it('mão de 12 vencida nas vazas conta para a dupla vencedora (os dois jogadores)', () => {
    const log = new Log();
    log.hand(C('4', 'ouros'));
    log.handEnd(0, 12, [12, 0]);
    const out = run(match(log));
    expect(got(out[0]).doze_na_mesa).toBe(1);
    expect(got(out[2]).doze_na_mesa).toBe(1);
    expect(got(out[1]).doze_na_mesa).toBeUndefined();
  });

  it('corrida (vale 9), empate e mão de 9 não contam', () => {
    const log = new Log();
    log.hand(C('4', 'ouros'));
    log.handEnd(0, 9, [9, 0], 'betRun');
    log.hand(C('4', 'ouros'), [9, 0]);
    log.handEnd(0, 12, [12, 0], 'betRun');
    log.hand(C('4', 'ouros'));
    log.handEnd(null, 0, [9, 0], 'draw');
    expect(got(run(match(log))[0]).doze_na_mesa).toBeUndefined();
  });
});

describe('mao_de_ferro', () => {
  it('vencer uma mão de ferro conta para a dupla; mão normal e de onze não', () => {
    const log = new Log();
    log.hand(C('4', 'ouros'), [11, 11], 'maoDeFerro');
    log.handEnd(1, 1, [11, 12]);
    log.hand(C('4', 'ouros'), [11, 3], 'maoDeOnze');
    log.handEnd(0, 3, [12, 3]);
    const out = run(match(log, { winnerTeam: 1 }));
    expect(got(out[1]).mao_de_ferro).toBe(1);
    expect(got(out[3]).mao_de_ferro).toBe(1);
    expect(got(out[0]).mao_de_ferro).toBeUndefined();
  });

  it('o "special" de uma mão não vaza para a seguinte', () => {
    const log = new Log();
    log.hand(C('4', 'ouros'), [11, 11], 'maoDeFerro');
    log.handEnd(1, 1, [11, 12]);
    log.hand(C('4', 'ouros'), [0, 0]);
    log.handEnd(1, 1, [0, 1]);
    expect(got(run(match(log, { winnerTeam: 1 }))[1]).mao_de_ferro).toBe(1);
  });
});

describe('virada', () => {
  it('vencer o jogo estando 9 ou mais pontos atrás', () => {
    const log = new Log();
    log.hand(C('4', 'ouros'));
    log.handEnd(1, 9, [0, 9]);
    log.hand(C('4', 'ouros'), [0, 9]);
    log.handEnd(0, 6, [6, 9]);
    log.hand(C('4', 'ouros'), [6, 9]);
    log.handEnd(0, 6, [12, 9]);
    log.gameEnd(0, [12, 9]);
    const out = run(match(log));
    expect(got(out[0]).virada).toBe(1);
    expect(got(out[2]).virada).toBe(1);
    expect(got(out[1]).virada).toBeUndefined();
  });

  it('8 pontos de desvantagem não basta; liderar o tempo todo não conta', () => {
    const log = new Log();
    log.hand(C('4', 'ouros'));
    log.handEnd(1, 8, [0, 8]);
    log.hand(C('4', 'ouros'), [0, 8]);
    log.handEnd(0, 12, [12, 8]);
    log.gameEnd(0, [12, 8]);
    expect(got(run(match(log))[0]).virada).toBeUndefined();
  });

  it('a desvantagem de um jogo não passa para o próximo (bo3)', () => {
    const log = new Log();
    log.hand(C('4', 'ouros'));
    log.handEnd(0, 9, [9, 0]);
    log.hand(C('4', 'ouros'), [9, 0]);
    log.handEnd(1, 9, [9, 9]);
    log.hand(C('4', 'ouros'), [9, 9]);
    log.handEnd(1, 3, [9, 12]);
    log.gameEnd(1, [9, 12]); // dupla 1 ganhou, mas só esteve 9 atrás? não: dupla 1 estava 9 atrás
    log.hand(C('4', 'ouros'));
    log.handEnd(0, 12, [12, 0]);
    log.gameEnd(0, [12, 0]);
    const out = run(match(log, { format: 'bo3' }));
    // Jogo 1: dupla 1 chegou a estar 9 atrás (0 x 9) e venceu -> virada da dupla 1.
    expect(got(out[1]).virada).toBe(1);
    // Jogo 2: dupla 0 venceu sem desvantagem herdada.
    expect(got(out[0]).virada).toBeUndefined();
  });

  it('placar inicial forçado (handStarted) também conta como desvantagem', () => {
    const log = new Log();
    log.hand(C('4', 'ouros'), [0, 10]);
    log.handEnd(0, 12, [12, 10]);
    log.gameEnd(0, [12, 10]);
    expect(got(run(match(log))[0]).virada).toBe(1);
  });
});

describe('serie_perfeita', () => {
  const games = (...w: (0 | 1)[]): JsonValue[] =>
    w.map((winnerTeam, i) => ({ game: i + 1, winnerTeam, scores: [12, 0] }));

  it('bo3 vencida por 2 a 0', () => {
    const out = run(match(empty, { format: 'bo3', games: games(0, 0) }));
    expect(got(out[0]).serie_perfeita).toBe(1);
    expect(got(out[2]).serie_perfeita).toBe(1);
    expect(got(out[1]).serie_perfeita).toBeUndefined();
  });

  it('2 a 1 e partida única não contam', () => {
    expect(
      got(run(match(empty, { format: 'bo3', games: games(1, 0, 0) }))[0]).serie_perfeita,
    ).toBeUndefined();
    expect(got(run(match(empty, { games: games(0) }))[0]).serie_perfeita).toBeUndefined();
  });
});

describe('dupla_afinada', () => {
  const pw = (current: number, best: number): PartnerWins => ({ current, best });

  it('define o progresso com as vitórias com o parceiro quando passa do melhor já gravado', () => {
    const out = run(match(empty), {
      partnerWins: new Map([
        [IDS[0], pw(6, 5)],
        [IDS[2], pw(6, 6)],
      ]),
    });
    expect(out[0]?.achievements.find((a) => a.achievementId === 'dupla_afinada')).toEqual({
      achievementId: 'dupla_afinada',
      progressSet: 6,
    });
    expect(got(out[2]).dupla_afinada).toBeUndefined(); // não supera o melhor
  });

  it('derrota e falta de dado não avançam', () => {
    const out = run(match(empty), { partnerWins: new Map([[IDS[1], pw(9, 0)]]) });
    expect(got(out[1]).dupla_afinada).toBeUndefined();
    expect(got(out[0]).dupla_afinada).toBeUndefined();
  });
});

describe('sinaleiro e contadores de missão', () => {
  it('sinaleiro: +1 por partida só para quem usou sinal; contador de missão traz o total', () => {
    const out = run(match(empty), {
      signalsBySeat: new Map([
        [1, 3],
        [2, 0],
      ]),
    });
    expect(got(out[1]).sinaleiro).toBe(1);
    expect(got(out[2]).sinaleiro).toBeUndefined();
    expect(got(out[0]).sinaleiro).toBeUndefined();
    expect(out[1]?.counters.signals).toBe(3);
    expect(out[0]?.counters.signals).toBe(0);
  });

  it('pedidos e aceites de aposta por assento', () => {
    const log = new Log();
    log.hand(C('4', 'ouros'));
    log.ev({ type: 'betCalled', seat: 0, toLevel: 1, value: 3 });
    log.ev({ type: 'betAccepted', seat: 1, value: 3 });
    log.ev({ type: 'betRaised', seat: 1, toLevel: 2, value: 6 });
    log.ev({ type: 'betAccepted', seat: 0, value: 6 });
    log.ev({ type: 'betCalled', seat: 0, toLevel: 3, value: 9 });
    log.ev({ type: 'betRun', seat: 1, winnerTeam: 0, points: 6 });
    const out = run(match(log));
    expect(out[0]?.counters).toMatchObject({ betsCalled: 2, betsAccepted: 1 });
    // seat 1: aceitou e depois aumentou; o aumento conta como aceite do anterior e como pedido.
    expect(out[1]?.counters).toMatchObject({ betsCalled: 1, betsAccepted: 2 });
    expect(out[2]?.counters).toMatchObject({ betsCalled: 0, betsAccepted: 0 });
  });

  it('eventos malformados no log são ignorados sem lançar', () => {
    const log = new Log();
    log.events.push({ seq: 1, at: 0, event: 'lixo' }, { seq: 2, at: 0, event: { type: 7 } });
    expect(() => run(match(log))).not.toThrow();
    expect(run(match(log))).toHaveLength(4);
  });
});

describe('partida real do motor (bots), consistência ponta a ponta', () => {
  function simulate(seed: number): { input: FinishedMatchInput; zapsByWinner: number } {
    const rng = mulberry32(seed);
    const started = startSeries({
      variant: PAULISTA,
      config: { format: 'single', ironHand: true },
      pe: 0,
      rng,
    });
    let series: SeriesState = started.state;
    const log = new Log();
    const feed = (events: readonly GameEvent[]): void => {
      for (const e of events) {
        log.ev(publicEvent(e));
        if (e.type === 'handStarted') {
          const v = series.match.hand.vira;
          log.deals[log.deals.length] = {
            seq: log.seq,
            vira: v === null ? null : { rank: v.rank, suit: v.suit },
          };
        }
      }
    };
    feed(started.events);
    let guard = 0;
    while (series.winner === null && guard++ < 5000) {
      const seat = pendingSeat(series);
      if (seat === null) break;
      const action = botAction(series, seat, rng);
      if (action === null) break;
      const r = applySeriesAction(series, action, rng);
      if (!r.ok) break;
      series = r.state;
      feed(r.events);
    }
    expect(series.winner).not.toBeNull();
    // Conta independente: vazas vencidas com o zap, direto dos eventos do motor.
    let zaps = 0;
    const cards = new Map<number, Card>();
    let vira: Card | null = null;
    for (const entry of log.events) {
      const e = entry.event as unknown as PublicGameEvent;
      if (e.type === 'handStarted')
        vira = (
          log.deals.find((d) => (d as { seq: number }).seq === entry.seq) as { vira: Card | null }
        ).vira;
      if (e.type === 'cardPlayed' && e.card !== null) cards.set(e.seat, e.card);
      if (e.type === 'trickDecided') {
        const c = e.winnerSeat === null ? undefined : cards.get(e.winnerSeat);
        if (c !== undefined && isZap(PAULISTA, vira, c)) zaps++;
        cards.clear();
      }
    }
    return { input: match(log, { winnerTeam: series.winner }), zapsByWinner: zaps };
  }

  it('algumas sementes: 2 vencedores, 4 maratonas, zaps somam o total contado à parte', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { input, zapsByWinner } = simulate(seed);
      const out = run(input);
      expect(out.filter((e) => e.won)).toHaveLength(2);
      for (const e of out) expect(got(e).maratona).toBe(1);
      const zapSum = out.reduce((n, e) => n + (got(e).zap_na_mao ?? 0), 0);
      expect(zapSum).toBe(zapsByWinner);
    }
  });
});
