import { describe, expect, it } from 'vitest';
import { screenPosition } from './index';

describe('screenPosition', () => {
  it('o jogador local fica embaixo e o parceiro (assento oposto) em cima', () => {
    expect(screenPosition(1, 1)).toBe('self');
    expect(screenPosition(1, 3)).toBe('partner');
  });

  it('o próximo a jogar fica à direita e o anterior à esquerda', () => {
    expect(screenPosition(3, 0)).toBe('right');
    expect(screenPosition(0, 3)).toBe('left');
  });

  it('recusa mesa de 6 até a Fase 8', () => {
    expect(() => screenPosition(0, 1, 6)).toThrow(RangeError);
  });
});
