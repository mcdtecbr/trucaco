import type { LegalActionId } from '@trucaco/protocol';
import { parseLegalAction } from '@trucaco/protocol';
import { parseFace } from './cardInfo';

export interface HandCardView {
  readonly index: number;
  /** `null` se a identidade não é reconhecida (dado inesperado do servidor): carta só de verso. */
  readonly face: ReturnType<typeof parseFace>;
  /** Id da ação "jogar aberta" se o servidor a listou. */
  readonly play: LegalActionId | null;
  /** Id da ação "jogar coberta" se o servidor a listou. */
  readonly playCovered: LegalActionId | null;
}

/**
 * Casa cada carta da mão com as ações legais enviadas pelo servidor. NÃO decide nada: uma carta
 * sem ação listada fica desabilitada. Os ids devolvidos são exatamente os que o servidor mandou.
 */
export function handCardViews(
  hand: readonly { readonly rank: string; readonly suit: string }[],
  legalActions: readonly string[],
): HandCardView[] {
  const play = new Set<string>();
  const covered = new Set<string>();
  for (const id of legalActions) {
    const a = parseLegalAction(id);
    if (a?.kind === 'play') play.add(`${a.card.rank}${a.card.suit}`);
    else if (a?.kind === 'playCovered') covered.add(`${a.card.rank}${a.card.suit}`);
  }
  return hand.map((c, index) => {
    const face = parseFace(c);
    const key = face === null ? '' : `${face.rank}${face.suit}`;
    return {
      index,
      face,
      play: face !== null && play.has(key) ? (`play:${key}` as LegalActionId) : null,
      playCovered:
        face !== null && covered.has(key) ? (`playCovered:${key}` as LegalActionId) : null,
    };
  });
}

/** Quais cartas às cegas (0..2) estão jogáveis. Devolve o id por índice, ou `null`. */
export function blindActions(
  count: number,
  legalActions: readonly string[],
): (LegalActionId | null)[] {
  const ok = new Set<number>();
  for (const id of legalActions) {
    const a = parseLegalAction(id);
    if (a?.kind === 'playBlind') ok.add(a.index);
  }
  return Array.from({ length: Math.max(0, Math.min(3, count)) }, (_, i) =>
    ok.has(i) ? (`playBlind:${i as 0 | 1 | 2}` as LegalActionId) : null,
  );
}

/** Há alguma jogada coberta disponível (o contêiner mostra o botão "Cobrir"). */
export function canCover(legalActions: readonly string[]): boolean {
  return legalActions.some((id) => parseLegalAction(id)?.kind === 'playCovered');
}
