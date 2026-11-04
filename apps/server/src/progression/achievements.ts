/**
 * Avaliação de uma partida terminada (Fase 6, `docs/gamificacao.md`): do log de eventos públicos do motor,
 * das mãos sorteadas (`deals`, só para achar a vira) e do contador de sinais da sala saem os deltas de
 * estatísticas, conquistas e contadores de missão de CADA jogador humano. Funções puras: nada aqui lê
 * relógio, banco ou mensagem do cliente. Quem aplica no banco é `service.ts`.
 *
 * Só conta partida `finished` com 4 `userId` distintos e nenhum bot (`botFrom === null` nos quatro): bot de
 * ausência, vaga de bot e conta repetida em dois assentos não pontuam (plano da Fase 6, seção 4).
 * Log truncado (`options.logTruncated`) só SUBconta as conquistas derivadas de eventos, nunca superconta.
 */
import { cardEquals, isManilha, variantById } from '@trucaco/rules';
import type { Card, PublicGameEvent, Variant } from '@trucaco/rules';
import type { AchievementDelta, FinishedMatchInput, JsonValue, VariantId } from '../db/types';
import type { MissionCounters } from './missions';

export interface PartnerWins {
  /** Vitórias do jogador com o parceiro DESTA partida, contando esta. */
  readonly current: number;
  /** Maior contagem já gravada em `dupla_afinada` (com qualquer parceiro). */
  readonly best: number;
}

export interface EvaluateInput {
  readonly match: FinishedMatchInput;
  /** Sinais que cada assento usou (contador da sala; bot nunca entra). */
  readonly signalsBySeat: ReadonlyMap<number, number>;
  /** `userId` -> vitórias com o parceiro desta partida (ausente = sem dado: `dupla_afinada` não avança). */
  readonly partnerWins: ReadonlyMap<string, PartnerWins>;
}

export interface PlayerEvaluation {
  readonly userId: string;
  readonly seat: number;
  readonly team: 0 | 1;
  readonly variant: VariantId;
  readonly won: boolean;
  readonly achievements: readonly AchievementDelta[];
  readonly counters: MissionCounters;
}

/** Partida elegível: terminada, com vencedor, 4 humanos distintos e nenhuma troca por bot. */
export function isEligibleForProgression(match: FinishedMatchInput): boolean {
  if (match.status !== 'finished' || match.winnerTeam === null) return false;
  if (match.players.length !== 4) return false;
  const ids = new Set<string>();
  for (const p of match.players) {
    if (p.userId === null || p.botFrom !== null) return false;
    ids.add(p.userId);
  }
  return ids.size === 4;
}

/** Zap: a manilha de paus (Paulista) ou o 4 de paus (Mineiro, primeira manilha fixa). */
export function isZap(variant: Variant, vira: Card | null, card: Card): boolean {
  if (variant.fixedManilhas !== null) {
    const first = variant.fixedManilhas[0];
    return first !== undefined && cardEquals(first, card);
  }
  return isManilha(variant, vira, card) && card.suit === 'paus';
}

type Pair = [number, number];

interface MatchFacts {
  readonly zapTricks: Map<number, number>;
  readonly doze: Pair;
  readonly ferro: Pair;
  readonly virada: Pair;
  readonly betsCalled: Map<number, number>;
  readonly betsAccepted: Map<number, number>;
}

const bump = (m: Map<number, number>, seat: number): void => {
  m.set(seat, (m.get(seat) ?? 0) + 1);
};

const isObject = (v: unknown): v is { readonly [key: string]: JsonValue } =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function viraBySeq(deals: FinishedMatchInput['deals']): Map<number, Card | null> {
  const out = new Map<number, Card | null>();
  for (const d of deals ?? []) {
    if (!isObject(d)) continue;
    const seq = d['seq'];
    const vira = d['vira'];
    if (typeof seq !== 'number') continue;
    out.set(seq, isObject(vira) ? ({ rank: vira['rank'], suit: vira['suit'] } as Card) : null);
  }
  return out;
}

