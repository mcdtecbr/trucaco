/**
 * Piso de latência das respostas RECUSADAS de `POST /tables/join` (anti oráculo de tempo): código
 * inexistente (caminho rápido) e mesa que existe mas recusou a reserva (caminho que passa pela sala)
 * demoram quase o mesmo. Relógio, espera e sorteio injetáveis: o teste cobre a lógica sem depender de tempo.
 */
export interface LatencyDeps {
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  /** Inteiro em [0, max). */
  readonly rand: (max: number) => number;
}

/** Jitter pequeno em cima do piso: 1/4 dele. */
export const jitterFor = (floorMs: number): number => Math.floor(floorMs / 4);

/**
 * Espera o que falta para completar `floorMs + jitter` desde `startedAt`. `floorMs <= 0` desliga.
 * Devolve quanto esperou (ms).
 */
export async function holdUntilFloor(
  startedAt: number,
  floorMs: number,
  deps: LatencyDeps,
): Promise<number> {
  if (floorMs <= 0) return 0;
  const jitter = jitterFor(floorMs);
  const target = floorMs + (jitter > 0 ? deps.rand(jitter + 1) : 0);
  const remaining = target - (deps.now() - startedAt);
  if (remaining <= 0) return 0;
  await deps.sleep(remaining);
  return remaining;
}
