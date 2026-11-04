/**
 * Preferências de som deste aparelho. Ficam só aqui: nunca vão ao servidor nem à conta. Implementações
 * de armazenamento por plataforma em `platform.web.ts` (localStorage) e `platform.native.ts`
 * (expo-secure-store, já dependência do app); `platform.ts` (memória) serve a testes e ao typecheck.
 */
export interface AudioPrefs {
  /** "Sem som" geral: nada toca (vozes e efeitos). A legenda continua. */
  readonly muted: boolean;
  /** Volume das vozes dos avatares, 0 a 1. */
  readonly voiceVolume: number;
  /** Volume dos efeitos (jogo e engraçados), 0 a 1. */
  readonly sfxVolume: number;
  /** Silenciar só os efeitos engraçados do painel (etapa 2B); efeitos de jogo seguem. */
  readonly funnyMuted: boolean;
}

export const DEFAULT_AUDIO_PREFS: AudioPrefs = {
  muted: false,
  voiceVolume: 1,
  sfxVolume: 0.8,
  funnyMuted: false,
};

export const AUDIO_PREFS_KEY = 'trucaco.audio.v1';

export interface AudioPrefsStorage {
  load(): Promise<AudioPrefs>;
  save(prefs: AudioPrefs): Promise<void>;
}

export function clampVolume(v: unknown, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(1, Math.max(0, v));
}

/** Aceita só campos válidos; o resto (corrompido, adulterado) cai no padrão. */
export function parseAudioPrefs(raw: string | null | undefined): AudioPrefs {
  if (raw === null || raw === undefined || raw === '') return DEFAULT_AUDIO_PREFS;
  try {
    const x: unknown = JSON.parse(raw);
    if (typeof x !== 'object' || x === null || Array.isArray(x)) return DEFAULT_AUDIO_PREFS;
    const r = x as Record<string, unknown>;
    const d = DEFAULT_AUDIO_PREFS;
    return {
      muted: typeof r['muted'] === 'boolean' ? r['muted'] : d.muted,
      voiceVolume: clampVolume(r['voiceVolume'], d.voiceVolume),
      sfxVolume: clampVolume(r['sfxVolume'], d.sfxVolume),
      funnyMuted: typeof r['funnyMuted'] === 'boolean' ? r['funnyMuted'] : d.funnyMuted,
    };
  } catch {
    return DEFAULT_AUDIO_PREFS;
  }
}

export function serializeAudioPrefs(p: AudioPrefs): string {
  return JSON.stringify({
    muted: p.muted,
    voiceVolume: clampVolume(p.voiceVolume, DEFAULT_AUDIO_PREFS.voiceVolume),
    sfxVolume: clampVolume(p.sfxVolume, DEFAULT_AUDIO_PREFS.sfxVolume),
    funnyMuted: p.funnyMuted,
  });
}

export function createMemoryAudioPrefsStorage(initial?: AudioPrefs): AudioPrefsStorage {
  let current = initial ?? DEFAULT_AUDIO_PREFS;
  return {
    load: () => Promise.resolve(current),
    save: (p) => {
      current = p;
      return Promise.resolve();
    },
  };
}

/** Falha do armazenamento (modo privado, Keychain bloqueado) nunca lança: a preferência vale só na sessão. */
export function safeAudioPrefsStorage(primary: AudioPrefsStorage): AudioPrefsStorage {
  return {
    load: async () => {
      try {
        return await primary.load();
      } catch {
        return DEFAULT_AUDIO_PREFS;
      }
    },
    save: async (p) => {
      try {
        await primary.save(p);
      } catch {
        // Nada a fazer.
      }
    },
  };
}
