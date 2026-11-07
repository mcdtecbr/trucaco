/**
 * Serviço de áudio da mesa: pré-carrega vozes e efeitos, toca sobreposto, aplica volumes separados e
 * "sem som", e persiste as preferências no aparelho. Não conhece `expo-audio`: fala com um `AudioBackend`
 * (a implementação real fica em `platform.*.ts`; os testes usam o falso de `fake.ts`).
 *
 * Regra de ouro: falha de áudio NUNCA derruba a mesa. Todo erro vira log e o jogo segue só com legenda.
 */
import { GAME_SFX_IDS, VOICE_EVENTS, resolveVoice, takesFor } from '@trucaco/avatar';
import type { AnySfxId, VoiceEvent } from '@trucaco/avatar';
import type { VoiceId } from '@trucaco/protocol';
import { DEFAULT_AUDIO_PREFS, createMemoryAudioPrefsStorage } from './prefs';
import type { AudioPrefs, AudioPrefsStorage } from './prefs';

/** Id do asset empacotado pelo Metro (o mesmo tipo do manifesto `@trucaco/avatar/audio`). */
export type AudioSource = number;

/** Um som carregado. `play` reinicia do começo; sons diferentes tocam sobrepostos. */
export interface AudioHandle {
  play(volume: number): void;
  release(): void;
}

export interface AudioBackend {
  load(source: AudioSource): Promise<AudioHandle>;
}

/** De onde vêm os arquivos: o manifesto real (`platform.*.ts`) ou um falso. */
export interface AudioSources {
  voice(voice: VoiceId, takeId: string): AudioSource | undefined;
  sfx(id: string): AudioSource | undefined;
}

export type SfxKind = 'game' | 'funny';

export interface AudioService {
  getPrefs(): AudioPrefs;
  setPrefs(patch: Partial<AudioPrefs>): void;
  subscribe(listener: (prefs: AudioPrefs) => void): () => void;
  /** Carrega as preferências guardadas (não sobrescreve o que o usuário mudou antes de terminar). */
  hydrate(): Promise<void>;
  /** Primeiro gesto do usuário (web): libera o autoplay. Antes disso nada toca. */
  unlock(): void;
  isUnlocked(): boolean;
  /**
   * Pré-carrega UM take por evento (o primeiro) das vozes presentes na mesa (cada uma passa por
   * `resolveVoice`). Esses ficam fixos; os demais takes entram sob demanda (`warmEvent`).
   */
  preloadVoices(voices: readonly VoiceId[]): Promise<void>;
  /** Pré-carrega efeitos (os de jogo, ou os que forem passados); os pedidos aqui ficam fixos. */
  preloadSfx(ids?: readonly AnySfxId[]): Promise<void>;
  /** O take dessa voz já está carregado (tocaria agora)? */
  isVoiceReady(voice: VoiceId, takeId: string): boolean;
  /** Carrega em segundo plano os outros takes do evento nessa voz (variação nas próximas vezes). */
  warmEvent(voice: VoiceId, event: VoiceEvent): void;
  /** Toca um take. `false` = não tocou (sem som, bloqueado, sem arquivo ou ainda carregando). */
  playVoice(voice: VoiceId, takeId: string): boolean;
  playSfx(id: AnySfxId, kind?: SfxKind): boolean;
  /** Solta tudo (saiu da mesa). */
  release(): void;
}

export interface AudioServiceOptions {
  backend: AudioBackend;
  sources: AudioSources;
  storage?: AudioPrefsStorage;
  /** Começa liberado (nativo). No web, o primeiro gesto chama `unlock()`. */
  unlocked?: boolean;
  /** Erros de áudio (o projeto proíbe `console.*` na UI): padrão ignora; o app pode injetar um destino. */
  onError?: (what: string, err: unknown) => void;
  /** Teto de players carregados sob demanda (fora os fixos do pré-carregamento). Padrão 12. */
  maxOnDemand?: number;
}

/**
 * Cada som carregado é um player nativo (um ExoPlayer no Android). Fixos: 1 take por evento por voz
 * presente (13 x 2) + 3 efeitos de jogo + 8 do soundboard (quem está sentado) = 37. Sob demanda (outros takes) vale um LRU de 12.
 */
export const DEFAULT_MAX_ON_DEMAND = 12;

