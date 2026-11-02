import type { PublicGameEvent } from '@trucaco/protocol';
import { describe, expect, it, vi } from 'vitest';
import { PUBLIC_EVENT_TYPES, announcementFor, createAnnouncementQueue } from './announcements';
import type { AnnounceContext } from './announcements';

const CTX: AnnounceContext = {
  mySeat: 0,
  nicknameOf: (s) => ['Eu', 'Ana', 'Bia', undefined][s],
};

const SAMPLES: Record<PublicGameEvent['type'], PublicGameEvent> = {
  gameStarted: { type: 'gameStarted', gameNumber: 2 },
  handStarted: { type: 'handStarted', handNumber: 3, pe: 1, scores: [4, 6], special: 'normal' },
  cardPlayed: {
    type: 'cardPlayed',
    seat: 1,
    card: { rank: '3', suit: 'paus' },
    covered: false,
    blind: false,
  },
  trickDecided: { type: 'trickDecided', index: 0, winnerSeat: 2, winnerTeam: 0 },
  betCalled: { type: 'betCalled', seat: 1, toLevel: 1, value: 3 },
  betAccepted: { type: 'betAccepted', seat: 0, value: 3 },
  betRaised: { type: 'betRaised', seat: 2, toLevel: 2, value: 6 },
  betRun: { type: 'betRun', seat: 3, winnerTeam: 0, points: 3 },
  specialDecided: { type: 'specialDecided', seat: 0, decision: 'play' },
  handDecided: { type: 'handDecided', winnerTeam: 0, points: 3, reason: 'tricks', scores: [7, 6] },
  gameDecided: { type: 'gameDecided', winnerTeam: 1, scores: [9, 12] },
  seriesDecided: { type: 'seriesDecided', winnerTeam: 0, games: [2, 1] },
  seriesCancelled: { type: 'seriesCancelled' },
};

describe('announcementFor', () => {
  it('cobre TODOS os tipos de PublicGameEvent com frase não vazia em pt-BR', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...PUBLIC_EVENT_TYPES].sort());
    for (const type of PUBLIC_EVENT_TYPES) {
      const text = announcementFor(SAMPLES[type], CTX);
      expect(text, type).not.toBe('');
      expect(text, type).not.toContain('undefined');
      expect(text, type).not.toContain('NaN');
    }
  });

  it('apostas: grito e valor', () => {
    expect(announcementFor(SAMPLES.betCalled, CTX)).toBe(
      'Ana pediu truco. A mão passa a valer 3 se aceitar.',
    );
    expect(announcementFor(SAMPLES.betRaised, CTX)).toBe(
      'Bia aumentou para seis. A mão passa a valer 6 se aceitar.',
    );
    expect(announcementFor(SAMPLES.betAccepted, CTX)).toBe('Você aceitou. A mão vale 3.');
    expect(announcementFor({ type: 'betCalled', seat: 1, toLevel: 1, value: 4 }, CTX)).toContain(
      'pediu truco',
    );
    expect(announcementFor({ type: 'betCalled', seat: 1, toLevel: 1, value: 7 }, CTX)).toContain(
      'pediu 7',
    );
    expect(announcementFor(SAMPLES.betRun, CTX)).toBe('Jogador 4 correu. Nós ganha 3 pontos.');
  });

  it('fim de mão, de jogo e de série usam o ponto de vista do jogador', () => {
    expect(announcementFor(SAMPLES.handDecided, CTX)).toBe(
      'Fim da mão: Nós ganha 3 pontos. Placar: Nós 7, Eles 6.',
    );
    expect(
      announcementFor({ ...SAMPLES.handDecided, winnerTeam: null } as PublicGameEvent, CTX),
    ).toContain('empate');
    expect(announcementFor(SAMPLES.gameDecided, CTX)).toBe('Fim de jogo: Eles venceu por 12 a 9.');
    expect(announcementFor(SAMPLES.seriesDecided, CTX)).toBe('Fim da série: Nós venceu por 2 a 1.');
    const as1 = announcementFor(SAMPLES.handDecided, { ...CTX, mySeat: 1 });
    expect(as1).toBe('Fim da mão: Eles ganha 3 pontos. Placar: Eles 7, Nós 6.');
  });

  it('mão de onze/dez, ferro e decisão especial', () => {
    expect(
      announcementFor({ ...SAMPLES.handStarted, special: 'maoDeOnze' } as PublicGameEvent, CTX),
    ).toContain('Mão de onze');
    expect(
      announcementFor({ ...SAMPLES.handStarted, special: 'maoDeOnze' } as PublicGameEvent, {
        ...CTX,
        variant: 'mineiro',
      }),
    ).toContain('Mão de dez');
    expect(
      announcementFor({ ...SAMPLES.handStarted, special: 'maoDeFerro' } as PublicGameEvent, CTX),
    ).toContain('Mão de ferro');
    expect(announcementFor(SAMPLES.specialDecided, CTX)).toBe('Você decidiu jogar a mão de onze.');
    expect(announcementFor({ type: 'specialDecided', seat: 1, decision: 'run' }, CTX)).toBe(
      'Ana correu da mão de onze.',
    );
  });

  it('cartas: aberta, coberta, às cegas e vaza empatada', () => {
    expect(announcementFor(SAMPLES.cardPlayed, CTX)).toBe('Ana jogou três de paus.');
    expect(
      announcementFor(
        { type: 'cardPlayed', seat: 2, card: null, covered: true, blind: false },
        CTX,
      ),
    ).toBe('Bia jogou uma carta coberta.');
    expect(
      announcementFor(
        {
          type: 'cardPlayed',
          seat: 0,
          card: { rank: '4', suit: 'ouros' },
          covered: false,
          blind: true,
        },
        CTX,
      ),
    ).toBe('Você jogou quatro de ouros às cegas.');
    expect(
      announcementFor({ type: 'trickDecided', index: 1, winnerSeat: null, winnerTeam: null }, CTX),
    ).toBe('Vaza 2 empatada.');
    expect(announcementFor(SAMPLES.trickDecided, CTX)).toBe('Vaza 1: Bia levou.');
  });

  it('nomes customizados de dupla', () => {
    const t = announcementFor(SAMPLES.handDecided, {
      ...CTX,
      teamNames: ['Ana e Eu', 'Bia e Caio'],
    });
    expect(t).toContain('Ana e Eu ganha');
  });
});

