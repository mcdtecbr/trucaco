import { SPEECH_TAKES } from '@trucaco/avatar';
import { DEFAULT_AVATAR_PARTS, SFX_IDS } from '@trucaco/protocol';
import type { PublicGameEvent } from '@trucaco/protocol';
import { describe, expect, it } from 'vitest';
import { projectTable } from '../table/projectTable';
import type { TableViewModel } from '../table/projectTable';
import { player, priv, snapshot } from '../table/snapshotFixtures';
import { GAME_DECIDED_HOLD_MS, createSpeechDirector } from './speechDirector';
import type { SpeechLine } from './speechDirector';
import { createFakeAudioService } from './fake';

function vmOf(over: Parameters<typeof snapshot>[0] = {}): TableViewModel {
  return projectTable(snapshot(over));
}

function avatarWith(voice: string): string {
  return JSON.stringify({ ...DEFAULT_AVATAR_PARTS, voice });
}

function setup(
  vm: TableViewModel | null,
  opts: { muted?: string[]; prefs?: { muted: boolean } } = {},
) {
  const audio = createFakeAudioService(opts.prefs);
  const lines: SpeechLine[] = [];
  const timers: Array<{ fn: () => void; live: boolean }> = [];
  const director = createSpeechDirector({
    audio,
    getVm: () => vm,
    isMuted: (n) => opts.muted?.includes(n.toLowerCase()) === true,
    onSpeak: (l) => lines.push(l),
    rng: () => 0,
    timers: {
      setTimeout: (fn) => {
        timers.push({ fn, live: true });
        return timers.length - 1;
      },
      clearTimeout: (h) => {
        const t = timers[h as number];
        if (t) t.live = false;
      },
    },
  });
  const flush = () =>
    timers.forEach((t) => {
      if (t.live) {
        t.live = false;
        t.fn();
      }
    });
  return { audio, lines, director, flush };
}

const call = (seat: number, value: number): PublicGameEvent => ({
  type: 'betCalled',
  seat,
  toLevel: 1,
  value,
});

describe('evento -> voz certa por variante', () => {
  it('Paulista: 3 = truco, 6 = seis, 9 = nove, 12 = doze; 4 não é degrau', () => {
    const { audio, lines, director } = setup(vmOf());
    for (const v of [3, 6, 9, 12]) director.onEvent(call(1, v));
    director.onEvent(call(1, 4));
    expect(lines.map((l) => l.event)).toEqual(['truco', 'seis', 'nove', 'doze']);
    const voices = audio.calls.filter((c) => c.kind === 'voice');
    expect(voices).toHaveLength(4);
  });

  it('Mineiro: 4 = truco, 8 = oito, 10 = dez; 3 não é degrau', () => {
    const { lines, director } = setup(vmOf({ options: { variant: 'mineiro' } }));
    for (const v of [4, 6, 8, 10, 12]) director.onEvent(call(2, v));
    director.onEvent(call(2, 3));
    expect(lines.map((l) => l.event)).toEqual(['truco', 'seis', 'oito', 'dez', 'doze']);
  });

  it('a voz é a do avatar do assento que fala; sem avatar, masc_1', () => {
    const vm = vmOf({
      players: [player(0), player(1, { avatar: avatarWith('fem_1') }), player(2), player(3)],
    });
    const { audio, director } = setup(vm);
    director.onEvent(call(1, 3));
    director.onEvent(call(0, 3));
    const voices = audio.calls.flatMap((c) => (c.kind === 'voice' ? [c.voice] : []));
    expect(voices).toEqual(['fem_1', 'masc_1']);
  });

  it('quero, corro e mão de ferro (falada pelo pé)', () => {
    const { lines, director } = setup(vmOf());
    director.onEvent({ type: 'betAccepted', seat: 3, value: 3 });
    director.onEvent({ type: 'betRun', seat: 2, winnerTeam: 1, points: 1 });
    director.onEvent({ type: 'specialDecided', seat: 1, decision: 'play' });
    director.onEvent({
      type: 'handStarted',
      handNumber: 4,
      pe: 3,
      scores: [0, 0],
      special: 'maoDeFerro',
    });
    expect(lines.map((l) => [l.seat, l.event])).toEqual([
      [3, 'quero'],
      [2, 'corro'],
      [1, 'mao_especial'],
      [3, 'mao_de_ferro'],
    ]);
  });
});

