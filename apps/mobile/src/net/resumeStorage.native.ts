/** iOS e Android: token de reconexão no Keychain/Keystore via `expo-secure-store`. */
import * as SecureStore from 'expo-secure-store';
import {
  RESUME_KEY,
  parseResume,
  serializeResume,
  withResumeMemoryFallback,
} from './resumeStorageCore';
import type { ResumeStorage } from './resumeStorageCore';

export * from './resumeStorageCore';

const secure: ResumeStorage = {
  load: async () => parseResume(await SecureStore.getItemAsync(RESUME_KEY)),
  save: (r) => SecureStore.setItemAsync(RESUME_KEY, serializeResume(r)),
  clear: () => SecureStore.deleteItemAsync(RESUME_KEY),
};

export function createResumeStorage(): ResumeStorage {
  return withResumeMemoryFallback(secure);
}
