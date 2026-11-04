import type { PublicGameEvent } from '@trucaco/protocol';
import { describe, expect, it } from 'vitest';
import {
  ALL_TAKES,
  SPEECH_TAKES,
  VOICE_EVENTS,
  pickTake,
  takeById,
  voiceEventForBet,
  voiceEventForGameEvent,
  type SpeechContext,
} from './speech';

const ctx = (rng: () => number = () => 0, extra: Partial<SpeechContext> = {}): SpeechContext => ({
  variant: 'paulista',
  rng,
  ...extra,
});

describe('catálogo de falas', () => {
  it('todo evento tem takes com ids <evento>_<n> únicos e texto não vazio', () => {
    const ids = new Set<string>();
    for (const event of VOICE_EVENTS) {
      const takes = SPEECH_TAKES[event];
      expect(takes.length).toBeGreaterThanOrEqual(3);
      takes.forEach((t, i) => {
        expect(t.id).toBe(`${event}_${i + 1}`);
        expect(t.text.trim().length).toBeGreaterThan(0);
        expect(ids.has(t.id)).toBe(false);
        ids.add(t.id);
      });
    }
    expect(ALL_TAKES).toHaveLength(ids.size);
  });

  it('corro tem pelo menos 5 variações e truco traz as falas do usuário', () => {
    expect(SPEECH_TAKES.corro.length).toBeGreaterThanOrEqual(5);
    expect(SPEECH_TAKES.truco.map((t) => t.text)).toContain('Truco, ladrão!');
    expect(takeById('vaza_1')?.text).toBe('Manda o Zap pra cá!');
    expect(takeById('nao_existe')).toBeNull();
  });

  it('frases curtas (legenda de balão)', () => {
    for (const t of ALL_TAKES) expect(t.text.length).toBeLessThanOrEqual(30);
  });
});

describe('voiceEventForBet', () => {
  it('escada Paulista 3/6/9/12', () => {
    expect([3, 6, 9, 12].map((v) => voiceEventForBet(v, 'paulista'))).toEqual([
      'truco',
      'seis',
      'nove',
      'doze',
    ]);
  });

  it('escada Mineiro 4/6/8/10/12', () => {
    expect([4, 6, 8, 10, 12].map((v) => voiceEventForBet(v, 'mineiro'))).toEqual([
      'truco',
      'seis',
      'oito',
      'dez',
      'doze',
    ]);
  });

  it('valor fora da escada da variante dá null', () => {
    expect(voiceEventForBet(8, 'paulista')).toBeNull();
    expect(voiceEventForBet(9, 'mineiro')).toBeNull();
    expect(voiceEventForBet(1, 'paulista')).toBeNull();
    expect(voiceEventForBet(3, 'mineiro')).toBeNull();
  });
});

