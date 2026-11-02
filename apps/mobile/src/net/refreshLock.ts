/**
 * Exclusão mútua da renovação entre abas. Web: `navigator.locks` (Web Locks API, exclusivo por origin).
 * iOS/Android: processo único, sem `navigator.locks` -> passa direto (a fila única de `api.ts` basta).
 * A leitura de `navigator.locks` é feita a cada chamada (e não na importação) para funcionar em SSR/testes.
 */
export type RefreshLock = <T>(fn: () => Promise<T>) => Promise<T>;

export const REFRESH_LOCK_NAME = 'trucaco-refresh';

interface LockManagerLike {
  request(name: string, callback: () => Promise<unknown>): Promise<unknown>;
}

export const webRefreshLock: RefreshLock = <T>(fn: () => Promise<T>): Promise<T> => {
  const locks = (globalThis as unknown as { navigator?: { locks?: LockManagerLike } }).navigator
    ?.locks;
  if (locks === undefined) return fn();
  return locks.request(REFRESH_LOCK_NAME, fn) as Promise<T>;
};