/** Percorre o log uma vez e junta os fatos por assento e por dupla. */
function collectFacts(match: FinishedMatchInput, variant: Variant): MatchFacts {
  const facts: MatchFacts = {
    zapTricks: new Map(),
    doze: [0, 0],
    ferro: [0, 0],
    virada: [0, 0],
    betsCalled: new Map(),
    betsAccepted: new Map(),
  };
  const viras = viraBySeq(match.deals);
  let vira: Card | null = null;
  let special: string = 'normal';
  let trick: { seat: number; card: Card | null }[] = [];
  // Maior desvantagem (pontos) de cada dupla no jogo corrente.
  const deficit: Pair = [0, 0];
  const track = (scores: readonly [number, number]): void => {
    deficit[0] = Math.max(deficit[0], scores[1] - scores[0]);
    deficit[1] = Math.max(deficit[1], scores[0] - scores[1]);
  };
  for (const entry of match.events) {
    if (!isObject(entry.event) || typeof entry.event['type'] !== 'string') continue;
    const ev = entry.event as unknown as PublicGameEvent;
    switch (ev.type) {
      case 'handStarted':
        vira = viras.get(entry.seq) ?? null;
        special = ev.special;
        trick = [];
        track(ev.scores);
        break;
      case 'cardPlayed':
        trick.push({ seat: ev.seat, card: ev.card });
        break;
      case 'trickDecided': {
        if (ev.winnerSeat !== null) {
          const play = trick.find((p) => p.seat === ev.winnerSeat);
          if (play?.card != null && isZap(variant, vira, play.card))
            bump(facts.zapTricks, play.seat);
        }
        trick = [];
        break;
      }
      case 'betCalled':
        bump(facts.betsCalled, ev.seat);
        break;
      case 'betRaised':
        // Aumentar aceita o pedido anterior (regra do motor) E pede a aposta maior: conta nos dois.
        bump(facts.betsAccepted, ev.seat);
        bump(facts.betsCalled, ev.seat);
        break;
      case 'betAccepted':
        bump(facts.betsAccepted, ev.seat);
        break;
      case 'handDecided': {
        track(ev.scores);
        const w = ev.winnerTeam;
        if (w !== null) {
          if (ev.points >= 12 && ev.reason === 'tricks') facts.doze[w]++;
          if (special === 'maoDeFerro') facts.ferro[w]++;
        }
        break;
      }
      case 'gameDecided':
        if (deficit[ev.winnerTeam] >= 9) facts.virada[ev.winnerTeam]++;
        deficit[0] = 0;
        deficit[1] = 0;
        break;
      default:
        break;
    }
  }
  return facts;
}

/** Venceu a série sem perder nenhum jogo (só `bo3`; `games` é o resumo por jogo gravado pelo recorder). */
function perfectSeries(match: FinishedMatchInput, team: 0 | 1): boolean {
  if (match.format !== 'bo3' || match.winnerTeam !== team) return false;
  let won = 0;
  for (const g of match.games) {
    if (!isObject(g) || g['winnerTeam'] !== team) return false;
    won++;
  }
  return won >= 2;
}

/**
 * Deltas de cada jogador humano da partida. `[]` se a partida não é elegível. Conquistas sem avanço nesta
 * partida não geram entrada.
 */
export function evaluateMatch(input: EvaluateInput): PlayerEvaluation[] {
  const { match } = input;
  if (!isEligibleForProgression(match)) return [];
  const variant = variantById(match.variant);
  const facts = collectFacts(match, variant);
  const out: PlayerEvaluation[] = [];
  for (const p of [...match.players].sort((a, b) => a.seat - b.seat)) {
    if (p.userId === null) continue;
    const team = p.team;
    const won = match.winnerTeam === team;
    const signals = input.signalsBySeat.get(p.seat) ?? 0;
    const achievements: AchievementDelta[] = [];
    const add = (achievementId: AchievementDelta['achievementId'], delta: number): void => {
      if (delta > 0) achievements.push({ achievementId, progressDelta: delta });
    };
    if (won) add('primeira_vitoria', 1);
    add('zap_na_mao', facts.zapTricks.get(p.seat) ?? 0);
    add('doze_na_mesa', facts.doze[team]);
    add('virada', facts.virada[team]);
    add('mao_de_ferro', facts.ferro[team]);
    if (perfectSeries(match, team)) add('serie_perfeita', 1);
    const pw = input.partnerWins.get(p.userId);
    if (won && pw !== undefined && pw.current > pw.best) {
      achievements.push({ achievementId: 'dupla_afinada', progressSet: pw.current });
    }
    if (signals > 0) add('sinaleiro', 1);
    add('maratona', 1);
    out.push({
      userId: p.userId,
      seat: p.seat,
      team,
      variant: match.variant,
      won,
      achievements,
      counters: {
        played: 1,
        won: won ? 1 : 0,
        betsCalled: facts.betsCalled.get(p.seat) ?? 0,
        betsAccepted: facts.betsAccepted.get(p.seat) ?? 0,
        signals,
      },
    });
  }
  return out;
}
