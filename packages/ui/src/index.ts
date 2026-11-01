/** Posição de um assento na tela, relativa ao jogador local (eu embaixo). */
export type ScreenPosition = 'self' | 'right' | 'partner' | 'left';

const POSITIONS_4: readonly ScreenPosition[] = ['self', 'right', 'partner', 'left'];

/**
 * Onde desenhar o assento `seat` para quem está sentado em `mySeat`.
 * A ordem de jogo é anti-horária: o próximo assento fica à direita na tela.
 * Mesa de 6 será especificada na Fase 8.
 */
export function screenPosition(mySeat: number, seat: number, seats = 4): ScreenPosition {
  if (seats !== 4) {
    throw new RangeError(`Mesa de ${seats} assentos ainda não é suportada`);
  }
  const offset = (((seat - mySeat) % seats) + seats) % seats;
  return POSITIONS_4[offset] as ScreenPosition;
}
