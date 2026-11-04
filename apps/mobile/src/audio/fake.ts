/** Falsos para testes: nada toca, tudo é registrado. */
import type { AnySfxId } from '@trucaco/avatar';
import type { VoiceId } from '@trucaco/protocol';
import { DEFAULT_AUDIO_PREFS } from './prefs';
import type { AudioPrefs } from './prefs';
import type {
  AudioBackend,
  AudioHandle,
  AudioService,
  AudioSources,
  SfxKind,
} from './audioService';

export interface FakePlay {
  readonly source: number;
  readonly volume: number;
}

/** Backend falso: cada `load` devolve um handle que registra `play` e `release`. */
export interface FakeBackend extends AudioBackend {
  readonly loads: number[];
  readonly plays: FakePlay[];
  readonly released: number[];
  /** Fontes cujo `load` falha. */
  readonly failOn: Set<number>;
  /** Fontes cujo `play` lança. */
  readonly throwOnPlay: Set<number>;
}

export function createFakeBackend(): FakeBackend {
  const b: FakeBackend = {
    loads: [],
    plays: [],
    released: [],
    failOn: new Set(),
    throwOnPlay: new Set(),
    load(source) {
      b.loads.push(source);
      if (b.failOn.has(source)) return Promise.reject(new Error(`falha ${source}`));
      const handle: AudioHandle = {
        play(volume) {
          if (b.throwOnPlay.has(source)) throw new Error(`play ${source}`);
          b.plays.push({ source, volume });
        },
        release() {
          b.released.push(source);
        },
      };
      return Promise.resolve(handle);
    },
  };
  return b;
}

/** Manifesto falso: o id numérico do asset é derivado do texto, estável dentro do teste. */
export function createFakeSources(
  voices: readonly VoiceId[] = ['masc_1', 'fem_1'],
): AudioSources & {
  readonly idOf: (key: string) => number;
} {
  const ids = new Map<string, number>();
  const idOf = (key: string): number => {
    let n = ids.get(key);
    if (n === undefined) {
      n = ids.size + 1;
      ids.set(key, n);
    }
    return n;
  };
  return {
    idOf,
    voice: (voice, takeId) => (voices.includes(voice) ? idOf(`v:${voice}:${takeId}`) : undefined),
    sfx: (id) => idOf(`s:${id}`),
  };
}

export type FakeCall =
  | { readonly kind: 'voice'; readonly voice: VoiceId; readonly takeId: string }
  | { readonly kind: 'sfx'; readonly id: string; readonly sfxKind: SfxKind };

/** Serviço falso (para o controlador e o diretor de fala): grava chamadas, não toca. */
export interface FakeAudioService extends AudioService {
  readonly calls: FakeCall[];
  readonly preloaded: VoiceId[][];
  sfxPreloads: number;
  released: number;
  /** Chamadas de `warmEvent`. */
  readonly warmed: Array<[VoiceId, string]>;
  /** `null` = todo take está pronto; ou o conjunto `voz:take` dos prontos. */
  ready: Set<string> | null;
}

export function createFakeAudioService(initial: Partial<AudioPrefs> = {}): FakeAudioService {
  let prefs: AudioPrefs = { ...DEFAULT_AUDIO_PREFS, ...initial };
  let unlocked = true;
  const listeners = new Set<(p: AudioPrefs) => void>();
  const s: FakeAudioService = {
    calls: [],
    preloaded: [],
    sfxPreloads: 0,
    released: 0,
    warmed: [],
    ready: null,
    getPrefs: () => prefs,
    setPrefs(patch) {
      prefs = { ...prefs, ...patch };
      for (const l of listeners) l(prefs);
    },
    subscribe(l) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    hydrate: () => Promise.resolve(),
    unlock() {
      unlocked = true;
    },
    isUnlocked: () => unlocked,
    preloadVoices(voices) {
      s.preloaded.push([...voices]);
      return Promise.resolve();
    },
    preloadSfx() {
      s.sfxPreloads += 1;
      return Promise.resolve();
    },
    isVoiceReady: (voice, takeId) => s.ready === null || s.ready.has(`${voice}:${takeId}`),
    warmEvent(voice, event) {
      s.warmed.push([voice, event]);
    },
    playVoice(voice, takeId) {
      if (prefs.muted) return false;
      s.calls.push({ kind: 'voice', voice, takeId });
      return true;
    },
    playSfx(id: AnySfxId, kind: SfxKind = 'game') {
      if (prefs.muted || (kind === 'funny' && prefs.funnyMuted)) return false;
      s.calls.push({ kind: 'sfx', id, sfxKind: kind });
      return true;
    },
    release() {
      s.released += 1;
    },
  };
  return s;
}
