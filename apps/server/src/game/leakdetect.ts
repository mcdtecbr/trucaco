/**
 * Detector de vazamento de cartas, compartilhado pelos testes de projeção (`projection.leak.test.ts`)
 * e de sala (`rooms/TrucoRoom.test.ts`). Só para testes: o servidor não importa este arquivo.
 *
 * A "verdade" vem do `SeriesState` (com as mãos reais); o JSON é o estado como UM cliente o decodificou.
 * Nada aqui usa `expect`: devolve a lista de violações para o chamador afirmar `toEqual([])`.
 */
import { RANKS, SUITS, teamOf } from '@trucaco/rules';
import type { Card, PublicGameEvent, SeriesState, Seat } from '@trucaco/rules';
import { legalActionIds, projectState } from './projection';
import { createTableState } from './schema';

/** Carta vista no JSON; `manilhaItem` = item do array público `hand.manilhaCards` (isento se for manilha fixa). */
export interface Sighting {
  path: string;
  card: Card;
  manilhaItem?: true;
}

export const key = (c: Card): string => `${c.rank}${c.suit}`;

/** O que o detector precisa de um `Decoder`: o mapa de refs que ele guarda. */
export interface RefHolder {
  readonly root: { readonly refs: ReadonlyMap<number, unknown> };
}

const RANK_SET: ReadonlySet<string> = new Set<string>(RANKS);
const SUIT_SET: ReadonlySet<string> = new Set<string>(SUITS);
const SYMBOL_SUIT: Record<string, Card['suit']> = {
  '♣': 'paus',
  '♥': 'copas',
  '♠': 'espadas',
  '♦': 'ouros',
};
/**
 * Carta embutida em texto: `3paus`, `Kouros`, `play:3paus`, `3 de paus`, `3-paus`, `A_espadas`, `7♦`.
 * O rank não pode colar em letra/dígito antes (evita `13paus`, `Rocouros`).
 */
const CARD_IN_TEXT = new RegExp(
  `(?<![A-Za-z0-9])(${RANKS.join('|')})(?:[\\s_-]*(?:de[\\s_-]+)?(${SUITS.join('|')})(?![a-z])|([♣♥♠♦]))`,
  'g',
);

/** Cartas citadas dentro de um texto qualquer. */
export function cardsInText(text: string): Card[] {
  const out: Card[] = [];
  for (const m of text.matchAll(CARD_IN_TEXT)) {
    const suit = (m[2] ?? SYMBOL_SUIT[m[3] ?? '']) as Card['suit'] | undefined;
    if (suit !== undefined) out.push({ rank: m[1] as Card['rank'], suit });
  }
  return out;
}

/**
 * Varre o JSON decodificado e junta toda carta que o cliente consegue ler:
 * - objeto com campos `rank`/`suit` (ou qualquer par de campos irmãos cujo valor é um rank e um
 *   naipe, como `viraRank`/`viraSuit` ou nomes inventados);
 * - carta embutida em QUALQUER string (valores, itens de array de string, chaves de mapa).
 */
export function sightings(node: unknown, path: string, out: Sighting[]): void {
  if (typeof node === 'string') {
    for (const card of cardsInText(node)) out.push({ path, card });
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((n, i) => sightings(n, `${path}[${i}]`, out));
    return;
  }
  if (node === null || typeof node !== 'object') return;
  const entries = Object.entries(node as Record<string, unknown>);
  const ranks = entries.filter(([, v]) => typeof v === 'string' && RANK_SET.has(v));
  const suits = entries.filter(([, v]) => typeof v === 'string' && SUIT_SET.has(v));
  for (const [rk, rv] of ranks) {
    // `manilhaRank` é só um rank público (regra), sem naipe próprio: não forma carta com o irmão `viraSuit`.
    if (rk === 'manilhaRank') continue;
    for (const [sk, sv] of suits) {
      const card = { rank: rv as Card['rank'], suit: sv as Card['suit'] };
      out.push({ path: `${path}.{${rk},${sk}}`, card });
    }
  }
  for (const [k, v] of entries) {
    sightings(k, `${path}.<chave ${k}>`, out);
    sightings(v, `${path}.${k}`, out);
  }
}

