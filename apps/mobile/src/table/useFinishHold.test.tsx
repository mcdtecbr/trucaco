// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFinishHold } from './useFinishHold';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let shown = '';
function Probe(p: { phase: string; holdMs: number; skip?: boolean }) {
  shown = useFinishHold(p.phase, p.holdMs, p.skip ?? false);
  return null;
}
const render = (phase: string, holdMs: number, skip = false): void =>
  act(() => root.render(<Probe phase={phase} holdMs={holdMs} skip={skip} />));

beforeEach(() => {
  vi.useFakeTimers();
  root = createRoot(document.createElement('div'));
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe('useFinishHold', () => {
  it('playing -> finished: mantém a mesa pela pausa e depois mostra o resultado', () => {
    render('playing', 2200);
    render('finished', 2200);
    expect(shown).toBe('playing');
    act(() => void vi.advanceTimersByTime(2199));
    expect(shown).toBe('playing');
    act(() => void vi.advanceTimersByTime(1));
    expect(shown).toBe('finished');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sem pausa (E2E) ou mesa cancelada: finished na hora', () => {
    render('playing', 0);
    render('finished', 0);
    expect(shown).toBe('finished');
    act(() => root.unmount());
    root = createRoot(document.createElement('div'));
    render('playing', 2200, true);
    render('finished', 2200, true);
    expect(shown).toBe('finished');
  });

  it('entrar já em finished (reconexão) não faz pausa', () => {
    render('finished', 2200);
    expect(shown).toBe('finished');
  });
});
