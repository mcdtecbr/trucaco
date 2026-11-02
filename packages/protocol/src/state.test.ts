import { describe, expect, it } from 'vitest';
import { RANKS, SUITS, parseLegalAction } from './index';
import type { HandSnapshot } from './index';

describe('parseLegalAction', () => {
  it('aceita todas as cartas em play e playCovered', () => {
    for (const rank of RANKS) {
      for (const suit of SUITS) {
        expect(parseLegalAction(`play:${rank}${suit}`)).toEqual({
          kind: 'play',
          card: { rank, suit },
        });
        expect(parseLegalAction(`playCovered:${rank}${suit}`)).toEqual({
          kind: 'playCovered',
          card: { rank, suit },
        });
      }
    }
  });

  it('aceita playBlind 0..2 e as ações simples', () => {
    expect(parseLegalAction('playBlind:2')).toEqual({ kind: 'playBlind', index: 2 });
    for (const k of ['bet', 'accept', 'run', 'specialPlay', 'specialRun']) {
      expect(parseLegalAction(k)).toEqual({ kind: k });
    }
  });

  it('rejeita formatos inválidos', () => {
    const bad = [
      '',
      'play',
      'play:',
      'play:3',
      'play:3paus ',
      ' play:3paus',
      'play:3Paus',
      'play:1paus',
      'play:10paus',
      'play:3pausx',
      'Play:3paus',
      'playBlind:3',
      'playBlind:-1',
      'playBlind:01',
      'playBlind:',
      'bet:1',
      'Bet',
      'accept ',
      'play:3paus:extra',
      'play:3paus\n',
    ];
    for (const id of bad) expect([id, parseLegalAction(id)]).toEqual([id, null]);
  });

  it('rejeita injeção e não-strings', () => {
    const bad: unknown[] = [
      '__proto__',
      'constructor',
      'toString',
      'play:__proto__',
      'play:3<script>',
      "play:3paus'; DROP TABLE",
      null,
      undefined,
      3,
      {},
      ['bet'],
    ];
    for (const id of bad) expect(parseLegalAction(id)).toBeNull();
  });
});

describe('HandSnapshot: campos de manilha e aposta (aditivos)', () => {
  it('aceita manilha Paulista/Mineiro e valores de aposta', () => {
    const base = {
      viraRank: '',
      viraSuit: '',
      special: 'normal',
      specialTeam: -1,
      phase: 'playing',
      turn: 0,
      value: 1,
      level: -1,
      tricks: [],
      current: [],
    };
    const paulista: HandSnapshot = {
      ...base,
      manilhaRank: '3',
      manilhaCards: [],
      nextBetValue: 3,
      pendingValue: 0,
    };
    const mineiro: HandSnapshot = {
      ...base,
      manilhaRank: '',
      manilhaCards: ['4paus', '7copas', 'Aespadas', '7ouros'],
      nextBetValue: 4,
      pendingValue: 0,
    };
    expect(paulista.nextBetValue).toBe(3);
    expect(mineiro.manilhaCards).toHaveLength(4);
  });
});
