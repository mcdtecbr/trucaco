import type { AchievementsResponse, UserAchievement } from '@trucaco/protocol';
import { describe, expect, it, vi } from 'vitest';
import { createProgressStore } from '../store/progressStore';
import { captureBaseline, startGainWatch, watchGains } from './achievementWatch';

const ach = (id: UserAchievement['id'], level: number): UserAchievement => ({
  id,
  level,
  progress: level,
  unlockedAt: level > 0 ? '2026-11-04T10:00:00Z' : null,
});

const now = () => Promise.resolve();

describe('aviso de conquista ao fim da partida', () => {
  it('captura a foto; falha de rede deixa sem foto e sem erro', async () => {
    const store = createProgressStore();
    await captureBaseline({ myAchievements: () => Promise.reject(new Error('x')) }, store);
    expect(store.getState().baseline).toBeNull();
    await captureBaseline(
      { myAchievements: () => Promise.resolve({ achievements: [ach('maratona', 0)] }) },
      store,
    );
    expect(store.getState().baseline).toHaveLength(1);
  });

  it('sem foto não consulta o servidor', async () => {
    const store = createProgressStore();
    const api = { myAchievements: vi.fn(() => Promise.resolve({ achievements: [] })) };
    await watchGains({ api, store, sleep: now });
    expect(api.myAchievements).not.toHaveBeenCalled();
  });

  it('repete até o servidor gravar e então mostra só o que subiu, atualizando a foto', async () => {
    const store = createProgressStore();
    store.getState().setBaseline([ach('maratona', 0), ach('zap_na_mao', 1)]);
    const answers = [
      [ach('maratona', 0), ach('zap_na_mao', 1)],
      [ach('maratona', 1), ach('zap_na_mao', 1)],
    ];
    const api = {
      myAchievements: vi.fn(
        (): Promise<AchievementsResponse> =>
          Promise.resolve({ achievements: answers.shift() ?? [] }),
      ),
    };
    await watchGains({ api, store, sleep: now });
    expect(api.myAchievements).toHaveBeenCalledTimes(2);
    expect(store.getState().gains).toEqual([
      { id: 'maratona', name: 'Maratona', levelLabel: 'Bronze' },
    ]);
    expect(store.getState().baseline?.find((a) => a.id === 'maratona')?.level).toBe(1);
  });

  it('sem mudança, esgota as tentativas e não mostra nada; cancelar interrompe', async () => {
    const store = createProgressStore();
    store.getState().setBaseline([ach('maratona', 0)]);
    const api = {
      myAchievements: vi.fn(() => Promise.resolve({ achievements: [ach('maratona', 0)] })),
    };
    await watchGains({ api, store, sleep: now, delays: [1, 2, 3] });
    expect(api.myAchievements).toHaveBeenCalledTimes(3);
    expect(store.getState().gains).toEqual([]);
    api.myAchievements.mockClear();
    await watchGains({ api, store, sleep: now, cancelled: () => true });
    expect(api.myAchievements).not.toHaveBeenCalled();
  });
});

describe('startGainWatch', () => {
  const gain = [{ id: 'maratona' as const, name: 'Maratona', levelLabel: 'Bronze' }];

  it('partida cancelada: zera ganhos antigos e não consulta o servidor', () => {
    const store = createProgressStore();
    store.getState().setBaseline([ach('maratona', 0)]);
    store.getState().setGains(gain);
    const api = { myAchievements: vi.fn(() => Promise.resolve({ achievements: [] })) };
    const stop = startGainWatch({ api, store, outcome: 'cancelled' });
    expect(store.getState().gains).toEqual([]);
    expect(api.myAchievements).not.toHaveBeenCalled();
    stop();
  });

  it('sem foto: zera ganhos antigos antes do retorno antecipado', async () => {
    const store = createProgressStore();
    store.getState().setGains(gain);
    const api = { myAchievements: vi.fn(() => Promise.resolve({ achievements: [] })) };
    startGainWatch({ api, store, outcome: 'won', sleep: now });
    expect(store.getState().gains).toEqual([]);
    await Promise.resolve();
    expect(api.myAchievements).not.toHaveBeenCalled();
  });

  it('sair da tela (troca de mesa) cancela a leitura e zera os ganhos', async () => {
    const store = createProgressStore();
    store.getState().setBaseline([ach('maratona', 0)]);
    let resolve: (v: AchievementsResponse) => void = () => undefined;
    const api = {
      myAchievements: vi.fn(
        () =>
          new Promise<AchievementsResponse>((r) => {
            resolve = r;
          }),
      ),
    };
    const stop = startGainWatch({ api, store, outcome: 'won', sleep: now, delays: [1] });
    await vi.waitFor(() => expect(api.myAchievements).toHaveBeenCalled());
    stop();
    resolve({ achievements: [ach('maratona', 1)] });
    await new Promise((r) => setTimeout(r, 5));
    expect(store.getState().gains).toEqual([]);
  });

  it('captureBaseline cancelada não grava foto', async () => {
    const store = createProgressStore();
    await captureBaseline(
      { myAchievements: () => Promise.resolve({ achievements: [ach('maratona', 1)] }) },
      store,
      () => true,
    );
    expect(store.getState().baseline).toBeNull();
  });
});
