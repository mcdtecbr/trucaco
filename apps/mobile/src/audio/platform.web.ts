/** Web: `expo-audio` (HTMLAudio), preferências em `localStorage`, desbloqueio no primeiro gesto. */
import { expoAudioBackend } from './expoBackend';
import { manifestSources } from './manifestSources';
import {
  AUDIO_PREFS_KEY,
  parseAudioPrefs,
  safeAudioPrefsStorage,
  serializeAudioPrefs,
} from './prefs';
import type { AudioPrefsStorage } from './prefs';
import { unlockOnFirstGesture } from './unlockOnGesture';
import type { PlatformAudio } from './platform';

export type { PlatformAudio } from './platform';

const local: AudioPrefsStorage = {
  load: () => Promise.resolve(parseAudioPrefs(globalThis.localStorage.getItem(AUDIO_PREFS_KEY))),
  save: (p) => {
    globalThis.localStorage.setItem(AUDIO_PREFS_KEY, serializeAudioPrefs(p));
    return Promise.resolve();
  },
};

export function createPlatformAudio(): PlatformAudio {
  return {
    backend: expoAudioBackend,
    sources: manifestSources,
    storage: safeAudioPrefsStorage(local),
    unlocked: false,
    watchFirstGesture(unlock) {
      if (typeof document === 'undefined') {
        unlock();
        return;
      }
      unlockOnFirstGesture(document, unlock);
    },
  };
}
