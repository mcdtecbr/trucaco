// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
          collectPlays={[
            { seat: 1, rank: 'K', suit: 'copas', covered: true },
            { seat: 2, rank: '3', suit: 'paus', covered: false },
          ]}
        />,
      ),
    );
    const html = host.innerHTML;
    expect(html).toContain('três de paus');
    expect(html).not.toContain('rei de copas');
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
