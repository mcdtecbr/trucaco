/**
 * Jogadores silenciados neste aparelho (UI local, nunca enviada ao servidor). Persistida por
 * `platform/mutedStorage`. A chave é o apelido normalizado.
 */
import { createStore, useStore } from 'zustand';
import { createMutedStorage } from '../platform/mutedStorage';
import {
  MAX_MUTED,
  createMemoryMutedStorage,
  normalizeNickname,
} from '../platform/mutedStorageCore';
import type { MutedStorage } from '../platform/mutedStorageCore';

export interface MutedStoreState {
  readonly names: readonly string[];
  /** Carrega as preferências guardadas (junta com o que já foi silenciado antes de terminar). */
  hydrate(): Promise<void>;
  /** Silencia ou reativa. `false` para apelido vazio ou lista cheia. */
  toggle(nickname: string): boolean;
  has(nickname: string): boolean;
}

export function createMutedStore(storage: MutedStorage = createMemoryMutedStorage()) {
  /** Antes de carregar, gravar sobrescreveria a lista guardada: a gravação espera o `hydrate`. */
  let hydrated = false;
  let pendingSave = false;
  return createStore<MutedStoreState>()((set, get) => ({
    names: [],
    async hydrate() {
      const saved = await storage.load();
      const merged = [...new Set([...saved, ...get().names])].slice(0, MAX_MUTED);
      set({ names: merged });
      hydrated = true;
      if (pendingSave) {
        pendingSave = false;
        void storage.save(merged);
      }
    },
    toggle(nickname) {
      const n = normalizeNickname(nickname);
      if (n === '') return false;
      const cur = get().names;
      let next: readonly string[];
      if (cur.includes(n)) next = cur.filter((x) => x !== n);
      else if (cur.length >= MAX_MUTED) return false;
      else next = [...cur, n];
      set({ names: next });
      if (hydrated) void storage.save(next);
      else pendingSave = true;
      return true;
    },
    has: (nickname) => get().names.includes(normalizeNickname(nickname)),
  }));
}

export type MutedStore = ReturnType<typeof createMutedStore>;

/** Singleton do app (armazenamento da plataforma). `getApp()` chama `hydrate()` uma vez. */
export const mutedStore: MutedStore = createMutedStore(createMutedStorage());

export function useMutedNames(): readonly string[] {
  return useStore(mutedStore, (s) => s.names);
}
