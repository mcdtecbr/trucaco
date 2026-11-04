/**
 * Conquistas vistas por este aparelho: a foto antes da partida e o que subiu ao fim dela. UI local; a
 * fonte de verdade é o servidor (`GET /me/achievements`). Zerar ao sair da conta.
 */
import type { UserAchievement } from '@trucaco/protocol';
import { createStore, useStore } from 'zustand';
import type { AchievementGain } from '../profile/progress';

export interface ProgressStoreState {
  readonly baseline: readonly UserAchievement[] | null;
  readonly gains: readonly AchievementGain[];
  setBaseline(list: readonly UserAchievement[] | null): void;
  setGains(list: readonly AchievementGain[]): void;
  reset(): void;
}

export function createProgressStore() {
  return createStore<ProgressStoreState>()((set) => ({
    baseline: null,
    gains: [],
    setBaseline: (baseline) => set({ baseline }),
    setGains: (gains) => set({ gains }),
    reset: () => set({ baseline: null, gains: [] }),
  }));
}

export type ProgressStore = ReturnType<typeof createProgressStore>;

export const progressStore: ProgressStore = createProgressStore();

export function useProgressStore<T>(selector: (s: ProgressStoreState) => T): T {
  return useStore(progressStore, selector);
}
