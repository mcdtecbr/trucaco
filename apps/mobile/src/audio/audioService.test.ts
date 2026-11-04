import { describe, expect, it, vi } from 'vitest';
import { GAME_SFX_IDS, VOICE_EVENTS } from '@trucaco/avatar';
import { createAudioService, createSilentAudioService } from './audioService';
import type { AudioService } from './audioService';
import { createFakeBackend, createFakeSources } from './fake';
import {
  DEFAULT_AUDIO_PREFS,
  createMemoryAudioPrefsStorage,
  parseAudioPrefs,
  safeAudioPrefsStorage,
  serializeAudioPrefs,
} from './prefs';

function setup(
  over: { unlocked?: boolean; storage?: ReturnType<typeof createMemoryAudioPrefsStorage> } = {},
) {
  const backend = createFakeBackend();
  const sources = createFakeSources();
  const errors: string[] = [];
  const audio = createAudioService({
    backend,
    sources,
    unlocked: over.unlocked ?? true,
    ...(over.storage !== undefined ? { storage: over.storage } : {}),
    onError: (what) => errors.push(what),
  });
  return { backend, sources, audio, errors };
}

async function ready(audio: AudioService) {
  await audio.preloadVoices(['masc_1']);
  await audio.preloadSfx();
}

describe('pré-carregamento', () => {
  it('carrega só um take por evento das vozes presentes (com fallback por grupo) e os efeitos de jogo', async () => {
    const { backend, audio } = setup();
    await audio.preloadVoices(['masc_3', 'masc_1', 'fem_2']);
    // masc_3 -> masc_1 (já pedida), fem_2 -> fem_1: duas vozes, 1 take por evento, sem duplicar.
    expect(backend.loads).toHaveLength(VOICE_EVENTS.length * 2);
    await audio.preloadSfx();
    expect(backend.loads).toHaveLength(VOICE_EVENTS.length * 2 + GAME_SFX_IDS.length);
    await audio.preloadSfx();
    expect(backend.loads).toHaveLength(VOICE_EVENTS.length * 2 + GAME_SFX_IDS.length);
  });

  it('warmEvent carrega os outros takes do evento; isVoiceReady reflete o carregado', async () => {
    const { backend, audio } = setup();
    await audio.preloadVoices(['masc_1']);
    expect(audio.isVoiceReady('masc_1', 'truco_1')).toBe(true);
    expect(audio.isVoiceReady('masc_1', 'truco_2')).toBe(false);
    audio.warmEvent('masc_1', 'truco');
    await vi.waitFor(() => expect(audio.isVoiceReady('masc_1', 'truco_5')).toBe(true));
    expect(backend.loads).toHaveLength(VOICE_EVENTS.length + 4);
  });

  it('sob demanda tem teto (LRU); os fixos do pré-carregamento nunca saem', async () => {
    const backend = createFakeBackend();
    const audio = createAudioService({
      backend,
      sources: createFakeSources(),
      unlocked: true,
      maxOnDemand: 3,
    });
    await audio.preloadVoices(['masc_1']);
    audio.warmEvent('masc_1', 'truco'); // +4 sob demanda: o teto de 3 solta o mais antigo
    audio.warmEvent('masc_1', 'seis'); // +3
    await vi.waitFor(() => expect(audio.isVoiceReady('masc_1', 'seis_4')).toBe(true));
    const alive = backend.loads.length - backend.released.length;
    expect(alive).toBe(VOICE_EVENTS.length + 3);
    for (const e of VOICE_EVENTS) {
      expect(audio.isVoiceReady('masc_1', `${e}_1`)).toBe(true);
    }
  });

  it('serviço silencioso: nada toca e nada quebra', async () => {
    const audio = createSilentAudioService();
    await audio.preloadVoices(['masc_1']);
    expect(audio.playVoice('masc_1', 'truco_1')).toBe(false);
    expect(audio.playSfx('card_play')).toBe(false);
    expect(() => audio.release()).not.toThrow();
  });

  it('voz sem arquivo no grupo: não carrega nada e não toca', async () => {
    const backend = createFakeBackend();
    const audio = createAudioService({ backend, sources: createFakeSources([]), unlocked: true });
    await audio.preloadVoices(['masc_1']);
    expect(backend.loads).toHaveLength(0);
    expect(audio.playVoice('masc_1', 'truco_1')).toBe(false);
  });

  it('falha de carregamento não lança, vira log e o resto segue', async () => {
    const { backend, sources, audio, errors } = setup();
    backend.failOn.add(sources.idOf('s:card_play'));
    await expect(audio.preloadSfx()).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
    expect(audio.playSfx('card_play')).toBe(false);
    expect(audio.playSfx('table_slam')).toBe(true);
  });

  it('release solta tudo e descarta carga em voo', async () => {
    const { backend, audio } = setup();
    const p = audio.preloadSfx();
    audio.release();
    await p;
    expect(backend.released).toHaveLength(GAME_SFX_IDS.length);
    expect(audio.playSfx('card_play')).toBe(false);
  });
});

