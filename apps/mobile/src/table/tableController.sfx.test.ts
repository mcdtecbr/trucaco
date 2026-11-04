import { describe, expect, it } from 'vitest';
import type { ClientMessage } from '@trucaco/protocol';
import { createFakeAudioService } from '../audio/fake';
import { priv, snapshot } from './snapshotFixtures';
import { SFX_MARK_MS, createTableController } from './tableController';
import { createTableStore } from './tableStore';

function setup(muted: string[] = [], sendOk = true) {
  const store = createTableStore();
  const audio = createFakeAudioService();
  const sent: ClientMessage[] = [];
  const said: string[] = [];
  const timers: Array<{ fn: () => void; ms: number; live: boolean }> = [];
  const ctl = createTableController({
    store,
    send: (m) => {
      sent.push(m);
      return sendOk;
    },
    audio,
    isMuted: (n) => muted.includes(n.toLowerCase()),
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
  ctl.setAnnouncer((m) => said.push(m));
  ctl.applyState(snapshot({ privates: priv(0) }));
  const fire = (ms: number) =>
    timers.forEach((t) => {
      if (t.live && t.ms === ms) {
        t.live = false;
        t.fn();
      }
    });
  return { store, ctl, audio, sent, said, fire };
}

const funnyCalls = (a: ReturnType<typeof setup>['audio']) =>
  a.calls.filter((c) => c.kind === 'sfx' && c.sfxKind === 'funny');

describe('enviar efeito', () => {
  it('id do catálogo sai como `sfx { sfxId }`; id desconhecido nem sai', () => {
    const { ctl, sent } = setup();
    expect(ctl.sendSfx('horn')).toBe(true);
    expect(ctl.sendSfx('nope')).toBe(false);
    expect(ctl.sendSfx('card_play')).toBe(false); // efeito de jogo é local, não vai ao servidor
    expect(sent).toEqual([{ type: 'sfx', sfxId: 'horn' }]);
  });

  it('sem sala: false e nada toca (o som só vem do eco do servidor)', () => {
    const { ctl, audio } = setup([], false);
    expect(ctl.sendSfx('horn')).toBe(false);
    expect(audio.calls).toEqual([]);
  });
});

describe('receber efeito', () => {
  it('toca como engraçado, mostra o emoji por 1,5 s e anuncia', () => {
    const { store, ctl, audio, said, fire } = setup();
    ctl.onSfx({ seat: 1, sfxId: 'sad_trombone', at: 1 });
    expect(audio.calls).toEqual([{ kind: 'sfx', id: 'sad_trombone', sfxKind: 'funny' }]);
    expect(store.getState().sfxMarks[1]?.label).toBe('Trombone triste');
    expect(store.getState().sfxMarks[1]?.icon).toBeTruthy();
    expect(said).toContain('Bia usou o efeito Trombone triste');
    fire(SFX_MARK_MS);
    expect(store.getState().sfxMarks[1]).toBeUndefined();
  });

  it('o meu próprio efeito também toca (vem pelo servidor)', () => {
    const { store, ctl, audio, said } = setup();
    const mine = store.getState().vm?.mySeat ?? -1;
    expect(mine).toBeGreaterThanOrEqual(0);
    ctl.onSfx({ seat: mine, sfxId: 'horn', at: 1 });
    expect(funnyCalls(audio)).toHaveLength(1);
    expect(said[0]).toBe('Você usou o efeito Buzina');
  });

  it('id ou assento inválido é ignorado', () => {
    const { store, ctl, audio, said } = setup();
    for (const bad of [
      { seat: 1, sfxId: 'nope' },
      { seat: 1, sfxId: 'card_play' },
      { seat: 4, sfxId: 'horn' },
      { seat: -1, sfxId: 'horn' },
      { seat: 1.5, sfxId: 'horn' },
      { seat: '1', sfxId: 'horn' },
      { seat: 1 },
      null,
      'horn',
      42,
    ]) {
      ctl.onSfx(bad);
    }
    expect(audio.calls).toEqual([]);
    expect(said).toEqual([]);
    expect(store.getState().sfxMarks).toEqual({});
  });

  it('jogador silenciado neste aparelho: sem som, sem emoji, sem anúncio', () => {
    const { store, ctl, audio, said } = setup(['bia']);
    ctl.onSfx({ seat: 1, sfxId: 'horn', at: 1 });
    expect(audio.calls).toEqual([]);
    expect(said).toEqual([]);
    expect(store.getState().sfxMarks[1]).toBeUndefined();
    ctl.onSfx({ seat: 2, sfxId: 'horn', at: 1 }); // Caio não está silenciado
    expect(funnyCalls(audio)).toHaveLength(1);
  });

  it('"silenciar efeitos engraçados" e "sem som": não toca, mas a legenda e o anúncio continuam', () => {
    const { store, ctl, audio, said } = setup();
    audio.setPrefs({ funnyMuted: true });
    ctl.onSfx({ seat: 2, sfxId: 'laugh', at: 1 });
    expect(audio.calls).toEqual([]);
    expect(store.getState().sfxMarks[2]?.label).toBe('Risada');
    audio.setPrefs({ funnyMuted: false, muted: true });
    ctl.onSfx({ seat: 3, sfxId: 'clap', at: 1 });
    expect(audio.calls).toEqual([]);
    expect(store.getState().sfxMarks[3]?.label).toBe('Palmas');
    expect(said).toHaveLength(2);
  });

  it('dois efeitos seguidos no mesmo assento: o emoji novo reinicia o tempo', () => {
    const { store, ctl, fire } = setup();
    ctl.onSfx({ seat: 1, sfxId: 'horn', at: 1 });
    const first = store.getState().sfxMarks[1]?.id;
    ctl.onSfx({ seat: 1, sfxId: 'clap', at: 2 });
    expect(store.getState().sfxMarks[1]?.id).not.toBe(first);
    fire(SFX_MARK_MS);
    expect(store.getState().sfxMarks[1]).toBeUndefined();
  });

  it('reset limpa os emojis', () => {
    const { store, ctl } = setup();
    ctl.onSfx({ seat: 1, sfxId: 'horn', at: 1 });
    ctl.reset();
    expect(store.getState().sfxMarks).toEqual({});
  });

  it('sem serviço de áudio (omitido) só mostra a legenda e não quebra', () => {
    const store = createTableStore();
    const ctl = createTableController({ store, send: () => true });
    ctl.applyState(snapshot({ privates: priv(0) }));
    expect(() => ctl.onSfx({ seat: 1, sfxId: 'horn', at: 1 })).not.toThrow();
    expect(store.getState().sfxMarks[1]).toBeDefined();
  });
});
