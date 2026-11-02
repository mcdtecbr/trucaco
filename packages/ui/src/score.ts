import type { HandEndReason, Team } from '@trucaco/protocol';
import { ABSENT } from '@trucaco/protocol';

export type TrickMark = 'won' | 'lost' | 'draw' | 'pending';

export const MAX_TRICKS = 3;

/**
 * Marcas das 3 vazas para uma dupla, lidas do snapshot (`hand.tricks[i].winnerTeam`; -1 = empate).
 * Vaza ainda não decidida (ausente da lista) = `pending`. Não decide nada: só traduz o que o servidor mandou.
 */
export function trickMarks(
  tricks: readonly { readonly winnerTeam: number }[],
  team: number,
): TrickMark[] {
  return Array.from({ length: MAX_TRICKS }, (_, i): TrickMark => {
    const t = tricks[i];
    if (t === undefined) return 'pending';
    if (t.winnerTeam === team) return 'won';
    return t.winnerTeam === ABSENT ? 'draw' : 'lost';
  });
}

export const MARK_TEXT: Readonly<Record<TrickMark, string>> = {
  won: 'ganhou',
  lost: 'perdeu',
  draw: 'empatou',
  pending: 'a jogar',
};

export interface HandResult {
  readonly handNumber: number;
  readonly winnerTeam: Team | null;
  readonly points: number;
  readonly reason: HandEndReason;
  readonly scores: readonly [number, number];
  /** Complemento já em texto (ex.: quem pediu o truco). Só exibido como texto. */
  readonly note?: string;
}

/** Nomes padrão das duplas, da perspectiva do jogador: "Nós" e "Eles". */
export function defaultTeamNames(myTeam: number): readonly [string, string] {
  return myTeam === 1 ? ['Eles', 'Nós'] : ['Nós', 'Eles'];
}

export function pointsText(n: number): string {
  return n === 1 ? '1 ponto' : `${n} pontos`;
}

const REASON_TEXT: Readonly<Record<HandEndReason, string>> = {
  tricks: 'nas vazas',
  betRun: 'aposta corrida',
  specialRun: 'correu da mão',
  draw: 'empate nas vazas',
};

/** Linha do histórico: "Mão 3: Nós ganharam 3 pontos (aposta corrida)". */
export function describeHandResult(r: HandResult, names: readonly [string, string]): string {
  const base =
    r.winnerTeam === null
      ? `Mão ${r.handNumber}: empatada, ninguém pontuou (${REASON_TEXT[r.reason]})`
      : `Mão ${r.handNumber}: ${pointsText(r.points)} para ${names[r.winnerTeam]} (${REASON_TEXT[r.reason]})`;
  return r.note !== undefined && r.note !== '' ? `${base}. ${r.note}` : base;
}

export interface ScoreSummaryInput {
  readonly names: readonly [string, string];
  readonly scores: readonly number[];
  readonly series: {
    readonly format: string;
    readonly games: readonly number[];
    readonly gameNumber: number;
  };
  readonly handNumber: number;
  readonly handValue: number;
  readonly special: string;
  readonly myTeam: number;
  readonly tricks: readonly { readonly winnerTeam: number }[];
}

export function specialText(special: string, variant?: string): string | null {
  if (special === 'maoDeOnze') return variant === 'mineiro' ? 'Mão de dez' : 'Mão de onze';
  if (special === 'maoDeFerro') return 'Mão de ferro';
  return null;
}

/** Resumo falado do placar inteiro (rótulo de acessibilidade do bloco). */
export function scoreSummary(s: ScoreSummaryInput, variant?: string): string {
  const me = s.myTeam === 1 ? 1 : 0;
  const them = me === 0 ? 1 : 0;
  const parts: string[] = [];
  if (s.series.format === 'bo3') {
    parts.push(
      `Série: ${s.names[me]} ${s.series.games[me] ?? 0}, ${s.names[them]} ${s.series.games[them] ?? 0}. Jogo ${s.series.gameNumber}`,
    );
  }
  parts.push(
    `Placar: ${s.names[me]} ${s.scores[me] ?? 0}, ${s.names[them]} ${s.scores[them] ?? 0}`,
  );
  if (s.handNumber > 0) {
    const sp = specialText(s.special, variant);
    parts.push(`Mão ${s.handNumber}${sp !== null ? `, ${sp}` : ''}, vale ${s.handValue}`);
    const mine = trickMarks(s.tricks, me)
      .map((m) => MARK_TEXT[m])
      .join(', ');
    parts.push(`Vazas de ${s.names[me]}: ${mine}`);
  }
  return parts.join('. ');
}