describe('voiceEventForGameEvent', () => {
  const ev = (e: PublicGameEvent): PublicGameEvent => e;

  it('betCalled e betRaised viram o grito do degrau', () => {
    expect(
      voiceEventForGameEvent(ev({ type: 'betCalled', seat: 2, toLevel: 0, value: 3 }), ctx()),
    ).toEqual({ seat: 2, event: 'truco' });
    expect(
      voiceEventForGameEvent(ev({ type: 'betRaised', seat: 1, toLevel: 2, value: 8 }), {
        ...ctx(),
        variant: 'mineiro',
      }),
    ).toEqual({ seat: 1, event: 'oito' });
    expect(
      voiceEventForGameEvent(ev({ type: 'betCalled', seat: 1, toLevel: 2, value: 8 }), ctx()),
    ).toBeNull();
  });

  it('aceitar, correr e mão especial', () => {
    expect(voiceEventForGameEvent(ev({ type: 'betAccepted', seat: 3, value: 3 }), ctx())).toEqual({
      seat: 3,
      event: 'quero',
    });
    expect(
      voiceEventForGameEvent(ev({ type: 'betRun', seat: 0, winnerTeam: 1, points: 1 }), ctx()),
    ).toEqual({ seat: 0, event: 'corro' });
    expect(
      voiceEventForGameEvent(ev({ type: 'specialDecided', seat: 2, decision: 'play' }), ctx()),
    ).toEqual({ seat: 2, event: 'mao_especial' });
    expect(
      voiceEventForGameEvent(ev({ type: 'specialDecided', seat: 2, decision: 'run' }), ctx()),
    ).toEqual({ seat: 2, event: 'corro' });
  });

  it('mão de ferro fala pelo pé; onze e normal ficam mudas', () => {
    const base = { type: 'handStarted', handNumber: 1, pe: 3, scores: [0, 0] } as const;
    expect(voiceEventForGameEvent(ev({ ...base, special: 'maoDeFerro' }), ctx())).toEqual({
      seat: 3,
      event: 'mao_de_ferro',
    });
    expect(voiceEventForGameEvent(ev({ ...base, special: 'maoDeOnze' }), ctx())).toBeNull();
    expect(voiceEventForGameEvent(ev({ ...base, special: 'normal' }), ctx())).toBeNull();
  });

  it('vaza depende do rng e da chance injetados', () => {
    const e = ev({ type: 'trickDecided', index: 0, winnerSeat: 1, winnerTeam: 1 });
    expect(
      voiceEventForGameEvent(
        e,
        ctx(() => 0.1),
      ),
    ).toEqual({ seat: 1, event: 'vaza' });
    expect(
      voiceEventForGameEvent(
        e,
        ctx(() => 0.5),
      ),
    ).toBeNull();
    expect(
      voiceEventForGameEvent(
        e,
        ctx(() => 0.5, { trickChance: 1 }),
      ),
    ).not.toBeNull();
    expect(
      voiceEventForGameEvent(
        e,
        ctx(() => 0, { trickChance: 0 }),
      ),
    ).toBeNull();
    const draw = ev({ type: 'trickDecided', index: 0, winnerSeat: null, winnerTeam: null });
    expect(
      voiceEventForGameEvent(
        draw,
        ctx(() => 0, { trickChance: 1 }),
      ),
    ).toBeNull();
  });

  it('fim de jogo e de série: assento da dupla vencedora', () => {
    const game = ev({ type: 'gameDecided', winnerTeam: 1, scores: [3, 12] });
    expect(
      voiceEventForGameEvent(
        game,
        ctx(() => 0),
      ),
    ).toEqual({
      seat: 1,
      event: 'venceu_jogo',
    });
    const series = ev({ type: 'seriesDecided', winnerTeam: 0, games: [2, 0] });
    for (const r of [0, 0.5, 0.999, 1]) {
      const cue = voiceEventForGameEvent(
        series,
        ctx(() => r, { seats: 6 }),
      );
      expect(cue?.event).toBe('venceu_serie');
      expect(cue!.seat % 2).toBe(0);
      expect(cue!.seat).toBeLessThan(6);
    }
  });

  it('eventos sem voz devolvem null', () => {
    const silent: PublicGameEvent[] = [
      { type: 'gameStarted', gameNumber: 1 },
      { type: 'cardPlayed', seat: 0, card: null, covered: true, blind: false },
      { type: 'handDecided', winnerTeam: 0, points: 1, reason: 'tricks', scores: [1, 0] },
      { type: 'seriesCancelled' },
    ];
    for (const s of silent) expect(voiceEventForGameEvent(s, ctx())).toBeNull();
  });
});

describe('pickTake', () => {
  it('nunca repete o take anterior', () => {
    for (const event of VOICE_EVENTS) {
      for (const last of SPEECH_TAKES[event]) {
        for (const r of [0, 0.3, 0.7, 0.999, 1]) {
          const t = pickTake(event, last.id, () => r);
          expect(t.id).not.toBe(last.id);
          expect(SPEECH_TAKES[event]).toContainEqual(t);
        }
      }
    }
  });

  it('sem take anterior sorteia entre todos e cobre todos', () => {
    const n = SPEECH_TAKES.corro.length;
    const seen = new Set<string>();
    for (let i = 0; i < n; i++) seen.add(pickTake('corro', null, () => i / n).id);
    expect(seen.size).toBe(n);
  });
});

describe('pickTake com takes prontos', () => {
  it('sorteia só entre os prontos; sem nenhum pronto, entre todos', () => {
    for (let i = 0; i < 10; i++) {
      expect(
        pickTake(
          'truco',
          null,
          () => i / 10,
          (id) => id === 'truco_4',
        ).id,
      ).toBe('truco_4');
    }
    expect(
      pickTake(
        'truco',
        null,
        () => 0,
        () => false,
      ).id,
    ).toBe('truco_1');
  });
});
