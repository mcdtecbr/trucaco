/** Resolução padrão (testes, SSR, typecheck): memória. O Metro troca por `.native.ts` ou `.web.ts`. */
import { createMemoryMutedStorage } from './mutedStorageCore';
import type { MutedStorage } from './mutedStorageCore';

export * from './mutedStorageCore';

export function createMutedStorage(): MutedStorage {
  return createMemoryMutedStorage();
}
