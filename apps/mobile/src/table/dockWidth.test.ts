import { describe, expect, it } from 'vitest';
import { betButtons, betCorner, cornerMinWidth, spacing } from '@trucaco/ui';
import {
  SEAT_AVATAR_SIZE,
  SEAT_AVATAR_TIGHT,
  SHORT_PHONE_HEIGHT,
  TIGHT_LANDSCAPE_HEIGHT,
} from '../screens/SeatAvatar';
import {
  CHAT_COMPACT_MIN_W,
  CHAT_CORNER_MIN_WIDTH,
  DOCK_PAD_X,
  handWidth,
  landscapeDockPlan,
  phoneDockPlan,
} from './tableGeometry';

/** Cenarios reais de `legalActions` (Paulista e Mineiro; o rotulo vem so do valor, nao do tamanho). */
const SCENARIOS: readonly (readonly [string, readonly string[]])[] = [
  ['pedir truco', ['bet']],
  ['responder com aumento', ['accept', 'run', 'bet']],
  ['responder sem aumento (12)', ['accept', 'run']],
  ['mao de onze/dez', ['specialPlay', 'specialRun']],
];

const SIGNAL_BTN = 72;
/** Sinais + Efeitos lado a lado. */
const SIGNAL_GROUP = 2 * SIGNAL_BTN + spacing.sm;

const WORST_BET = cornerMinWidth(2, true);

function corner(legal: readonly string[]): number {
  const c = betCorner(betButtons(legal, { nextValue: 6, pendingValue: 3 }));
  return cornerMinWidth(c.side.length, c.main !== null);
}

const SCEN3: readonly (readonly [string, readonly string[]])[] = [
  ...SCENARIOS,
  ['responder com aumento (3 botoes)', ['accept', 'run', 'bet']],
];

describe('dock sem quebra nem sobreposicao (arranjo atual)', () => {
  // Retrato: mao + aposta na mesma linha (`inline`) ou aposta na linha dos sinais (`below`), nunca em
  // uma terceira linha. Mao `md` abaixo de 700 de altura, `lg` acima.
  for (const [W, H] of [
    [360, 640],
    [393, 679],
    [390, 844],
  ] as const) {
    const size = H < SHORT_PHONE_HEIGHT ? 'md' : 'lg';
    for (const [name, legal] of SCEN3) {
      it(`retrato ${W}x${H}: ${name}`, () => {
        const avail = W - DOCK_PAD_X;
        const need = corner(legal);
        const plan = phoneDockPlan(avail, size, need);
        if (plan === 'inline') {
          expect(handWidth(size) + spacing.sm + need).toBeLessThanOrEqual(avail);
          // Cobrir so existe com um botao so; no retrato Sinais e Efeitos ficam empilhados (uma coluna de
          // 72), entao a linha comporta a coluna + Cobrir + chat minimo, sem tolerancia.
          if (legal.length === 1) {
            expect(2 * SIGNAL_BTN + 2 * spacing.sm + CHAT_COMPACT_MIN_W).toBeLessThanOrEqual(avail);
          }
        } else {
          // Linha dos sinais: sinais + aposta, sem Cobrir.
          // Sinais e Efeitos ficam empilhados (uma coluna de 72) quando a aposta tem 3 botoes.
          expect(SIGNAL_BTN + spacing.sm + need).toBeLessThanOrEqual(avail);
        }
      });
    }
  }

  // Paisagem: mao + aposta numa linha so, sem quebra (a dock nao cresce); os sinais nunca ficam cortados.
  for (const [W, H] of [
    [568, 320],
    [640, 360],
    [667, 375],
    [740, 360],
    [844, 390],
  ] as const) {
    const avatar = H < TIGHT_LANDSCAPE_HEIGHT ? SEAT_AVATAR_TIGHT : SEAT_AVATAR_SIZE.landscape;
    for (const [name, legal] of SCEN3) {
      it(`deitado ${W}x${H}: ${name}`, () => {
        const plan = landscapeDockPlan(W, avatar + 6, corner(legal), WORST_BET);
        // Lado a lado quando cabe; senao empilhados (uma coluna de 72, nunca cortados).
        expect(plan.leftRoom).toBeGreaterThanOrEqual(SIGNAL_BTN);
        if (!plan.stackBtns) expect(plan.leftRoom).toBeGreaterThanOrEqual(SIGNAL_GROUP);
        // O chat compacto aparece sempre que cabe ao lado dos botoes (gap real de 4), empilhados ou nao.
        const btns = plan.stackBtns ? SIGNAL_BTN : SIGNAL_GROUP;
        expect(plan.showChat).toBe(plan.leftRoom >= btns + 4 + CHAT_COMPACT_MIN_W);
        expect(plan.rightMin).toBe(
          handWidth(plan.hand) + (corner(legal) > 0 ? spacing.sm + corner(legal) : 0),
        );
        // O grupo mao + aposta cabe na linha junto do avatar e dos sinais.
        expect(
          plan.rightMin +
            (avatar + 6) +
            2 * spacing.sm +
            (plan.stackBtns ? SIGNAL_BTN : SIGNAL_GROUP),
        ).toBeLessThanOrEqual(W - DOCK_PAD_X);
      });
    }
  }

  it('celular deitado comum mantem o chat compacto (empilhando Sinais/Efeitos) com a aposta simples', () => {
    for (const [W, H] of [
      [640, 360],
      [667, 375],
      [740, 360],
      [844, 390],
    ] as const) {
      const avatar = H < TIGHT_LANDSCAPE_HEIGHT ? SEAT_AVATAR_TIGHT : SEAT_AVATAR_SIZE.landscape;
      const plan = landscapeDockPlan(W, avatar + 6, corner(['bet']), WORST_BET);
      expect(plan.showChat, `${W}x${H}`).toBe(true);
    }
  });

  it('o empilhamento nao muda com a aposta: a altura da dock e a mesma ao responder', () => {
    expect(WORST_BET).toBe(corner(['accept', 'run', 'bet']));
    for (const [W, H] of [
      [568, 320],
      [640, 360],
      [740, 360],
      [844, 390],
    ] as const) {
      const avatar = H < TIGHT_LANDSCAPE_HEIGHT ? SEAT_AVATAR_TIGHT : SEAT_AVATAR_SIZE.landscape;
      const stacks = SCEN3.map(
        ([, legal]) => landscapeDockPlan(W, avatar + 6, corner(legal), WORST_BET).stackBtns,
      );
      expect(new Set(stacks).size, `${W}x${H}`).toBe(1);
    }
  });

  it('web largo: o chat de canto so existe com largura que nao cobre a aposta', () => {
    // Grupo centralizado: sinais + efeitos (cobrir nao coexiste com 3 botoes) + mao lg + aposta (3 botoes) + chat de canto (280) + margens.
    const group =
      SIGNAL_GROUP + handWidth('lg') + 3 * spacing.md + corner(['accept', 'run', 'bet']);
    // Folga de cada lado do grupo centralizado >= chat (280) + margem; o main nao passa de 1280.
    const half = (Math.min(CHAT_CORNER_MIN_WIDTH, 1280) - group) / 2;
    expect(half).toBeGreaterThanOrEqual(280 + 2 * spacing.sm);
  });

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
