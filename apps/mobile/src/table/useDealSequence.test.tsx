// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDealSequence } from './DealOverlay';
import type { DealSequence } from './DealOverlay';
import { dealPlan } from './dealPlan';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Props {
  key2: string;
  enabled?: boolean;
  fresh?: boolean;
}

let root: Root;
let host: HTMLElement;
let last: DealSequence;

function Probe(p: Props) {
  last = useDealSequence({
    key: p.key2,
    enabled: p.enabled ?? true,
    pe: 0,
    mySeat: 0,
    fresh: p.fresh ?? true,
  });
  return null;
}
const render = (p: Props): void => act(() => root.render(<Probe {...p} />));
const advance = (ms: number): void => act(() => void vi.advanceTimersByTime(ms));

const plan = dealPlan({ pe: 0, mySeat: 0, collect: false });
const planCollect = dealPlan({ pe: 0, mySeat: 0, collect: true });

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement('div');
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe('useDealSequence', () => {
  it('mão nova: esconde a mão e a vira, mostra a mão quando as cartas chegam, a vira no fim', () => {
    render({ key2: '1:1' });
    expect(last.phase).toBe('dealing');
    expect(last.handHidden).toBe(true);
    expect(last.viraHidden).toBe(true);
    advance(plan.selfLandedMs);
    expect(last.phase).toBe('vira');
    expect(last.handHidden).toBe(false);
    expect(last.viraHidden).toBe(true);
    advance(plan.endMs - plan.selfLandedMs + 60);
    expect(last.phase).toBe('idle');
    expect(last.viraHidden).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reconexão no meio da mão (primeira leitura sem fresh): não anima nada', () => {
    render({ key2: '1:3', fresh: false });
    expect(last.phase).toBe('idle');
    expect(last.handHidden).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('depois de montado, a troca de mão recolhe e distribui, mesmo sem fresh', () => {
    render({ key2: '1:3', fresh: false });
    render({ key2: '1:4', fresh: true });
    expect(last.phase).toBe('dealing');
    expect(last.run?.plan.collectMs).toBeGreaterThan(0);
  });

  it('troca de mão no meio da animação reinicia e limpa os timers antigos', () => {
    render({ key2: '1:1' });
    advance(300);
    render({ key2: '1:2' });
    expect(last.phase).toBe('dealing');
    expect(last.run?.plan.endMs).toBe(planCollect.endMs);
    // Os timers da primeira corrida não disparam: só restam os dois da segunda.
    expect(vi.getTimerCount()).toBe(2);
    advance(planCollect.endMs + 60);
    expect(last.phase).toBe('idle');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('desmontar no meio da animação não deixa timer', () => {
    render({ key2: '1:1' });
    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    root = createRoot(host);
  });

  it('desligada: nunca anima', () => {
    render({ key2: '1:1', enabled: false });
    render({ key2: '1:2', enabled: false });
    expect(last.phase).toBe('idle');
    expect(vi.getTimerCount()).toBe(0);
  });
});
