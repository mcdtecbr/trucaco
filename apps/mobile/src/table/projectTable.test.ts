import { describe, expect, it } from 'vitest';
import { actionSignature, mySeatOf, projectTable } from './projectTable';
import { player, priv, snapshot } from './snapshotFixtures';

describe('projectTable: entrada degenerada', () => {
  it.each([undefined, null, 42, 'x', [], {}])(
    'estado %j não lança e vira uma mesa vazia',
    (input) => {
      const vm = projectTable(input);
      expect(vm.phase).toBe('');
      expect(vm.mySeat).toBe(-1);
      expect(vm.seats).toHaveLength(4);
      expect(vm.legalActions).toEqual([]);
      expect(vm.canAct).toBe(false);
      expect(vm.pending).toBeNull();
      expect(vm.nextBetValue).toBeUndefined();
    },
  );

  it('campos com tipo errado caem nos padrões', () => {
    const vm = projectTable({
      phase: 7,
      players: 'x',
      hand: { actingSeat: 'a', value: null },
      game: [],
    });
    expect(vm.phase).toBe('');
    expect(vm.actingSeat).toBe(-1);
    expect(vm.handValue).toBe(0);
    expect(vm.scores).toEqual([0, 0]);
  });
});

describe('projectTable: waiting', () => {
  it('assentos vazios e fase waiting, sem mão', () => {
    const vm = projectTable(
      snapshot({
        phase: 'waiting',
        players: [
          player(0),
          player(1, { status: 'empty', nickname: '' }),
          player(2, { status: 'empty', nickname: '' }),
          player(3, { status: 'empty', nickname: '' }),
        ],
        hand: { phase: '', turn: -1, viraRank: '', viraSuit: '', manilhaRank: '', nextBetValue: 0 },
        game: { handNumber: 0, pe: -1 },
        privates: priv(0),
      }),
    );
    expect(vm.phase).toBe('waiting');
    expect(vm.mySeat).toBe(0);
    expect(vm.seats[1]?.status).toBe('empty');
    expect(vm.handPhase).toBe('');
    expect(vm.manilhas).toEqual([]);
    expect(vm.vira).toEqual({ rank: '', suit: '' });
    expect(vm.seats.some((s) => s.isTurn)).toBe(false);
  });
});

describe('projectTable: jogando (Paulista)', () => {
  const vm = projectTable(
    snapshot({
      turnDeadlineAt: 1_700_000_000_000,
      hand: {
        turn: 0,
        current: [
          { seat: 1, rank: 'K', suit: 'ouros', covered: false },
          { seat: 2, rank: '', suit: '', covered: true },
        ],
        tricks: [{ starter: 0, winnerSeat: 3, winnerTeam: 1, plays: [] }],
        value: 1,
      },
    }),
  );

  it('perspectiva: eu embaixo, próximo à direita, parceiro em cima', () => {
    expect(vm.byPosition.self.seat).toBe(0);
    expect(vm.byPosition.right.seat).toBe(1);
    expect(vm.byPosition.partner.seat).toBe(2);
    expect(vm.byPosition.left.seat).toBe(3);
    expect(vm.byPosition.partner.side).toBe('mine');
    expect(vm.byPosition.right.side).toBe('theirs');
    expect(vm.myTeam).toBe(0);
  });

  it('mão, ações, vez, prazo e vaza', () => {
    expect(vm.myHand).toHaveLength(3);
    expect(vm.legalActions).toEqual(['play:3paus', 'play:7ouros', 'play:Acopas', 'bet']);
    expect(vm.canAct).toBe(true);
    expect(vm.actingSeat).toBe(0);
    expect(vm.seats[0]?.isTurn).toBe(true);
    expect(vm.turnDeadlineAt).toBe(1_700_000_000_000);
    expect(vm.current).toHaveLength(2);
    expect(vm.current[1]).toMatchObject({ seat: 2, covered: true, rank: '' });
    expect(vm.tricks[0]?.winnerTeam).toBe(1);
  });

  it('manilha Paulista: o servidor manda o rank, o cliente só espalha pelos 4 naipes', () => {
    expect(vm.manilhaLabel).toBe('6');
    expect(vm.manilhas).toHaveLength(4);
    expect(new Set(vm.manilhas.map((m) => m.suit)).size).toBe(4);
    expect(vm.manilhas.every((m) => m.rank === '6')).toBe(true);
  });

  it('valor da próxima aposta vem do servidor; 0 = indisponível', () => {
    expect(vm.nextBetValue).toBe(3);
    expect(projectTable(snapshot({ hand: { nextBetValue: 0 } })).nextBetValue).toBeUndefined();
  });

  it('placar sai do estado', () => {
    const v = projectTable(
      snapshot({
        game: { scores: [4, 7], handNumber: 5 },
        series: { format: 'bo3', games: [1, 0], gameNumber: 2 },
      }),
    );
    expect(v.scores).toEqual([4, 7]);
    expect(v.handNumber).toBe(5);
    expect(v.series).toMatchObject({ format: 'bo3', games: [1, 0], gameNumber: 2, winnerTeam: -1 });
  });
});

