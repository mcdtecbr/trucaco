/** iOS e Android: `expo-secure-store` (já usado pelo app; evita biblioteca nova para uma lista curta). */
import * as SecureStore from 'expo-secure-store';
import { MUTED_KEY, parseMuted, safeMutedStorage, serializeMuted } from './mutedStorageCore';
import type { MutedStorage } from './mutedStorageCore';

export * from './mutedStorageCore';

const secure: MutedStorage = {
  load: async () => parseMuted(await SecureStore.getItemAsync(MUTED_KEY)),
  save: (names) => SecureStore.setItemAsync(MUTED_KEY, serializeMuted(names)),
};

export function createMutedStorage(): MutedStorage {
  return safeMutedStorage(secure);
}
