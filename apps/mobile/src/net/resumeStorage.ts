/**
 * Resolução padrão (testes, SSR, typecheck): memória. O Metro troca por `resumeStorage.native.ts` ou
 * `resumeStorage.web.ts` conforme a plataforma. Mantenha a mesma assinatura nos três.
 */
import { createMemoryResumeStorage } from './resumeStorageCore';
import type { ResumeStorage } from './resumeStorageCore';

export * from './resumeStorageCore';

export function createResumeStorage(): ResumeStorage {
  return createMemoryResumeStorage();
}