describe('projectTable: perspectiva por assento', () => {
  it.each([0, 1, 2, 3])('quem senta no assento %i se vê embaixo', (seat) => {
    const vm = projectTable(snapshot({ privates: priv(seat) }));
    expect(vm.mySeat).toBe(seat);
    expect(vm.byPosition.self.seat).toBe(seat);
    expect(vm.byPosition.partner.seat).toBe((seat + 2) % 4);
    expect(vm.byPosition.self.isMe).toBe(true);
    expect(vm.myTeam).toBe(seat % 2);
    expect(vm.byPosition.partner.side).toBe('mine');
  });

  it('mySeat explícito vence o deduzido; deduzido de privates', () => {
    expect(mySeatOf(snapshot({ privates: priv(3) }))).toBe(3);
    expect(projectTable(snapshot({ privates: priv(3) }), 1).mySeat).toBe(1);
  });
});

describe('projectTable: aposta pendente', () => {
  const pending = snapshot({
    hand: {
      phase: 'betPending',
      turn: 0,
      actingSeat: 1,
      pending: { fromSeat: 0, fromTeam: 0, toLevel: 1, responderSeat: 1 },
      pendingValue: 3,
      nextBetValue: 6,
    },
    privates: priv(1, { legalActions: ['accept', 'run', 'bet'] }),
  });

  it('quem responde vê accept/run/bet, valor pendente e próximo valor', () => {
    const vm = projectTable(pending);
    expect(vm.mySeat).toBe(1);
    expect(vm.handPhase).toBe('betPending');
    expect(vm.actingSeat).toBe(1);
    expect(vm.seats[1]?.isTurn).toBe(true);
    expect(vm.seats[0]?.isTurn).toBe(false);
    expect(vm.pending).toEqual({
      fromSeat: 0,
      fromTeam: 0,
      toLevel: 1,
      fromMyTeam: false,
      responderSeat: 1,
    });
    expect(vm.pendingValue).toBe(3);
    expect(vm.nextBetValue).toBe(6);
    expect(vm.legalActions).toEqual(['accept', 'run', 'bet']);
  });

  it('quem pediu vê a aposta como da própria dupla e sem ações', () => {
    const vm = projectTable({ ...pending, privates: priv(0) });
    expect(vm.pending?.fromMyTeam).toBe(true);
    expect(vm.canAct).toBe(false);
  });

  it('sem aposta: pending nulo mesmo com undefined/null no estado', () => {
    expect(projectTable(snapshot({ hand: { pending: undefined } })).pending).toBeNull();
    expect(projectTable({ ...snapshot(), hand: { pending: null } }).pending).toBeNull();
  });
});

