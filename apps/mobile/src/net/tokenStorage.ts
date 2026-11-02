/**
 * Resolução padrão (testes, SSR, typecheck): memória. O Metro troca por `tokenStorage.native.ts` ou
 * `tokenStorage.web.ts` conforme a plataforma. Mantenha a mesma assinatura nos três.
 */
import { createMemoryTokenStorage } from './tokenStorageCore';
import type { TokenStorage } from './tokenStorageCore';

export * from './tokenStorageCore';

export function createTokenStorage(): TokenStorage {
  return createMemoryTokenStorage();
}
