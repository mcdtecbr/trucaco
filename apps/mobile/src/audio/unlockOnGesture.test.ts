import { describe, expect, it, vi } from 'vitest';
import { GESTURE_EVENTS, unlockOnFirstGesture } from './unlockOnGesture';
import type { GestureTarget } from './unlockOnGesture';

function fakeTarget() {
  const handlers = new Map<string, Set<() => void>>();
  const target: GestureTarget = {
    addEventListener: (t, l) => {
      const set = handlers.get(t) ?? new Set();
      set.add(l);
      handlers.set(t, set);
    },
    removeEventListener: (t, l) => {
      handlers.get(t)?.delete(l);
    },
  };
  const fire = (t: string) => [...(handlers.get(t) ?? [])].forEach((l) => l());
  const count = () => [...handlers.values()].reduce((n, s) => n + s.size, 0);
  return { target, fire, count };
}

describe('unlockOnFirstGesture', () => {
  it('libera no primeiro gesto, uma vez só, e se desinscreve', () => {
    const { target, fire, count } = fakeTarget();
    const unlock = vi.fn();
    unlockOnFirstGesture(target, unlock);
    expect(count()).toBe(GESTURE_EVENTS.length);
    fire('pointerdown');
    fire('keydown');
    expect(unlock).toHaveBeenCalledTimes(1);
    expect(count()).toBe(0);
  });

  it('cancelar antes do gesto remove a escuta sem liberar', () => {
    const { target, fire, count } = fakeTarget();
    const unlock = vi.fn();
    const cancel = unlockOnFirstGesture(target, unlock);
    cancel();
    fire('click');
    expect(unlock).not.toHaveBeenCalled();
    expect(count()).toBe(0);
  });
});
