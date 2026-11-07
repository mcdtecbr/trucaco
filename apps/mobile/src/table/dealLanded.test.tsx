// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { cardSizes } from '@trucaco/ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sideLanding, useDealLanded } from './DealOverlay';
import type { DealSequence } from './DealOverlay';
import { DEAL_FLIGHT_MS, dealPlan } from './dealPlan';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;
let seen: Readonly<Record<number, number>> | null;
const plan = dealPlan({ pe: 0, mySeat: 0, collect: false });

function Probe({ seq }: { seq: DealSequence }) {
  seen = useDealLanded(seq);
  return null;
}
const render = (seq: DealSequence): void => act(() => root.render(<Probe seq={seq} />));
const advance = (ms: number): void => act(() => void vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement('div');
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

const dealing = (id: number): DealSequence => ({
  phase: 'dealing',
  run: { id, plan },
  handHidden: true,
  viraHidden: true,
});

describe('useDealLanded: o leque de costas ganha uma carta por vez, quando ela pousa', () => {
  it('sem animação o estado manda (null); na pausa do fim da mão nenhuma carta de costas', () => {
    render({ phase: 'idle', run: null, handHidden: false, viraHidden: false });
    expect(seen).toBeNull();
    render({ phase: 'hold', run: null, handHidden: true, viraHidden: true });
    expect(seen).toEqual({});
  });

  it('começa vazio e cada assento só conta as cartas que já pousaram', () => {
    render(dealing(1));
    expect(seen).toEqual({});
    const first = plan.cards[0]!;
    advance(first.startMs + DEAL_FLIGHT_MS - 61);
    expect(seen).toEqual({});
    advance(2);
    expect(seen).toEqual({ [first.seat]: 1 });
    // Nenhum outro assento recebeu carta antes da sua vez.
    const second = plan.cards[1]!;
    advance(second.startMs - first.startMs);
    expect(seen).toEqual({ [first.seat]: 1, [second.seat]: 1 });
  });

  it('uma sequência nova não herda a contagem da anterior', () => {
    render(dealing(1));
    advance(plan.endMs);
    expect(Object.values(seen ?? {}).reduce((a, b) => a + b, 0)).toBe(plan.cards.length);
    render(dealing(2));
    expect(seen).toEqual({});
  });
});

describe('sideLanding: a carta pousa ao lado do avatar, nunca sobre o rosto', () => {
  const center = { x: 300, y: 200 };
  const avatar = 76;
  const { width: cw, height: ch } = cardSizes.sm;
  const overlapsAvatar = (c: { x: number; y: number }): boolean =>
    Math.abs(c.x - center.x) < avatar / 2 + cw / 2 &&
    Math.abs(c.y - center.y) < avatar / 2 + ch / 2;

  it.each(['down', 'left', 'right'] as const)(
    '%s: o retângulo da carta não toca o avatar',
    (dir) => {
      const c = sideLanding(center, avatar, dir);
      expect(overlapsAvatar(c)).toBe(false);
    },
  );

  it('cada direção vai para o seu lado', () => {
    expect(sideLanding(center, avatar, 'right').x).toBeGreaterThan(center.x);
    expect(sideLanding(center, avatar, 'left').x).toBeLessThan(center.x);
    expect(sideLanding(center, avatar, 'down').y).toBeGreaterThan(center.y);
  });
});
