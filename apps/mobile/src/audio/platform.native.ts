/** iOS e Android: `expo-audio`, preferências em `expo-secure-store` (já dependência do app). */
import * as SecureStore from 'expo-secure-store';
import { expoAudioBackend } from './expoBackend';
import { manifestSources } from './manifestSources';
import {
  AUDIO_PREFS_KEY,
  parseAudioPrefs,
  safeAudioPrefsStorage,
  serializeAudioPrefs,
} from './prefs';
import type { AudioPrefsStorage } from './prefs';
import type { PlatformAudio } from './platform';

export type { PlatformAudio } from './platform';

const secure: AudioPrefsStorage = {
  load: async () => parseAudioPrefs(await SecureStore.getItemAsync(AUDIO_PREFS_KEY)),
  save: (p) => SecureStore.setItemAsync(AUDIO_PREFS_KEY, serializeAudioPrefs(p)),
};

export function createPlatformAudio(): PlatformAudio {
  return {
    backend: expoAudioBackend,
    sources: manifestSources,
    storage: safeAudioPrefsStorage(secure),
    unlocked: true,
    watchFirstGesture: () => undefined,
  };
}
