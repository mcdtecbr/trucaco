/**
 * Plano da animação de embaralhar e distribuir (só apresentação). Nenhuma regra de jogo: o servidor já
 * decidiu as cartas; aqui só se ordena o voo das costas das cartas. A ordem real de distribuição é a do
 * motor: o `mão` (assento seguinte ao pé, `nextSeat(pe)`) recebe primeiro e a volta segue a ordem da mesa.
 */

/** Cartas por jogador numa distribuição normal. */
export const CARDS_PER_SEAT = 3;
/** Recolher as cartas da mão anterior ao monte. */
export const COLLECT_MS = 380;
/** Embaralhar (monte se abre e se intercala). */
export const SHUFFLE_MS = 420;
/** Intervalo entre o início do voo de uma carta e o da seguinte. */
export const DEAL_STEP_MS = 70;
/** Duração do voo de uma carta até o assento. */
export const DEAL_FLIGHT_MS = 260;

export interface DealCard {
  readonly seat: number;
  /** 0, 1 ou 2: a rodada de distribuição. */
  readonly round: number;
  /** Instante (ms desde o início da animação) em que a carta sai do monte. */
  readonly startMs: number;
}

export interface DealPlan {
  readonly collectMs: number;
  readonly shuffleMs: number;
  readonly cards: readonly DealCard[];
  /** Instante em que a última carta do assento local pousa (a mão aparece). */
  readonly selfLandedMs: number;
  /** Fim da animação (última carta pousada); a vira aparece aqui. */
  readonly endMs: number;
}

/** Ordem dos assentos numa rodada: começa pelo mão (`pe + 1`) e segue a ordem da mesa. */
export function dealSeatOrder(pe: number, seats = 4): readonly number[] {
  const first = (((pe + 1) % seats) + seats) % seats;
  return Array.from({ length: seats }, (_, k) => (first + k) % seats);
}

/**
 * Cartas na ordem em que saem do monte: uma por jogador por rodada, `perSeat` rodadas.
 * `pe` desconhecido (< 0): começa pelo assento 0.
 */
export function dealPlan(opts: {
  pe: number;
  mySeat: number;
  collect: boolean;
  seats?: number;
  perSeat?: number;
}): DealPlan {
  const seats = opts.seats ?? 4;
  const perSeat = opts.perSeat ?? CARDS_PER_SEAT;
  const order = dealSeatOrder(opts.pe < 0 ? seats - 1 : opts.pe, seats);
  const collectMs = opts.collect ? COLLECT_MS : 0;
  const shuffleMs = SHUFFLE_MS;
  const t0 = collectMs + shuffleMs;
  const cards: DealCard[] = [];
  for (let round = 0; round < perSeat; round++) {
    for (const seat of order) {
      cards.push({ seat, round, startMs: t0 + cards.length * DEAL_STEP_MS });
    }
  }
  const lastSelf = cards.reduce((m, c) => (c.seat === opts.mySeat ? c.startMs : m), t0);
  const last = cards[cards.length - 1]?.startMs ?? t0;
  return {
    collectMs,
    shuffleMs,
    cards,
    selfLandedMs: lastSelf + DEAL_FLIGHT_MS,
    endMs: last + DEAL_FLIGHT_MS,
  };
}

export interface DealDecision {
  readonly animate: boolean;
  /** Há mão anterior para recolher ao monte. */
  readonly collect: boolean;
}

/**
 * Decide se uma troca de mão dispara a animação. `prevKey` é a mão anterior vista por este componente
 * (`null` = primeira leitura). Na primeira leitura só anima se a mão acabou de começar (`fresh`: sem
 * vazas e sem jogadas), e sem recolher; mão já em curso (reconexão, recarga) não anima. Depois de
 * montado, toda troca de mão anima e recolhe. Desligada ou mesma mão: nada.
 */
export function dealDecision(
  prevKey: string | null,
  key: string,
  enabled: boolean,
  fresh = true,
): DealDecision {
  if (!enabled || prevKey === key) return { animate: false, collect: false };
  if (prevKey === null) return { animate: fresh, collect: false };
  return { animate: true, collect: true };
}