/** Mesma varredura sobre TODOS os refs que o decoder guarda (inclusive os soltos, fora da árvore). */
export function refSightings(decoder: RefHolder): Sighting[] {
  const out: Sighting[] = [];
  // Identidade dos ArraySchema `manilhaCards` (propriedade do nó Hand): só os itens deles são isentos.
  const manilhaArrays = new Set<unknown>();
  for (const ref of decoder.root.refs.values()) {
    const arr = (ref as { manilhaCards?: unknown }).manilhaCards;
    if (arr !== undefined && arr !== null) manilhaArrays.add(arr);
  }
  for (const [id, ref] of decoder.root.refs) {
    const r = ref as { toJSON?: () => unknown };
    const start = out.length;
    sightings(typeof r.toJSON === 'function' ? r.toJSON() : ref, `ref#${id}`, out);
    if (manilhaArrays.has(ref)) {
      for (let i = start; i < out.length; i++) (out[i] as Sighting).manilhaItem = true;
    }
  }
  return out;
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
  /** Se informado, varre também todos os refs do decoder (não só a árvore do `toJSON`). */
  readonly decoder?: RefHolder;
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
  const found: Sighting[] = [];
  sightings(json, 'state', found);
  if (opts.decoder !== undefined) found.push(...refSightings(opts.decoder));
  // Manilhas fixas (Mineiro) são regra pública: só o campo `hand.manilhaCards` pode citá-las.
  const fixed = new Set((series.match.hand.variant.fixedManilhas ?? []).map(key));
  for (const f of found) {
    const inTree = /^(state|ref#\d+)(\.hand)?\.manilhaCards\[\d+\]$/.test(f.path);
    if ((inTree || f.manilhaItem === true) && fixed.has(key(f.card))) continue;
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
  const found: Sighting[] = [];
  sightings(e, 'event', found);
  if (found.length === 0) return [];
  if (e.type !== 'cardPlayed') return [`${label}: carta em evento ${e.type}`];
  if (e.covered && e.seat !== viewer)
    return [`${label}: coberta alheia (assento ${e.seat}) revelada`];
  return [];
}

/** Parte do estado derivada da série (o que `projectState` recalcula a cada ação). */
export function publicSig(json: unknown): string {
  const j = json as { game?: unknown; hand?: unknown; series?: unknown };
  return JSON.stringify([j.game, j.hand, j.series]);
}

/**
 * Histórico da verdade do servidor, uma entrada por versão da série. Cada patch é conferido contra
 * a versão que o gerou (achada pela parte pública do estado), e não contra a série atual: uma carta
 * alheia que vazou num patch e foi aberta logo depois continua sendo vazamento.
 */
export class TruthLog {
  private readonly versions: { series: SeriesState; pub: string }[] = [];
  private readonly cursor = new Map<number, number>();

  get size(): number {
    return this.versions.length;
  }

  /**
   * Registra uma versão. `serverJson` = `state.toJSON()` do servidor já projetado; sem ele, a parte
   * pública esperada é recalculada com `projectState` num estado descartável.
   */
  record(series: SeriesState, serverJson?: unknown): void {
    let pub: string;
    if (serverJson !== undefined) pub = publicSig(serverJson);
    else {
      const scratch = createTableState('SCRATCH0', {
        variant: 'paulista',
        format: 'single',
        ironHand: true,
        visibility: 'private',
      });
      projectState(series, scratch);
      pub = publicSig(scratch.toJSON());
    }
    this.versions.push({ series, pub });
  }

  /** Violações de um patch do `seat`, contra a verdade do instante em que ele foi emitido. */
  violations(json: unknown, seat: Seat, label: string, opts: LeakOptions = {}): string[] {
    const sig = publicSig(json);
    const from = this.cursor.get(seat) ?? 0;
    const idx = this.versions.findIndex((v, i) => i >= from && v.pub === sig);
    if (idx < 0) {
      return [
        `${label}: estado do cliente não corresponde a nenhuma versão do servidor (desde ${from})`,
      ];
    }
    this.cursor.set(seat, idx);
    return leakViolations(
      json,
      (this.versions[idx] as { series: SeriesState }).series,
      seat,
      label,
      opts,
    );
  }
}