describe('projectTable: mão de onze/dez', () => {
  it('decisão especial com cartas do parceiro; ações specialPlay/specialRun', () => {
    const vm = projectTable(
      snapshot({
        game: { scores: [11, 3] },
        hand: { special: 'maoDeOnze', specialTeam: 0, phase: 'specialDecision', turn: 0 },
        privates: priv(0, {
          hand: [{ rank: '4', suit: 'paus' }],
          partnerCards: [
            { rank: '3', suit: 'copas' },
            { rank: '5', suit: 'ouros' },
          ],
          legalActions: ['specialPlay', 'specialRun'],
        }),
      }),
    );
    expect(vm.special).toBe('maoDeOnze');
    expect(vm.handPhase).toBe('specialDecision');
    expect(vm.partnerCards).toHaveLength(2);
    expect(vm.legalActions).toEqual(['specialPlay', 'specialRun']);
    expect(vm.decidingTeam).toBe(0);
    expect(vm.seats[0]?.isTurn).toBe(false);
  });

  it('os dois da dupla decidem: actingSeat -1, specialAccepted lido e sem destaque de vez', () => {
    const state = (seat: number) =>
      snapshot({
        hand: {
          special: 'maoDeOnze',
          specialTeam: 0,
          phase: 'specialDecision',
          turn: 0,
          actingSeat: -1,
          specialAccepted: [0],
        },
        privates: priv(seat, { legalActions: ['specialPlay', 'specialRun'] }),
      });
    const partner = projectTable(state(2));
    expect(partner.actingSeat).toBe(-1);
    expect(partner.specialAccepted).toEqual([0]);
    expect(partner.iAccepted).toBe(false);
    expect(projectTable(state(0), 0).iAccepted).toBe(true);
    expect(partner.canAct).toBe(true);
    expect(partner.seats.some((x) => x.isTurn)).toBe(false);
  });
});

describe('projectTable: mão de ferro', () => {
  it('mão vazia com handSize > 0 vira cartas às cegas (playBlind)', () => {
    const vm = projectTable(
      snapshot({
        hand: { special: 'maoDeFerro', turn: 0 },
        privates: priv(0, {
          hand: [],
          legalActions: ['playBlind:0', 'playBlind:1', 'playBlind:2'],
        }),
      }),
    );
    expect(vm.blindCount).toBe(3);
    expect(vm.myHand).toEqual([]);
    expect(vm.legalActions).toEqual(['playBlind:0', 'playBlind:1', 'playBlind:2']);
  });

  it('fora da mão de ferro blindCount é 0', () => {
    expect(projectTable(snapshot()).blindCount).toBe(0);
  });
});

describe('projectTable: Mineiro', () => {
  it('manilhas fixas vêm de manilhaCards; sem vira', () => {
    const vm = projectTable(
      snapshot({
        options: { variant: 'mineiro' },
        hand: {
          viraRank: '',
          viraSuit: '',
          manilhaRank: '',
          manilhaCards: ['4paus', '7copas', 'Aespadas', '7ouros'],
          nextBetValue: 4,
        },
      }),
    );
    expect(vm.variant).toBe('mineiro');
    expect(vm.manilhaLabel).toBeUndefined();
    expect(vm.manilhas.map((m) => `${m.rank}${m.suit}`)).toEqual([
      '4paus',
      '7copas',
      'Aespadas',
      '7ouros',
    ]);
    expect(vm.nextBetValue).toBe(4);
  });

  it('manilhaCards malformadas são descartadas', () => {
    const vm = projectTable(
      snapshot({
        hand: { manilhaRank: '', manilhaCards: ['4paus', 'xx', 5, '__proto__', 'Zouros'] as never },
      }),
    );
    expect(vm.manilhas).toEqual([{ rank: '4', suit: 'paus' }]);
  });
});

