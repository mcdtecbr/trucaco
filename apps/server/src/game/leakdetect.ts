/**
 * Detector de vazamento de cartas, compartilhado pelos testes de projeção (`projection.leak.test.ts`)
 * e de sala (`rooms/TrucoRoom.test.ts`). Só para testes: o servidor não importa este arquivo.
 *
 * A "verdade" vem do `SeriesState` (com as mãos reais); o JSON é o estado como UM cliente o decodificou.
 * Nada aqui usa `expect`: devolve a lista de violações para o chamador afirmar `toEqual([])`.
 */
import { teamOf } from '@trucaco/rules';
import type { Card, PublicGameEvent, SeriesState, Seat } from '@trucaco/rules';
import { legalActionIds } from './projection';

export const key = (c: Card): string => `${c.rank}${c.suit}`;

/** Varre o JSON decodificado e junta todo objeto com cara de carta (rank e suit preenchidos). */
export function sightings(node: unknown, path: string, out: { path: string; card: Card }[]): void {
  if (Array.isArray(node)) {
    node.forEach((n, i) => sightings(n, `${path}[${i}]`, out));
    return;
  }
  if (node === null || typeof node !== 'object') return;
  const o = node as Record<string, unknown>;
  if (typeof o.rank === 'string' && typeof o.suit === 'string' && o.rank !== '' && o.suit !== '') {
    out.push({ path, card: { rank: o.rank as Card['rank'], suit: o.suit as Card['suit'] } });
  }
  for (const [k, v] of Object.entries(o)) sightings(v, `${path}.${k}`, out);
}

/** Cartas citadas em ids de ação (`play:3paus`, `playCovered:Kouros`). */
export function idCards(ids: readonly string[]): Card[] {
  const out: Card[] = [];
  for (const id of ids) {
    const m = /^(?:play|playCovered):(.+?)(paus|copas|espadas|ouros)$/.exec(id);
    if (m !== null) out.push({ rank: m[1] as Card['rank'], suit: m[2] as Card['suit'] });
  }
  return out;
}

export interface Truth {
  /** Cartas que o assento PODE conhecer: abertas na mesa, vira, mão própria, parceiro na decisão, próprias cobertas. */
  allowed: Set<string>;
  /** Cartas que NÃO pode conhecer: mão alheia (salvo parceiro na decisão) e cobertas alheias. */
  forbidden: Set<string>;
  ownHand: Card[];
}

export function truthFor(series: SeriesState, seat: Seat): Truth {
  const h = series.match.hand;
  const allowed = new Set<string>();
  const forbidden = new Set<string>();
  if (h.vira !== null) allowed.add(key(h.vira));
  const plays = [...h.tricks.flatMap((t) => t.plays), ...h.current];
  for (const p of plays) {
    if (!p.covered) allowed.add(key(p.card));
    else if (p.seat === seat) allowed.add(key(p.card));
    else forbidden.add(key(p.card));
  }
  const ferro = h.special === 'maoDeFerro';
  const decider = h.phase === 'specialDecision' && teamOf(seat) === h.specialTeam;
  const ownHand: Card[] = [];
  h.hands.forEach((cards, s) => {
    for (const c of cards) {
      if (s === seat) {
        if (!ferro) {
          allowed.add(key(c));
          ownHand.push(c);
        } else forbidden.add(key(c)); // dono às cegas também não vê
      } else if (decider && teamOf(s) === teamOf(seat)) allowed.add(key(c));
      else forbidden.add(key(c));
    }
  });
  return { allowed, forbidden, ownHand };
}

interface Shape {
  privates?: Record<string, { seat: number; hand: Card[]; legalActions: string[] }>;
  players?: { handSize: number }[];
}

export interface LeakOptions {
  /**
   * Além de "nada proibido", exige que o cliente esteja em dia com o servidor: cartas só entre as
   * permitidas, `legalActions`/`hand`/`handSize` idênticos à verdade atual. Use `false` para
   * verificar patches intermediários (só a ausência de carta proibida e a forma de `privates`).
   */
  readonly exact?: boolean;
}

/** Violações encontradas no JSON que o cliente do `seat` decodificou. Vazio = sem vazamento. */
export function leakViolations(
  json: unknown,
  series: SeriesState,
  seat: Seat,
  label: string,
  opts: LeakOptions = {},
): string[] {
  const exact = opts.exact ?? true;
  const bad: string[] = [];
  const truth = truthFor(series, seat);
  const found: { path: string; card: Card }[] = [];
  sightings(json, 'state', found);
  for (const f of found) {
    if (truth.forbidden.has(key(f.card))) {
      bad.push(`${label}: carta proibida ${key(f.card)} em ${f.path}`);
    } else if (exact && !truth.allowed.has(key(f.card))) {
      bad.push(`${label}: carta desconhecida ${key(f.card)} em ${f.path}`);
    }
  }
  const shape = json as Shape;
  const entries = Object.values(shape.privates ?? {});
  if (shape.privates === undefined) bad.push(`${label}: privates ausente`);
  // Só o bloco do próprio assento chega ao cliente.
  if (entries.some((e) => e.seat !== seat) || entries.length > 1) {
    bad.push(`${label}: bloco privado de outro assento (${entries.map((e) => e.seat).join(',')})`);
  }
  const mine = entries.find((e) => e.seat === seat);
  if (mine === undefined) {
    bad.push(`${label}: bloco privado próprio ausente`);
    return bad;
  }
  for (const c of idCards(mine.legalActions)) {
    if (truth.forbidden.has(key(c))) bad.push(`${label}: legalAction cita carta proibida`);
  }
  if (!exact) return bad;
  const want = legalActionIds(series, seat);
  if (JSON.stringify(mine.legalActions) !== JSON.stringify(want)) {
    bad.push(
      `${label}: legalActions ${JSON.stringify(mine.legalActions)} != ${JSON.stringify(want)}`,
    );
  }
  const ferro = series.match.hand.special === 'maoDeFerro';
  if (ferro) {
    if (mine.hand.length !== 0) bad.push(`${label}: mão de ferro com cartas visíveis`);
  } else if (
    JSON.stringify(mine.hand.map(key).sort()) !== JSON.stringify(truth.ownHand.map(key).sort())
  ) {
    bad.push(`${label}: mão própria diferente da verdade`);
  }
  const sizes = (shape.players ?? []).map((p) => p.handSize);
  const wantSizes = series.match.hand.hands.map((x) => x.length);
  if (JSON.stringify(sizes) !== JSON.stringify(wantSizes)) bad.push(`${label}: handSize errado`);
  return bad;
}

/**
 * Violações em um evento público recebido pelo cliente do `viewer`: identidade de carta só em
 * `cardPlayed` aberta ou coberta do próprio jogador. Qualquer outro `rank`/`suit` é vazamento.
 */
export function eventViolations(event: unknown, viewer: Seat, label: string): string[] {
  const e = event as PublicGameEvent;
  const found: { path: string; card: Card }[] = [];
  sightings(e, 'event', found);
  if (found.length === 0) return [];
  if (e.type !== 'cardPlayed') return [`${label}: carta em evento ${e.type}`];
  if (e.covered && e.seat !== viewer)
    return [`${label}: coberta alheia (assento ${e.seat}) revelada`];
  return [];
}