describe('takes', () => {
  it('nunca repete o take anterior do mesmo assento', () => {
    const { lines, director } = setup(vmOf());
    for (let i = 0; i < 12; i++) director.onEvent(call(1, 3));
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i]?.takeId).not.toBe(lines[i - 1]?.takeId);
    }
    // Legenda é o texto do take do catálogo.
    const first = lines[0];
    expect(SPEECH_TAKES.truco.find((t) => t.id === first?.takeId)?.text).toBe(first?.text);
  });
});

describe('takes carregados', () => {
  it('prefere o take já carregado e pede os outros do evento em segundo plano', () => {
    const { audio, lines, director } = setup(vmOf());
    audio.ready = new Set(['masc_1:truco_3']);
    director.onEvent(call(1, 3));
    expect(lines[0]?.takeId).toBe('truco_3');
    expect(audio.warmed).toEqual([['masc_1', 'truco']]);
    audio.ready = new Set();
    director.onEvent(call(1, 3)); // nada pronto: sorteia entre todos, mas a legenda sai
    expect(lines).toHaveLength(2);
  });
});

describe('legenda sempre, som quando pode', () => {
  it('com "sem som": sem voz, mas a legenda sai', () => {
    const { audio, lines, director } = setup(vmOf(), { prefs: { muted: true } });
    director.onEvent(call(1, 3));
    expect(lines).toHaveLength(1);
    expect(audio.calls).toEqual([]);
  });

  it('voz sem arquivo (serviço devolve false): legenda sai do mesmo jeito', () => {
    const { audio, lines, director } = setup(vmOf());
    audio.playVoice = () => false;
    director.onEvent(call(1, 3));
    expect(lines).toHaveLength(1);
  });

  it('jogador silenciado localmente: sem voz, com legenda; eu mesmo nunca fico mudo', () => {
    const { audio, lines, director } = setup(vmOf(), { muted: ['bia', 'ana'] });
    director.onEvent(call(1, 3)); // Bia silenciada
    expect(lines).toHaveLength(1);
    expect(audio.calls.filter((c) => c.kind === 'voice')).toHaveLength(0);
    director.onEvent(call(0, 3)); // eu (Ana, assento 0) estou na lista, mas não conto
    expect(audio.calls.filter((c) => c.kind === 'voice')).toHaveLength(1);
  });
});

describe('vaza e fim de jogo', () => {
  it('vaza: fala conforme o sorteio (rng 0 < 0,25 fala); empate não fala', () => {
    const { lines, director } = setup(vmOf());
    director.onEvent({ type: 'trickDecided', index: 0, winnerSeat: 2, winnerTeam: 0 });
    director.onEvent({ type: 'trickDecided', index: 1, winnerSeat: null, winnerTeam: null });
    expect(lines.map((l) => [l.seat, l.event])).toEqual([[2, 'vaza']]);
  });

  it('jogo que não é o último da série: fala venceu_jogo na hora em que o próximo evento chega', () => {
    const { lines, director } = setup(vmOf());
    director.onEvent({ type: 'gameDecided', winnerTeam: 1, scores: [0, 12] });
    expect(lines).toHaveLength(0);
    director.onEvent({ type: 'gameStarted', gameNumber: 2 });
    expect(lines.map((l) => l.event)).toEqual(['venceu_jogo']);
    expect((lines[0]?.seat ?? 0) % 2).toBe(1);
  });

  it('bo3, último jogo: gameDecided + seriesDecided falam só venceu_serie', () => {
    const { lines, director, flush } = setup(vmOf({ series: { format: 'bo3' } }));
    director.onEvent({ type: 'gameDecided', winnerTeam: 0, scores: [12, 0] });
    director.onEvent({ type: 'seriesDecided', winnerTeam: 0, games: [2, 0] });
    flush();
    expect(lines.map((l) => l.event)).toEqual(['venceu_serie']);
  });

  it('single: gameDecided + seriesDecided falam só venceu_jogo (nunca "Campeões!")', () => {
    const { lines, director, flush } = setup(vmOf({ series: { format: 'single' } }));
    director.onEvent({ type: 'gameDecided', winnerTeam: 0, scores: [12, 0] });
    director.onEvent({ type: 'seriesDecided', winnerTeam: 0, games: [1, 0] });
    flush();
    expect(lines.map((l) => [l.seat % 2, l.event])).toEqual([[0, 'venceu_jogo']]);
  });

  it('sem próximo evento, a fala do jogo sai pelo prazo', () => {
    const { lines, director, flush } = setup(vmOf());
    director.onEvent({ type: 'gameDecided', winnerTeam: 0, scores: [12, 0] });
    expect(GAME_DECIDED_HOLD_MS).toBeGreaterThan(0);
    flush();
    expect(lines.map((l) => l.event)).toEqual(['venceu_jogo']);
  });
});

