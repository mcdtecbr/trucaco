import { describe, expect, it } from 'vitest';
import { betButtons, betCorner, cornerMinWidth, spacing } from '@trucaco/ui';
import { SEAT_AVATAR_SIZE } from '../screens/SeatAvatar';

/** Cenarios reais de `legalActions` (Paulista e Mineiro; o rotulo vem so do valor, nao do tamanho). */
const SCENARIOS: readonly (readonly [string, readonly string[]])[] = [
  ['pedir truco', ['bet']],
  ['responder com aumento', ['accept', 'run', 'bet']],
  ['responder sem aumento (12)', ['accept', 'run']],
  ['mao de onze/dez', ['specialPlay', 'specialRun']],
];

const DOCK_PAD = spacing.sm * 2;
const SIGNAL_BTN = 72;

function corner(legal: readonly string[]): number {
  const c = betCorner(betButtons(legal, { nextValue: 6, pendingValue: 3 }));
  return cornerMinWidth(c.side.length, c.main !== null);
}

describe('dock sem sobreposicao (larguras minimas, rotulos quebram em duas linhas)', () => {
  for (const W of [360, 390]) {
    for (const [name, legal] of SCENARIOS) {
      // Cobrir só existe quando há carta jogável, nunca junto de correr/aceitar/jogar a mão.
      for (const cover of legal.length === 1 ? [false, true] : [false]) {
        it(`retrato ${W}: ${name}${cover ? ' com Cobrir' : ''}`, () => {
          const left = SIGNAL_BTN + (cover ? spacing.sm + SIGNAL_BTN : 0);
          const need = left + spacing.sm + corner(legal);
          expect(need).toBeLessThanOrEqual(W - DOCK_PAD);
        });
      }
    }
  }

  for (const [name, legal] of SCENARIOS) {
    it(`deitado 667: ${name}`, () => {
      const mine = SEAT_AVATAR_SIZE.landscape + 6 + spacing.sm + SIGNAL_BTN;
      const hand = 3 * 64;
      const need = mine + hand + corner(legal) + 2 * spacing.sm;
      expect(need).toBeLessThanOrEqual(667 - DOCK_PAD);
    });
  }

  it('o principal fica por ultimo e sem vaga reservada quando nao ha aumento', () => {
    const noMain = betCorner(betButtons(['specialPlay', 'specialRun']));
    expect(noMain.main).toBeNull();
    expect(cornerMinWidth(2, false)).toBeLessThan(cornerMinWidth(2, true));
  });

  it('rotulos visiveis e acessiveis completos', () => {
    const b = betButtons(['specialPlay', 'specialRun', 'accept', 'run']);
    expect(b.map((x) => x.accessibilityLabel).sort()).toEqual(
      ['Aceitar', 'Correr da aposta', 'Correr da mão', 'Jogar a mão'].sort(),
    );
  });
});
