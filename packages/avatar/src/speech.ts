import { BET_CRY_BY_VALUE } from '@trucaco/protocol';
import type { PublicGameEvent, Seat, Team, VariantId } from '@trucaco/protocol';
import catalog from './audioCatalog.json';

/** Eventos de voz (docs/audio.md §1). */
export const VOICE_EVENTS = [
  'truco',
  'seis',
  'oito',
  'nove',
  'dez',
  'doze',
  'quero',
  'corro',
  'mao_especial',
  'mao_de_ferro',
  'vaza',
  'venceu_jogo',
  'venceu_serie',
] as const;
export type VoiceEvent = (typeof VOICE_EVENTS)[number];

/** Um take: o texto é a legenda do balão e o roteiro da gravação. Igual para toda voz. */
export interface SpeechTake {
  readonly id: string;
  readonly text: string;
}

export const SPEECH_TAKES: Readonly<Record<VoiceEvent, readonly SpeechTake[]>> =
  catalog.voiceEvents;

export function takesFor(event: VoiceEvent): readonly SpeechTake[] {
  return SPEECH_TAKES[event];
}

/** Todos os takes, na ordem de `VOICE_EVENTS`. */
export const ALL_TAKES: readonly (SpeechTake & { readonly event: VoiceEvent })[] =
  VOICE_EVENTS.flatMap((event) => SPEECH_TAKES[event].map((t) => ({ ...t, event })));

export function takeById(takeId: string): (SpeechTake & { readonly event: VoiceEvent }) | null {
  return ALL_TAKES.find((t) => t.id === takeId) ?? null;
}

/** Degraus de aposta por variante (espelha `betLadder` do motor; avatar não importa `rules`). */
const LADDERS: Readonly<Record<VariantId, readonly number[]>> = {
  paulista: [3, 6, 9, 12],
  mineiro: [4, 6, 8, 10, 12],
};

/** Valor de aposta -> evento de voz. `null` se o valor não é degrau da variante. */
export function voiceEventForBet(value: number, variant: VariantId): VoiceEvent | null {
  if (!LADDERS[variant].includes(value)) return null;
  return BET_CRY_BY_VALUE[value] ?? null;
}

export interface SpeechContext {
  readonly variant: VariantId;
  /** Fonte de aleatoriedade injetada: devolve [0, 1). */
  readonly rng: () => number;
  /** Chance de falar ao ganhar uma vaza (0 a 1). Padrão 0,25. */
  readonly trickChance?: number;
  /** Assentos da mesa (4 ou 6), para escolher quem comemora. Padrão 4. */
  readonly seats?: number;
}

export interface SpeechCue {
  readonly seat: Seat;
  readonly event: VoiceEvent;
}

export const DEFAULT_TRICK_CHANCE = 0.25;

function pickIndex(n: number, rng: () => number): number {
  return Math.min(n - 1, Math.max(0, Math.floor(rng() * n)));
}

function teamSeat(team: Team, ctx: SpeechContext): Seat {
  const perTeam = Math.max(1, Math.floor((ctx.seats ?? 4) / 2));
  return team + 2 * pickIndex(perTeam, ctx.rng);
}

/**
 * Evento público de jogo -> quem fala e qual evento de voz (ou `null`).
 * - `betCalled`/`betRaised`: grito do degrau (`truco`..`doze`).
 * - `betAccepted`: `quero`. `betRun` e `specialDecided` com `run`: `corro`.
 * - `specialDecided` com `play`: `mao_especial`. `handStarted` com mão de ferro: `mao_de_ferro`,
 *   falado pelo pé.
 * - `trickDecided` com vencedor: `vaza`, sorteado por `ctx.trickChance`.
 * - `gameDecided`/`seriesDecided`: um assento sorteado da dupla vencedora (assento % 2 = dupla).
 *   O último jogo emite os dois eventos (também na partida `single`, que é uma série de 1 jogo): o
 *   chamador decide. Só a melhor de 3 (`bo3`) fala `venceu_serie`; na `single` vale `venceu_jogo`.
 */
export function voiceEventForGameEvent(ev: PublicGameEvent, ctx: SpeechContext): SpeechCue | null {
  switch (ev.type) {
    case 'betCalled':
    case 'betRaised': {
      const event = voiceEventForBet(ev.value, ctx.variant);
      return event === null ? null : { seat: ev.seat, event };
    }
    case 'betAccepted':
      return { seat: ev.seat, event: 'quero' };
    case 'betRun':
      return { seat: ev.seat, event: 'corro' };
    case 'specialDecided':
      return { seat: ev.seat, event: ev.decision === 'play' ? 'mao_especial' : 'corro' };
    case 'handStarted':
      return ev.special === 'maoDeFerro' ? { seat: ev.pe, event: 'mao_de_ferro' } : null;
    case 'trickDecided': {
      if (ev.winnerSeat === null) return null;
      const chance = ctx.trickChance ?? DEFAULT_TRICK_CHANCE;
      return ctx.rng() < chance ? { seat: ev.winnerSeat, event: 'vaza' } : null;
    }
    case 'gameDecided':
      return { seat: teamSeat(ev.winnerTeam, ctx), event: 'venceu_jogo' };
    case 'seriesDecided':
      return { seat: teamSeat(ev.winnerTeam, ctx), event: 'venceu_serie' };
    default:
      return null;
  }
}

/**
 * Sorteia um take do evento sem repetir `lastTakeId` (se houver mais de um take). Com `isReady`, prefere
 * os takes já carregados (o áudio não atrasa o grito); se nenhum está pronto, sorteia entre todos.
 */
export function pickTake(
  event: VoiceEvent,
  lastTakeId: string | null,
  rng: () => number,
  isReady?: (takeId: string) => boolean,
): SpeechTake {
  const all = SPEECH_TAKES[event];
  let pool = all.length > 1 ? all.filter((t) => t.id !== lastTakeId) : all;
  if (isReady !== undefined) {
    const ready = pool.filter((t) => isReady(t.id));
    if (ready.length > 0) pool = ready;
  }
  const take = pool[pickIndex(pool.length, rng)];
  if (take === undefined) throw new Error(`evento sem takes: ${event}`);
  return take;
}