describe('efeitos de jogo locais', () => {
  it('embaralhar ao começar a mão, carta ao jogar, soco na mesa no truco e no aumento', () => {
    const { audio, director } = setup(vmOf());
    director.onEvent({
      type: 'handStarted',
      handNumber: 1,
      pe: 0,
      scores: [0, 0],
      special: 'normal',
    });
    director.onEvent({ type: 'cardPlayed', seat: 1, card: null, covered: false, blind: false });
    director.onEvent(call(1, 3));
    director.onEvent({ type: 'betRaised', seat: 0, toLevel: 2, value: 6 });
    const sfx = audio.calls.flatMap((c) => (c.kind === 'sfx' ? [c.id] : []));
    expect(sfx).toEqual(['card_shuffle', 'card_play', 'table_slam', 'table_slam']);
  });

  it('sem som: efeitos não tocam e a legenda do grito sai', () => {
    const { audio, lines, director } = setup(vmOf(), { prefs: { muted: true } });
    director.onEvent(call(1, 3));
    expect(audio.calls).toEqual([]);
    expect(lines).toHaveLength(1);
  });
});

describe('pré-carga e reset', () => {
  it('pré-carrega as vozes dos avatares presentes uma vez por conjunto; reset solta o áudio', () => {
    const vm = vmOf({
      players: [player(0, { avatar: avatarWith('fem_1') }), player(1), player(2), player(3)],
    });
    const { audio, director } = setup(vm);
    director.onState(vm);
    director.onState(vm);
    expect(audio.preloaded).toEqual([['fem_1', 'masc_1']]);
    // Efeitos de jogo (1) + soundboard (1, so quando ha assento meu).
    expect(audio.sfxPreloads).toBe(vm.mySeat >= 0 ? 2 : 1);
    director.reset();
    expect(audio.released).toBe(1);
    director.onState(vm);
    expect(audio.preloaded).toHaveLength(2);
  });

  it('sentado: pré-carrega os 8 efeitos engraçados uma vez (o 1º toque no painel não carrega nada); espectador não', () => {
    const seated = vmOf({ privates: priv(0) });
    expect(seated.mySeat).toBe(0);
    const { audio, director } = setup(seated);
    director.onState(seated);
    director.onState(seated);
    expect(audio.sfxPreloadIds.filter((ids) => ids.includes('horn'))).toEqual([[...SFX_IDS]]);
    director.reset();
    director.onState(seated);
    expect(audio.sfxPreloadIds.filter((ids) => ids.includes('horn'))).toHaveLength(2);

    const watcher = { ...vmOf(), mySeat: -1 };
    expect(watcher.mySeat).toBe(-1);
    const other = setup(watcher);
    other.director.onState(watcher);
    expect(other.audio.sfxPreloadIds.filter((ids) => ids.includes('horn'))).toEqual([]);
  });

  it('efeitos engraçados silenciados não são pré-carregados; ao religar, o próximo estado carrega', () => {
    const seated = vmOf({ privates: priv(0) });
    const { audio, director } = setup(seated);
    audio.setPrefs({ funnyMuted: true });
    director.onState(seated);
    expect(audio.sfxPreloadIds.filter((ids) => ids.includes('horn'))).toEqual([]);
    audio.setPrefs({ funnyMuted: false });
    director.onState(seated);
    expect(audio.sfxPreloadIds.filter((ids) => ids.includes('horn'))).toHaveLength(1);
  });
});