function clamp(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

function applyPatch(base: AudioPrefs, patch: Partial<AudioPrefs>): AudioPrefs {
  return {
    muted: patch.muted ?? base.muted,
    voiceVolume: clamp(patch.voiceVolume ?? base.voiceVolume),
    sfxVolume: clamp(patch.sfxVolume ?? base.sfxVolume),
    funnyMuted: patch.funnyMuted ?? base.funnyMuted,
  };
}

/** Serviço sem som (mesa sem áudio injetado): tudo é no-op, a legenda continua saindo no controlador. */
export function createSilentAudioService(): AudioService {
  let prefs: AudioPrefs = DEFAULT_AUDIO_PREFS;
  return {
    getPrefs: () => prefs,
    setPrefs(patch) {
      prefs = applyPatch(prefs, patch);
    },
    subscribe: () => () => undefined,
    hydrate: () => Promise.resolve(),
    unlock: () => undefined,
    isUnlocked: () => false,
    preloadVoices: () => Promise.resolve(),
    preloadSfx: () => Promise.resolve(),
    isVoiceReady: () => false,
    warmEvent: () => undefined,
    playVoice: () => false,
    playSfx: () => false,
    release: () => undefined,
  };
}

export function createAudioService(opts: AudioServiceOptions): AudioService {
  const { backend, sources } = opts;
  const storage = opts.storage ?? createMemoryAudioPrefsStorage();
  const onError = opts.onError ?? (() => undefined);
  let prefs: AudioPrefs = DEFAULT_AUDIO_PREFS;
  /** Mudanças feitas antes de o `hydrate` terminar: entram SOBRE o valor salvo, não sobre o padrão. */
  let pending: Partial<AudioPrefs> | null = null;
  let unlocked = opts.unlocked ?? false;
  const maxOnDemand = Math.max(0, opts.maxOnDemand ?? DEFAULT_MAX_ON_DEMAND);
  /** `release()` invalida cargas em voo (não vazam handles). */
  let generation = 0;
  /** A ordem de inserção é a de uso (`play` reinsere): o primeiro não fixo é o menos recente. */
  const loaded = new Map<string, AudioHandle>();
  const pinned = new Set<string>();
  const loading = new Map<string, Promise<void>>();
  const failed = new Set<string>();
  const listeners = new Set<(p: AudioPrefs) => void>();

  function evict(): void {
    let onDemand = 0;
    for (const k of loaded.keys()) if (!pinned.has(k)) onDemand += 1;
    for (const [k, h] of loaded) {
      if (onDemand <= maxOnDemand) break;
      if (pinned.has(k)) continue;
      loaded.delete(k);
      onDemand -= 1;
      try {
        h.release();
      } catch (err) {
        onError('falha ao liberar', err);
      }
    }
  }

  function load(key: string, source: AudioSource | undefined, pin = false): Promise<void> {
    if (pin && source !== undefined) pinned.add(key);
    if (source === undefined || loaded.has(key) || failed.has(key)) return Promise.resolve();
    const inFlight = loading.get(key);
    if (inFlight !== undefined) return inFlight;
    const gen = generation;
    const p = (async () => {
      try {
        const handle = await backend.load(source);
        if (gen !== generation) handle.release();
        else {
          loaded.set(key, handle);
          evict();
        }
      } catch (err) {
        failed.add(key);
        onError(`falha ao carregar ${key}`, err);
      } finally {
        if (gen === generation) loading.delete(key);
      }
    })();
    loading.set(key, p);
    return p;
  }

  function play(key: string, source: AudioSource | undefined, volume: number): boolean {
    if (prefs.muted || !unlocked || volume <= 0) return false;
    const handle = loaded.get(key);
    if (handle === undefined) {
      // Ainda não carregou: tenta para a próxima vez e segue só com a legenda.
      void load(key, source);
      return false;
    }
    loaded.delete(key); // reinsere: vira o mais recente do LRU
    loaded.set(key, handle);
    try {
      handle.play(volume);
      return true;
    } catch (err) {
      onError(`falha ao tocar ${key}`, err);
      return false;
    }
  }

  return {
    getPrefs: () => prefs,
    setPrefs(patch) {
      prefs = applyPatch(prefs, patch);
      if (pending !== null)
        pending = { ...pending, ...patch }; // o `hydrate` grava o resultado final
      else void storage.save(prefs);
      for (const l of listeners) l(prefs);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async hydrate() {
      pending = {}; // a partir daqui as mudanças ficam anotadas até a leitura terminar
      const saved = await storage.load().catch(() => prefs);
      // O que o usuário mexeu enquanto lia o armazenamento vale sobre o salvo (e o resto fica como salvo).
      const mine = pending ?? {};
      pending = null;
      prefs = applyPatch(saved, mine);
      // Durante a leitura o `setPrefs` não grava (apagaria o salvo com "padrão + mudança"): grava agora.
      if (Object.keys(mine).length > 0) void storage.save(prefs);
      for (const l of listeners) l(prefs);
    },
    unlock() {
      unlocked = true;
    },
    isUnlocked: () => unlocked,

    async preloadVoices(voices) {
      const jobs: Promise<void>[] = [];
      for (const raw of new Set(voices)) {
        const voice = resolveVoice(raw);
        if (voice === null) continue;
        for (const event of VOICE_EVENTS) {
          const first = takesFor(event)[0];
          if (first === undefined) continue;
          jobs.push(load(`v:${voice}:${first.id}`, sources.voice(voice, first.id), true));
        }
      }
      await Promise.all(jobs);
    },
    async preloadSfx(ids = GAME_SFX_IDS) {
      await Promise.all(ids.map((id) => load(`s:${id}`, sources.sfx(id), true)));
    },
    isVoiceReady(voice, takeId) {
      const resolved = resolveVoice(voice);
      return resolved !== null && loaded.has(`v:${resolved}:${takeId}`);
    },
    warmEvent(voice, event) {
      const resolved = resolveVoice(voice);
      if (resolved === null) return;
      for (const t of takesFor(event)) {
        void load(`v:${resolved}:${t.id}`, sources.voice(resolved, t.id));
      }
    },

    playVoice(voice, takeId) {
      const resolved = resolveVoice(voice);
      if (resolved === null) return false;
      return play(`v:${resolved}:${takeId}`, sources.voice(resolved, takeId), prefs.voiceVolume);
    },
    playSfx(id, kind = 'game') {
      if (kind === 'funny' && prefs.funnyMuted) return false;
      return play(`s:${id}`, sources.sfx(id), prefs.sfxVolume);
    },

    release() {
      generation += 1;
      for (const h of loaded.values()) {
        try {
          h.release();
        } catch (err) {
          onError('falha ao liberar', err);
        }
      }
      loaded.clear();
      pinned.clear();
      loading.clear();
      failed.clear();
    },
  };
}
