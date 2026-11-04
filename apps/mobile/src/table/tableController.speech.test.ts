import { describe, expect, it } from 'vitest';
import { createFakeAudioService } from '../audio/fake';
import { snapshot } from './snapshotFixtures';
import { REPLAY_MIN_AGE_MS, SPEECH_MS, createTableController } from './tableController';
import { createTableStore } from './tableStore';

function setup(muted: string[] = []) {
  const store = createTableStore();
  const audio = createFakeAudioService();
  const timers: Array<{ fn: () => void; ms: number; live: boolean }> = [];
  const clock = { t: 1_000_000 };
  const ctl = createTableController({
    store,
    send: () => true,
    now: () => clock.t,
    audio,
    isMuted: (n) => muted.includes(n.toLowerCase()),
    speechRng: () => 0,
    timers: {
      setTimeout: (fn, ms) => {
        timers.push({ fn, ms, live: true });
        return timers.length - 1;
      },
      clearTimeout: (h) => {
        const t = timers[h as number];
        if (t) t.live = false;
      },
    },
  });
  const fire = (ms: number) =>
    timers.forEach((t) => {
      if (t.live && t.ms === ms) {
        t.live = false;
        t.fn();
      }
    });
  return { store, ctl, audio, fire, clock };
}

const truco = { type: 'betCalled', seat: 1, toLevel: 1, value: 3 };

describe('fala do avatar na mesa', () => {
  it('truco: voz, soco na mesa e balão grande de 2 s sobre o assento que gritou', () => {
    const { store, ctl, audio, fire } = setup();
    ctl.applyState(snapshot());
    ctl.onEvent({ seq: 1, at: 1_000_000, event: truco });
    expect(store.getState().speech[1]?.text).toBeTruthy();
    expect(store.getState().speech[1]?.event).toBe('truco');
    expect(audio.calls.map((c) => c.kind)).toEqual(['sfx', 'voice']);
    fire(SPEECH_MS);
    expect(store.getState().speech[1]).toBeUndefined();
  });

  it('o balão de fala não mexe no balão de chat', () => {
    const { store, ctl, fire } = setup();
    ctl.applyState(snapshot());
    ctl.onChat({ scope: 'table', seat: 1, text: 'oi' });
    ctl.onEvent({ seq: 1, at: 1_000_000, event: truco });
    fire(SPEECH_MS);
    expect(store.getState().speech[1]).toBeUndefined();
    expect(store.getState().bubbles[1]?.text).toBe('oi');
  });

  it('legenda mesmo com "sem som"; silenciado: sem voz, com legenda', () => {
    const { store, ctl, audio } = setup(['bia']);
    ctl.applyState(snapshot());
    audio.setPrefs({ muted: true });
    ctl.onEvent({ seq: 1, at: 1_000_000, event: truco });
    expect(store.getState().speech[1]).toBeDefined();
    expect(audio.calls).toEqual([]);
    audio.setPrefs({ muted: false });
    ctl.onEvent({ seq: 2, at: 1_000_000, event: truco });
    expect(audio.calls.filter((c) => c.kind === 'voice')).toEqual([]); // Bia (assento 1) silenciada
  });

  it('replay depois de reconectar não fala de novo', () => {
    const { store, ctl, audio, clock } = setup();
    ctl.applyState(snapshot());
    ctl.onReconnected();
    ctl.onEvent({ seq: 1, at: clock.t - REPLAY_MIN_AGE_MS - 1000, event: truco });
    expect(store.getState().speech).toEqual({});
    expect(audio.calls).toEqual([]);
  });

  it('pré-carrega as vozes ao receber o estado e solta o áudio no reset', () => {
    const { ctl, audio } = setup();
    ctl.applyState(snapshot());
    expect(audio.preloaded).toEqual([['masc_1']]);
    ctl.reset();
    expect(audio.released).toBe(1);
  });

  it('sem serviço de áudio só há legenda e nada quebra', () => {
    const store = createTableStore();
    const ctl = createTableController({ store, send: () => true });
    ctl.applyState(snapshot());
    ctl.onEvent({ seq: 1, at: 1_000_000, event: truco });
    expect(store.getState().speech[1]?.event).toBe('truco'); // legenda sai mesmo sem serviço
  });
});
