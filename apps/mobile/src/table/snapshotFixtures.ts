/** Fábrica de snapshots (`room.state.toJSON()`) para testes de projeção, controlador e telas. */
import type { CardSnapshot, TableStateSnapshot } from '@trucaco/protocol';

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : DeepPartial<T[K]>;
};

export const NAMES = ['Ana', 'Bia', 'Caio', 'Davi'] as const;

export function player(seat: number, over: Record<string, unknown> = {}) {
  return {
    seat,
    nickname: NAMES[seat] ?? '',
    avatar: '{}',
    status: 'connected',
    handSize: 3,
    isBot: false,
    ...over,
  };
}

export function snapshot(
  over: DeepPartial<Omit<TableStateSnapshot, 'privates' | 'players'>> & {
    players?: readonly Record<string, unknown>[];
    privates?: Record<string, unknown>;
  } = {},
): Record<string, unknown> {
  const { players, privates, hand, options, series, game, ...rest } = over;
  return {
    roomCode: 'ABCDEFGH',
    options: {
      variant: 'paulista',
      format: 'single',
      ironHand: true,
      visibility: 'private',
      ...options,
    },
    phase: 'playing',
    players: players ?? [0, 1, 2, 3].map((i) => player(i)),
    series: { format: 'single', games: [0, 0], gameNumber: 1, winnerTeam: -1, ...series },
    game: { scores: [0, 0], handNumber: 1, pe: 0, ...game },
    hand: {
      viraRank: '5',
      viraSuit: 'copas',
      manilhaRank: '6',
      manilhaCards: [],
      nextBetValue: 3,
      pendingValue: 0,
      special: 'normal',
      specialTeam: -1,
      phase: 'playing',
      turn: 0,
      value: 1,
      level: 0,
      tricks: [],
      current: [],
      ...hand,
    },
    turnDeadlineAt: 0,
    cancelVotes: [],
    privates: privates ?? {
      '0': {
        seat: 0,
        hand: [
          { rank: '3', suit: 'paus' },
          { rank: '7', suit: 'ouros' },
          { rank: 'A', suit: 'copas' },
        ] satisfies CardSnapshot[],
        legalActions: ['play:3paus', 'play:7ouros', 'play:Acopas', 'bet'],
        partnerCards: [],
        ownCovered: [],
      },
    },
    ...rest,
  };
}

/** Bloco privado do assento `seat`. */
export function priv(seat: number, over: Record<string, unknown> = {}) {
  return {
    [String(seat)]: { seat, hand: [], legalActions: [], partnerCards: [], ownCovered: [], ...over },
  };
}