describe('createAnnouncementQueue', () => {
  function fake() {
    const jobs: Array<{ fn: () => void; ms: number; id: number }> = [];
    let id = 0;
    return {
      jobs,
      timers: {
        setTimeout: (fn: () => void, ms: number) => {
          jobs.push({ fn, ms, id: ++id });
          return id;
        },
        clearTimeout: (h: unknown) => {
          const i = jobs.findIndex((j) => j.id === h);
          if (i >= 0) jobs.splice(i, 1);
        },
      },
      tick: () => jobs.shift()?.fn(),
    };
  }

  it('entrega o primeiro na hora e espera o intervalo para os seguintes', () => {
    const f = fake();
    const deliver = vi.fn();
    const q = createAnnouncementQueue({ deliver, timers: f.timers });
    q.enqueue('a');
    q.enqueue('b');
    q.enqueue('c');
    expect(deliver.mock.calls).toEqual([['a']]);
    expect(f.jobs[0]?.ms).toBe(1500);
    f.tick();
    f.tick();
    expect(deliver.mock.calls.map((c) => c[0])).toEqual(['a', 'b', 'c']);
    f.tick();
    expect(q.size).toBe(0);
  });

  it('ignora repetição imediata e vazio, mas aceita a mesma frase depois de esvaziar', () => {
    const f = fake();
    const deliver = vi.fn();
    const q = createAnnouncementQueue({ deliver, timers: f.timers });
    q.enqueue('a');
    q.enqueue('a');
    q.enqueue('');
    expect(q.size).toBe(0);
    f.tick();
    q.enqueue('a');
    expect(deliver).toHaveBeenCalledTimes(2);
  });

  it('descarta os mais antigos acima do teto', () => {
    const f = fake();
    const deliver = vi.fn();
    const q = createAnnouncementQueue({ deliver, maxPending: 2, timers: f.timers });
    for (const m of ['1', '2', '3', '4', '5']) q.enqueue(m);
    expect(q.size).toBe(2);
    while (f.jobs.length > 0) f.tick();
    expect(deliver.mock.calls.map((c) => c[0])).toEqual(['1', '4', '5']);
  });

  it('dispose cancela o timer e silencia a fila', () => {
    const f = fake();
    const deliver = vi.fn();
    const q = createAnnouncementQueue({ deliver, timers: f.timers });
    q.enqueue('a');
    q.enqueue('b');
    q.dispose();
    expect(f.jobs).toHaveLength(0);
    q.enqueue('c');
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('usa os timers globais por padrão', () => {
    vi.useFakeTimers();
    const deliver = vi.fn();
    const q = createAnnouncementQueue({ deliver, gapMs: 100 });
    q.enqueue('a');
    q.enqueue('b');
    vi.advanceTimersByTime(100);
    expect(deliver).toHaveBeenCalledTimes(2);
    q.dispose();
    vi.useRealTimers();
  });
});