describe('tocar', () => {
  it('toca sobreposto com volumes separados (voz e efeito)', async () => {
    const { backend, sources, audio } = setup();
    await ready(audio);
    audio.setPrefs({ voiceVolume: 0.5, sfxVolume: 0.25 });
    expect(audio.playVoice('masc_1', 'truco_1')).toBe(true);
    expect(audio.playSfx('table_slam')).toBe(true);
    expect(audio.playVoice('masc_1', 'quero_1')).toBe(true);
    expect(backend.plays).toEqual([
      { source: sources.idOf('v:masc_1:truco_1'), volume: 0.5 },
      { source: sources.idOf('s:table_slam'), volume: 0.25 },
      { source: sources.idOf('v:masc_1:quero_1'), volume: 0.5 },
    ]);
  });

  it('voz sem arquivo toca a do mesmo grupo (resolveVoice)', async () => {
    const { backend, sources, audio } = setup();
    await ready(audio);
    expect(audio.playVoice('masc_3', 'truco_1')).toBe(true);
    expect(backend.plays[0]?.source).toBe(sources.idOf('v:masc_1:truco_1'));
  });

  it('sem som geral: nada toca; voltando, toca', async () => {
    const { backend, audio } = setup();
    await ready(audio);
    audio.setPrefs({ muted: true });
    expect(audio.playVoice('masc_1', 'truco_1')).toBe(false);
    expect(audio.playSfx('card_play')).toBe(false);
    audio.setPrefs({ muted: false });
    expect(audio.playSfx('card_play')).toBe(true);
    expect(backend.plays).toHaveLength(1);
  });

  it('volume 0 não toca', async () => {
    const { audio } = setup();
    await ready(audio);
    audio.setPrefs({ voiceVolume: 0 });
    expect(audio.playVoice('masc_1', 'truco_1')).toBe(false);
  });

  it('silenciar efeitos engraçados não cala os efeitos de jogo', async () => {
    const { audio } = setup();
    await audio.preloadSfx(['card_play', 'horn']);
    audio.setPrefs({ funnyMuted: true });
    expect(audio.playSfx('horn', 'funny')).toBe(false);
    expect(audio.playSfx('card_play')).toBe(true);
    audio.setPrefs({ funnyMuted: false });
    expect(audio.playSfx('horn', 'funny')).toBe(true);
  });

  it('ainda carregando: não toca (só legenda) e carrega para a próxima', async () => {
    const { backend, audio } = setup();
    expect(audio.playSfx('card_play')).toBe(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(backend.loads).toHaveLength(1);
    expect(audio.playSfx('card_play')).toBe(true);
  });

  it('play que lança é engolido', async () => {
    const { backend, sources, audio, errors } = setup();
    await ready(audio);
    backend.throwOnPlay.add(sources.idOf('s:card_play'));
    expect(audio.playSfx('card_play')).toBe(false);
    expect(errors.some((e) => e.includes('tocar'))).toBe(true);
  });
});

describe('desbloqueio (web)', () => {
  it('bloqueado antes do primeiro gesto; libera depois', async () => {
    const { audio } = setup({ unlocked: false });
    await ready(audio);
    expect(audio.isUnlocked()).toBe(false);
    expect(audio.playSfx('card_play')).toBe(false);
    audio.unlock();
    expect(audio.isUnlocked()).toBe(true);
    expect(audio.playSfx('card_play')).toBe(true);
  });
});

describe('preferências persistidas', () => {
  it('grava a cada mudança e volta no próximo aparelho aberto', async () => {
    const storage = createMemoryAudioPrefsStorage();
    const a = setup({ storage });
    a.audio.setPrefs({ muted: true, voiceVolume: 0.3, funnyMuted: true });
    await Promise.resolve();
    const b = setup({ storage });
    await b.audio.hydrate();
    expect(b.audio.getPrefs()).toEqual({
      muted: true,
      voiceVolume: 0.3,
      sfxVolume: DEFAULT_AUDIO_PREFS.sfxVolume,
      funnyMuted: true,
    });
  });

  it('hydrate aplica o que o usuário mudou antes de terminar SOBRE o valor salvo', async () => {
    const storage = createMemoryAudioPrefsStorage({
      ...DEFAULT_AUDIO_PREFS,
      muted: true,
      funnyMuted: true,
    });
    const { audio } = setup({ storage });
    const hydrating = audio.hydrate();
    audio.setPrefs({ sfxVolume: 0.1 });
    await hydrating;
    expect(audio.getPrefs().sfxVolume).toBe(0.1); // a mudança do usuário vence
    expect(audio.getPrefs().muted).toBe(true); // o resto vem do salvo, não do padrão
    expect(audio.getPrefs().funnyMuted).toBe(true);
    await Promise.resolve();
    expect(await storage.load()).toEqual(audio.getPrefs()); // e o armazenamento ficou certo
  });

  it('avisa os assinantes e limita o volume a 0..1', () => {
    const { audio } = setup();
    const seen = vi.fn();
    const off = audio.subscribe(seen);
    audio.setPrefs({ voiceVolume: 7, sfxVolume: -2 });
    expect(audio.getPrefs().voiceVolume).toBe(1);
    expect(audio.getPrefs().sfxVolume).toBe(0);
    off();
    audio.setPrefs({ muted: true });
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('valor corrompido ou adulterado cai no padrão; falha do armazenamento não lança', async () => {
    expect(parseAudioPrefs('lixo')).toEqual(DEFAULT_AUDIO_PREFS);
    expect(parseAudioPrefs('[1]')).toEqual(DEFAULT_AUDIO_PREFS);
    expect(parseAudioPrefs('{"muted":"sim","voiceVolume":9,"sfxVolume":"x"}')).toEqual({
      ...DEFAULT_AUDIO_PREFS,
      voiceVolume: 1,
    });
    expect(
      parseAudioPrefs(serializeAudioPrefs({ ...DEFAULT_AUDIO_PREFS, muted: true })).muted,
    ).toBe(true);
    const broken = safeAudioPrefsStorage({
      load: () => Promise.reject(new Error('x')),
      save: () => Promise.reject(new Error('x')),
    });
    await expect(broken.load()).resolves.toEqual(DEFAULT_AUDIO_PREFS);
    await expect(broken.save(DEFAULT_AUDIO_PREFS)).resolves.toBeUndefined();
  });
});
