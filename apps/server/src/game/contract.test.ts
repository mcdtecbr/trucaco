import { ERROR_CODES } from '@trucaco/protocol';
import type { ErrorCode, PublicGameEvent as ProtocolEvent } from '@trucaco/protocol';
import { publicEvent } from '@trucaco/rules';
import type { GameEvent, PublicGameEvent as RulesEvent, RuleErrorCode } from '@trucaco/rules';
import { describe, expect, it } from 'vitest';

// Teste de tipo: cada direção de atribuição deve compilar (o `tsc` do typecheck acusa divergência).
type Assert<T extends true> = T;
type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export type RuleCodesCovered = Assert<Mutual<Extract<ErrorCode, RuleErrorCode>, RuleErrorCode>>;
export type EventsMirrored = Assert<Mutual<ProtocolEvent, RulesEvent>>;

/** Mapa exaustivo: o compilador obriga a listar todos os códigos do motor. */
const RULE_CODES: Record<RuleErrorCode, true> = {
  INVALID_SEAT: true,
  HAND_FINISHED: true,
  NOT_YOUR_TURN: true,
  CARD_NOT_IN_HAND: true,
  COVERED_NOT_ALLOWED: true,
  BLIND_ONLY: true,
  NOT_BLIND_HAND: true,
  BET_NOT_ALLOWED: true,
  BET_PENDING: true,
  NO_PENDING_BET: true,
  SPECIAL_DECISION_PENDING: true,
  NO_SPECIAL_DECISION: true,
  GAME_FINISHED: true,
  SERIES_FINISHED: true,
};

/** Um evento de cada variante de `GameEvent` (o `Record` exaustivo garante a cobertura). */
const EVENTS: Record<GameEvent['type'], GameEvent> = {
  gameStarted: { type: 'gameStarted', gameNumber: 1 },
  handStarted: { type: 'handStarted', handNumber: 1, pe: 0, scores: [0, 0], special: 'normal' },
  cardPlayed: {
    type: 'cardPlayed',
    seat: 1,
    card: { rank: '3', suit: 'paus' },
    covered: false,
    blind: false,
  },
  trickDecided: { type: 'trickDecided', index: 0, winnerSeat: 1, winnerTeam: 1 },
  betCalled: { type: 'betCalled', seat: 0, toLevel: 0, value: 3 },
  betAccepted: { type: 'betAccepted', seat: 1, value: 3 },
  betRaised: { type: 'betRaised', seat: 1, toLevel: 1, value: 6 },
  betRun: { type: 'betRun', seat: 1, winnerTeam: 0, points: 1 },
  specialDecided: { type: 'specialDecided', seat: 0, decision: 'play' },
  handDecided: {
    type: 'handDecided',
    winnerTeam: 0,
    points: 2,
    reason: 'tricks',
    scores: [2, 0],
  },
  gameDecided: { type: 'gameDecided', winnerTeam: 0, scores: [12, 3] },
  seriesDecided: { type: 'seriesDecided', winnerTeam: 0, games: [2, 1] },
  seriesCancelled: { type: 'seriesCancelled' },
};

describe('contrato protocol <-> rules', () => {
  it('ErrorCode cobre todos os RuleErrorCode do motor', () => {
    for (const code of Object.keys(RULE_CODES)) {
      expect(ERROR_CODES as readonly string[]).toContain(code);
    }
  });

  it('os códigos do motor são os primeiros do protocolo, na mesma ordem', () => {
    expect(ERROR_CODES.slice(0, Object.keys(RULE_CODES).length)).toEqual(Object.keys(RULE_CODES));
  });

  it('publicEvent compila e preserva valores para todas as variantes de GameEvent', () => {
    for (const ev of Object.values(EVENTS)) {
      const e: ProtocolEvent = publicEvent(ev, 0);
      expect(e.type).toBe(ev.type);
      if (ev.type !== 'cardPlayed') expect(e).toEqual(ev);
    }
  });

  it('carta coberta perde a identidade para os outros e fica para o dono', () => {
    const covered: GameEvent = {
      type: 'cardPlayed',
      seat: 1,
      card: { rank: '3', suit: 'paus' },
      covered: true,
      blind: false,
    };
    const other: ProtocolEvent = publicEvent(covered, 0);
    const owner: ProtocolEvent = publicEvent(covered, 1);
    expect(other).toMatchObject({ card: null, covered: true });
    expect(owner).toMatchObject({ card: { rank: '3', suit: 'paus' } });
  });
});