describe('projectTable: finished e presença', () => {
  it('finished mantém placar e série', () => {
    const vm = projectTable(
      snapshot({
        phase: 'finished',
        series: { winnerTeam: 0 },
        game: { scores: [12, 9] },
        hand: { phase: 'finished', turn: -1 },
      }),
    );
    expect(vm.phase).toBe('finished');
    expect(vm.series.winnerTeam).toBe(0);
    expect(vm.scores).toEqual([12, 9]);
    expect(vm.seats.some((s) => s.isTurn)).toBe(false);
  });

  it('status away/bot e isBot sobrepõe', () => {
    const vm = projectTable(
      snapshot({
        players: [
          player(0),
          player(1, { status: 'away' }),
          player(2, { status: 'bot', isBot: true }),
          player(3, { status: 'connected', isBot: true }),
        ],
      }),
    );
    expect(vm.seats.map((s) => s.status)).toEqual(['connected', 'away', 'bot', 'bot']);
  });
});

describe('projectTable: legalActions e a própria coberta', () => {
  it('descarta ids desconhecidos (nunca passam para a UI)', () => {
    const vm = projectTable(
      snapshot({
        privates: priv(0, {
          legalActions: ['bet', 'hack', 'play:9paus', 'play:3paus', 7, 'playBlind:3'],
        }),
      }),
    );
    expect(vm.legalActions).toEqual(['bet', 'play:3paus']);
  });

  it('ownCovered da vaza em curso (trick -1)', () => {
    const vm = projectTable(
      snapshot({
        privates: priv(0, {
          ownCovered: [
            { rank: 'K', suit: 'paus', trick: 0 },
            { rank: 'Q', suit: 'copas', trick: -1 },
          ],
        }),
      }),
    );
    expect(vm.ownCoveredCurrent).toEqual({ rank: 'Q', suit: 'copas' });
  });

  it('assinatura de ação muda quando a jogada é refletida', () => {
    const a = actionSignature(projectTable(snapshot()));
    const b = actionSignature(projectTable(snapshot({ hand: { turn: 1 }, privates: priv(0) })));
    expect(a).not.toBe(b);
  });
});

describe('projectTable: revanche', () => {
  const done = (over: Record<string, unknown> = {}) =>
    projectTable(
      snapshot({
        phase: 'finished',
        series: { winnerTeam: 0 },
        rematchDeadlineAt: 5_000,
        rematchVotes: [1],
        ...over,
      }),
    );

  it('janela aberta: fim com vencedor e prazo publicado', () => {
    const vm = done();
    expect(vm.rematchOpen).toBe(true);
    expect(vm.rematchDeadlineAt).toBe(5_000);
    expect(vm.rematchVotes).toEqual([1]);
    expect(vm.iVotedRematch).toBe(false);
  });

  it('fechada: sem prazo (servidor antigo), mesa cancelada, em andamento', () => {
    expect(done({ rematchDeadlineAt: 0 }).rematchOpen).toBe(false);
    expect(done({ series: { winnerTeam: -1 } }).rematchOpen).toBe(false);
    expect(projectTable(snapshot({ rematchDeadlineAt: 5_000 })).rematchOpen).toBe(false);
    const old = snapshot({ phase: 'finished', series: { winnerTeam: 0 } });
    delete old['rematchVotes'];
    delete old['rematchDeadlineAt'];
    delete old['matchNumber'];
    const vm = projectTable(old);
    expect(vm.rematchOpen).toBe(false);
    expect(vm.rematchVotes).toEqual([]);
    expect(vm.matchNumber).toBe(1);
  });

  it('iVotedRematch usa o meu assento; humanos conectados ignoram bot e ausentes', () => {
    const vm = done({
      rematchVotes: [0, 1],
      players: [
        player(0),
        player(1),
        player(2, { isBot: true, status: 'connected' }),
        player(3, { status: 'away' }),
      ],
    });
    expect(vm.iVotedRematch).toBe(true);
    expect(done({ rematchVotes: [0], privates: priv(1) }).iVotedRematch).toBe(false);
  });

  it('matchNumber vem do servidor e tem piso 1', () => {
    expect(projectTable(snapshot({ matchNumber: 3 })).matchNumber).toBe(3);
    expect(projectTable(snapshot({ matchNumber: 0 })).matchNumber).toBe(1);
  });
});
