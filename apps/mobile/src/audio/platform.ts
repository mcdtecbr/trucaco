/**
 * Resolução padrão (testes, SSR, typecheck): sem som real. O Metro troca por `platform.web.ts` ou
 * `platform.native.ts`. Mesmo padrão de `platform/mutedStorage*.ts`.
 */
import { createMemoryAudioPrefsStorage } from './prefs';
import type { AudioPrefsStorage } from './prefs';
import type { AudioBackend, AudioSources } from './audioService';

export interface PlatformAudio {
  readonly backend: AudioBackend;
  readonly sources: AudioSources;
  readonly storage: AudioPrefsStorage;
  /** Nativo: já liberado. Web: espera o primeiro gesto (`watchFirstGesture`). */
  readonly unlocked: boolean;
  /** Web: chama `unlock` no primeiro gesto do usuário. Nativo e testes: não faz nada. */
  watchFirstGesture(unlock: () => void): void;
}

export function createPlatformAudio(): PlatformAudio {
  return {
    backend: { load: () => Promise.resolve({ play: () => undefined, release: () => undefined }) },
    sources: { voice: () => undefined, sfx: () => undefined },
    storage: createMemoryAudioPrefsStorage(),
    unlocked: true,
    watchFirstGesture: () => undefined,
  };
}
