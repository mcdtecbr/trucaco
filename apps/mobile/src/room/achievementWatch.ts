/**
 * Aviso de conquista ao fim da partida SEM mensagem nova do servidor: tira uma foto de
 * `GET /me/achievements` ao entrar na mesa e, no fim da partida, relê e compara. O servidor grava a
 * progressão depois de salvar a partida, então a leitura repete algumas vezes com espera.
 * (Pendência: um evento `achievementUnlocked` na sala evitaria a espera; ver relatório do 6G.)
 */
import type { AchievementsResponse } from '@trucaco/protocol';
import { achievementGains } from '../profile/progress';
import type { ProgressStore } from '../store/progressStore';

export interface AchievementApi {
  myAchievements(): Promise<AchievementsResponse>;
}

/** Esperas (ms) antes de cada leitura depois do fim da partida. */
export const GAIN_CHECK_DELAYS_MS: readonly number[] = [1500, 4000, 8000];

/** Foto antes da partida. Melhor esforço: sem ela não há aviso, e nada quebra. */
export async function captureBaseline(
  api: AchievementApi,
  store: ProgressStore,
  cancelled: () => boolean = () => false,
): Promise<void> {
  try {
    const res = await api.myAchievements();
    if (cancelled()) return; // saiu da mesa (ou trocou de usuário) no meio: não grava foto alheia
    store.getState().setBaseline(res.achievements);
  } catch {
    // Sem foto, sem aviso.
  }
}

/** Relê depois do fim da partida; para na primeira leitura em que algum nível subiu. */
export async function watchGains(args: {
  api: AchievementApi;
  store: ProgressStore;
  sleep?: (ms: number) => Promise<void>;
  cancelled?: () => boolean;
  delays?: readonly number[];
}): Promise<void> {
  const sleep = args.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const cancelled = args.cancelled ?? (() => false);
  // Zera ANTES de qualquer retorno antecipado: ganho de outra partida nunca fica à mostra.
  args.store.getState().setGains([]);
  const before = args.store.getState().baseline;
  if (before === null) return;
  for (const ms of args.delays ?? GAIN_CHECK_DELAYS_MS) {
    await sleep(ms);
    if (cancelled()) return;
    try {
      const res = await args.api.myAchievements();
      if (cancelled()) return;
      const gains = achievementGains(before, res.achievements);
      if (gains.length > 0) {
        args.store.getState().setGains(gains);
        args.store.getState().setBaseline(res.achievements);
        return;
      }
    } catch {
      // Tenta na próxima espera.
    }
  }
}

/**
 * Liga o aviso à tela de fim de partida e devolve o cleanup. Zera os ganhos ao começar e ao sair da
 * tela (rematch, outra mesa); partida cancelada não consulta nada.
 */
export function startGainWatch(args: {
  api: AchievementApi;
  store: ProgressStore;
  outcome: string;
  sleep?: (ms: number) => Promise<void>;
  delays?: readonly number[];
}): () => void {
  const clear = (): void => args.store.getState().setGains([]);
  clear();
  if (args.outcome === 'cancelled') return clear;
  let stop = false;
  void watchGains({
    api: args.api,
    store: args.store,
    cancelled: () => stop,
    ...(args.sleep !== undefined ? { sleep: args.sleep } : {}),
    ...(args.delays !== undefined ? { delays: args.delays } : {}),
  });
  return () => {
    stop = true;
    clear();
  };
}
