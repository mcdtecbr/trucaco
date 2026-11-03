/** Web: `localStorage` (preferência do aparelho, sobrevive ao fechar o navegador). */
import { MUTED_KEY, parseMuted, safeMutedStorage, serializeMuted } from './mutedStorageCore';
import type { MutedStorage } from './mutedStorageCore';

export * from './mutedStorageCore';

const local: MutedStorage = {
  load: () => Promise.resolve(parseMuted(globalThis.localStorage.getItem(MUTED_KEY))),
  save: (names) => {
    globalThis.localStorage.setItem(MUTED_KEY, serializeMuted(names));
    return Promise.resolve();
  },
};

export function createMutedStorage(): MutedStorage {
  return safeMutedStorage(local);
}
