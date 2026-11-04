/**
 * Missões (Fase 6, `docs/gamificacao.md` seção 2): sorteio determinístico das diárias e avanço por partida.
 * Funções puras. O catálogo (ids, período, meta) vem de `@trucaco/protocol`.
 */
import { createHash } from 'node:crypto';
import {
  DAILY_MISSIONS_PER_DAY,
  MISSION_DEFINITIONS,
  MISSION_IDS,
  type MissionId,
} from '@trucaco/protocol';
import type { MissionDelta } from '../db/types';

export interface MissionAssignment {
  readonly missionId: MissionId;
  readonly periodKey: string;
  readonly target: number;
}

/** O que a partida rendeu a UM jogador, para as missões. */
export interface MissionCounters {
  readonly played: number;
  readonly won: number;
  /** Pedidos de aposta do jogador: `betCalled` e também `betRaised` (aumentar é pedir a aposta maior). */
  readonly betsCalled: number;
  /** Apostas aceitas pelo jogador: `betAccepted` e também `betRaised` (aumentar aceita o pedido anterior). */
  readonly betsAccepted: number;
  /** Sinais que o jogador usou na partida (contador da sala). */
  readonly signals: number;
}

const DAILY_IDS = MISSION_IDS.filter((id) => MISSION_DEFINITIONS[id].period === 'daily');
const WEEKLY_IDS = MISSION_IDS.filter((id) => MISSION_DEFINITIONS[id].period === 'weekly');

/**
 * Missões do dia do jogador: `DAILY_MISSIONS_PER_DAY` das diárias, escolhidas por embaralhamento
 * determinístico a partir de `hash(userId, periodKey)` (sem estado nem job: a mesma entrada dá sempre o
 * mesmo sorteio, e outro dia dá outro). A ordem devolvida segue o catálogo.
 */
export function dailyMissionsFor(userId: string, periodKey: string): readonly MissionAssignment[] {
  const digest = createHash('sha256').update(`${userId}|${periodKey}`).digest();
  const pool = [...DAILY_IDS];
  // Fisher-Yates com bytes do hash como fonte de aleatoriedade.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = (digest[i] ?? 0) % (i + 1);
    const a = pool[i];
    const b = pool[j];
    if (a !== undefined && b !== undefined) {
      pool[i] = b;
      pool[j] = a;
    }
  }
  const chosen = new Set(pool.slice(0, DAILY_MISSIONS_PER_DAY));
  return DAILY_IDS.filter((id) => chosen.has(id)).map((missionId) => ({
    missionId,
    periodKey,
    target: MISSION_DEFINITIONS[missionId].target,
  }));
}

/** A missão semanal (uma só, fixa). */
export function weeklyMissionsFor(periodKey: string): readonly MissionAssignment[] {
  return WEEKLY_IDS.map((missionId) => ({
    missionId,
    periodKey,
    target: MISSION_DEFINITIONS[missionId].target,
  }));
}

/** Quanto cada missão avança com os contadores de uma partida. */
function contribution(id: MissionId, c: MissionCounters): number {
  switch (id) {
    case 'jogar_3_partidas':
      return c.played;
    case 'vencer_1_partida':
    case 'vencer_5_semana':
      return c.won;
    case 'pedir_truco_3':
      return c.betsCalled;
    case 'aceitar_2_aumentos':
      return c.betsAccepted;
    case 'usar_5_sinais':
      return c.signals;
  }
}

/**
 * Avanço das missões JÁ atribuídas ao jogador no período (só elas avançam; o repositório limita à meta e
 * marca a conclusão). Missão sem contribuição na partida não gera entrada.
 */
export function advanceMissions(
  assigned: readonly MissionAssignment[],
  counters: MissionCounters,
): MissionDelta[] {
  const out: MissionDelta[] = [];
  for (const m of assigned) {
    const progressDelta = Math.max(0, Math.floor(contribution(m.missionId, counters)));
    if (progressDelta <= 0) continue;
    out.push({
      missionId: m.missionId,
      periodKey: m.periodKey,
      target: m.target,
      progressDelta,
    });
  }
  return out;
}
