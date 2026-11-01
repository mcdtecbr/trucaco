import { describe, expect, it } from 'vitest';
import { holdUntilFloor, jitterFor } from './minLatency';
import type { LatencyDeps } from './minLatency';

function fake(
  startNow: number,
  randValue = 0,
): { deps: LatencyDeps; slept: number[]; t: { v: number } } {
  const t = { v: startNow };
  const slept: number[] = [];
  return {
    t,
    slept,
    deps: {
      now: () => t.v,
      sleep: (ms) => {
        slept.push(ms);
        t.v += ms;
        return Promise.resolve();
      },
      rand: () => randValue,
    },
  };
}

describe('piso de latência das recusas', () => {
  it('resposta rápida espera até o piso; o total é sempre piso + jitter sorteado', async () => {
    const f = fake(1000, 0);
    const waited = await holdUntilFloor(1000, 200, f.deps);
    expect(waited).toBe(200);
    expect(f.t.v - 1000).toBe(200);
    const g = fake(1000, jitterFor(200)); // jitter máximo (inclusivo)
    await holdUntilFloor(1000, 200, g.deps);
    expect(g.t.v - 1000).toBe(200 + 50);
  });

  it('caminho lento (já passou do piso) não espera mais nada; o que falta é descontado', async () => {
    const slow = fake(1500, 0);
    expect(await holdUntilFloor(1000, 200, slow.deps)).toBe(0);
    expect(slow.slept).toEqual([]);
    const mid = fake(1120, 0);
    await holdUntilFloor(1000, 200, mid.deps);
    expect(mid.slept).toEqual([80]);
  });

  it('rápido e lento terminam no mesmo instante (sem jitter): não há oráculo de tempo', async () => {
    const fast = fake(1000, 0);
    const slow = fake(1000, 0);
    slow.t.v += 90; // a sala demorou mais
    await holdUntilFloor(1000, 200, fast.deps);
    await holdUntilFloor(1000, 200, slow.deps);
    expect(fast.t.v).toBe(slow.t.v);
  });

  it('piso 0 desliga', async () => {
    const f = fake(0);
    expect(await holdUntilFloor(0, 0, f.deps)).toBe(0);
    expect(f.slept).toEqual([]);
  });
});
