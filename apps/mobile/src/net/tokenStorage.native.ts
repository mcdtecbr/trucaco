/** iOS e Android: refresh token no Keychain/Keystore via `expo-secure-store`. */
import * as SecureStore from 'expo-secure-store';
import {
  STORAGE_KEY,
  parseStoredSession,
  serializeSession,
  withMemoryFallback,
} from './tokenStorageCore';
import type { TokenStorage } from './tokenStorageCore';

export * from './tokenStorageCore';

const secure: TokenStorage = {
  load: async () => parseStoredSession(await SecureStore.getItemAsync(STORAGE_KEY)),
  save: (s) => SecureStore.setItemAsync(STORAGE_KEY, serializeSession(s)),
  clear: () => SecureStore.deleteItemAsync(STORAGE_KEY),
};

export function createTokenStorage(): TokenStorage {
  return withMemoryFallback(secure);
}
