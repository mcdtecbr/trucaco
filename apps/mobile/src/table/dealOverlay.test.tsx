// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { Animated } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayedCards } from '@trucaco/ui';
import { DealOverlay } from './DealOverlay';
import { dealPlan } from './dealPlan';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('DealOverlay: recolher', () => {
  it('carta coberta de outro jogador sai só com verso (a identidade nunca aparece)', () => {
    const plan = dealPlan({ pe: 0, mySeat: 0, collect: true });
    act(() =>
      root.render(
        <DealOverlay
          runId={1}
          plan={plan}
          mySeat={0}
          feltSize={{ w: 400, h: 300 }}
          collectTricks={[
            {
              plays: [
                { seat: 1, rank: 'K', suit: 'copas', covered: true },
                { seat: 2, rank: '3', suit: 'paus', covered: false },
              ],
            },
          ]}
        />,
      ),
    );
    const html = host.innerHTML;
    expect(html).toContain('três de paus');
    expect(html).not.toContain('rei de copas');
  });
});

describe('DealOverlay: recolher a mão inteira', () => {
  const trick = (ranks: string[], suit: string) => ({
    plays: ranks.map((rank, seat) => ({ seat, rank, suit, covered: false })),
  });
  const count = (html: string, label: string): number => html.split(label).length - 1;

  it('recolhe as cartas de TODAS as vazas (12), cada uma com a mesma quantidade de marcações', () => {
    const plan = dealPlan({ pe: 0, mySeat: 0, collect: true });
    act(() =>
      root.render(
        <DealOverlay
          runId={1}
          plan={plan}
          mySeat={0}
          feltSize={{ w: 400, h: 300 }}
          collectTricks={[
            trick(['4', '5', '6', '7'], 'paus'),
            trick(['Q', 'J', 'K', 'A'], 'paus'),
            trick(['4', '5', '6', '7'], 'copas'),
          ]}
        />,
      ),
    );
    const html = host.innerHTML;
    const n = count(html, 'quatro de paus');
    expect(n).toBeGreaterThan(0);
    for (const label of [
      'cinco de paus',
      'seis de paus',
      'sete de paus',
      'dama de paus',
      'valete de paus',
      'rei de paus',
      'ás de paus',
      'quatro de copas',
      'cinco de copas',
      'seis de copas',
      'sete de copas',
    ]) {
      expect(count(html, label), label).toBe(n);
    }
  });

  it('a minha carta coberta mostra a face antes de virar; a dos outros, nunca', () => {
    const plan = dealPlan({ pe: 0, mySeat: 0, collect: true });
    act(() =>
      root.render(
        <DealOverlay
          runId={1}
          plan={plan}
          mySeat={0}
          feltSize={{ w: 400, h: 300 }}
          collectTricks={[
            {
              plays: [
                { seat: 0, rank: '', suit: '', covered: true },
                { seat: 1, rank: 'K', suit: 'copas', covered: true },
              ],
              ownCovered: { rank: '6', suit: 'copas' },
            },
          ]}
        />,
      ),
    );
    expect(host.innerHTML).toContain('seis de copas');
    expect(host.innerHTML).not.toContain('rei de copas');
  });

  it('sem cartas na mesa não inventa carta para recolher', () => {
    const plan = dealPlan({ pe: 0, mySeat: 0, collect: true });
    act(() =>
      root.render(
        <DealOverlay
          runId={1}
          plan={plan}
          mySeat={0}
          feltSize={{ w: 400, h: 300 }}
          collectTricks={[]}
        />,
      ),
    );
    expect(host.innerHTML).not.toContain('de paus');
  });
});

describe('PlayedCards: deslize', () => {
  const plays = [{ seat: 0, rank: '3', suit: 'paus', covered: false }];
  const cardEl = (): Element | null => host.querySelector('[aria-label="três de paus"]');

  it('armar o deslize com a carta já na vaza não remonta a carta (não anima de novo)', () => {
    act(() => root.render(<PlayedCards plays={plays} mySeat={0} slideMs={0} />));
    const before = cardEl();
    expect(before).not.toBeNull();
    act(() => root.render(<PlayedCards plays={plays} mySeat={0} slideMs={450} />));
    expect(cardEl()).toBe(before);
  });
});

describe('PlayedCards: cartas que entram juntas deslizam em fila', () => {
  const bot = (seat: number, rank: string) => ({ seat, rank, suit: 'paus', covered: false });
  const delays = (spy: { mock: { calls: readonly unknown[][] } }): number[] =>
    spy.mock.calls.map((c) => (c[1] as { delay?: number }).delay ?? 0);

  it('3 bots que jogaram durante a distribuição entram um depois do outro; a carta seguinte, sozinha, não espera', () => {
    // Montada vazia (a mesa fica vazia durante a distribuição) e depois recebe as 3 cartas de uma vez.
    act(() => root.render(<PlayedCards plays={[]} mySeat={0} slideMs={450} />));
    const spy = vi.spyOn(Animated, 'timing');
    const three = [bot(1, '4'), bot(2, '5'), bot(3, '6')];
    act(() => root.render(<PlayedCards plays={three} mySeat={0} slideMs={450} />));
    expect(delays(spy)).toEqual([0, 315, 630]);
    spy.mockClear();
    act(() =>
      root.render(<PlayedCards plays={[...three, bot(0, '7')]} mySeat={0} slideMs={450} />),
    );
    expect(delays(spy)).toEqual([0]);
    spy.mockRestore();
  });
});
