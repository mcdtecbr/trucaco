/**
 * Plano da animação de embaralhar e distribuir (só apresentação). Nenhuma regra de jogo: o servidor já
 * decidiu as cartas; aqui só se ordena o voo das costas das cartas. A ordem real de distribuição é a do
 * motor: o `mão` (assento seguinte ao pé, `nextSeat(pe)`) recebe primeiro e a volta segue a ordem da mesa.
 */

/** Cartas por jogador numa distribuição normal. */
export const CARDS_PER_SEAT = 3;
/** Recolher, 1ª parte: as cartas da vaza viram para o verso e se juntam numa pilha no centro. */
export const COLLECT_FLIP_MS = 450;
/** Recolher, 2ª parte: a pilha desliza até o monte e some nele. */
export const COLLECT_PILE_MS = 600;
/** Recolher as cartas da mão anterior ao monte (virar + deslizar). */
export const COLLECT_MS = COLLECT_FLIP_MS + COLLECT_PILE_MS;
/** O balanço do embaralhar começa assim que a pilha está chegando ao monte (fases se sobrepõem). */
export const SHUFFLE_OVERLAP_MS = 200;
/** A 1ª carta sai nos últimos ms do balanço, sem esperar o monte assentar. */
export const DEAL_OVERLAP_MS = 100;
/** Flip curto das minhas cartas ao pousarem (e da vira ao aparecer). */
export const FLIP_MS = 180;
/** Embaralhar: balanço curto do monte. */
export const SHUFFLE_MS = 350;
/** Intervalo entre o início do voo de uma carta e o da seguinte (2 a 3 cartas em voo ao mesmo tempo). */
export const DEAL_STEP_MS = 230;
/** Duração do voo de uma carta até o assento. */
export const DEAL_FLIGHT_MS = 450;
/** Deslize de uma carta jogada, do assento do jogador até a vaza. */
export const PLAY_SLIDE_MS = 450;

/** Pausa no fim da mão: a última carta e a vaza ficam na mesa, legíveis, antes de recolher ao monte. */
export const HAND_HOLD_MS = 2000;
/** Mesma pausa com "reduzir movimento" (sem animação, mas ainda precisa dar para ler). */
export const HAND_HOLD_REDUCED_MS = 1500;

/**
 * Pausa de apresentação do fim da mão/partida. `animate` falso (E2E, testes) = nenhuma pausa; com reduzir
 * movimento a pausa é menor. É só apresentação: o servidor já decidiu e o estado novo já chegou.
 */
export function handHoldMs(animate: boolean, reduceMotion: boolean): number {
  if (!animate) return 0;
  return reduceMotion ? HAND_HOLD_REDUCED_MS : HAND_HOLD_MS;
}

/**
 * Duração do deslize da carta jogada. `undefined` = sem animação (E2E, reduzir movimento); 0 = ainda não
 * armado (cartas já presentes na montagem, como numa reconexão, ficam paradas).
 */
export function playSlideMs(
  animate: boolean,
  reduceMotion: boolean,
  armed: boolean,
): number | undefined {
  if (!animate || reduceMotion) return undefined;
  return armed ? PLAY_SLIDE_MS : 0;
}

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
  /** Início do balanço (sobrepõe o fim do recolher). */
  readonly shuffleStartMs: number;
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
  const shuffleStartMs = Math.max(0, collectMs - SHUFFLE_OVERLAP_MS);
  const t0 = shuffleStartMs + shuffleMs - DEAL_OVERLAP_MS;
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
    shuffleStartMs,
    cards,
    selfLandedMs: lastSelf + DEAL_FLIGHT_MS,
    // Depois da última aterrissagem, deixa o flip das minhas cartas terminar.
    endMs: Math.max(last + DEAL_FLIGHT_MS, lastSelf + DEAL_FLIGHT_MS + FLIP_MS),
  };
}

/**
 * Plano só de recolher: as cartas da vaza se juntam e voltam ao monte (a cada vaza, no meio da mão). Sem
 * embaralhar nem distribuir.
 */
export function collectPlan(): DealPlan {
  return {
    collectMs: COLLECT_MS,
    shuffleMs: 0,
    shuffleStartMs: COLLECT_MS,
    cards: [],
    selfLandedMs: COLLECT_MS,
    endMs: COLLECT_MS,
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
