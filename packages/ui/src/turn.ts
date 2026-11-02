import { TURN_TIMEOUT_MS } from '@trucaco/protocol';

export interface TimerState {
  readonly active: boolean;
  readonly remainingMs: number;
  /** 0..1 do tempo restante sobre o total do turno. */
  readonly fraction: number;
  /** Segundos inteiros arredondados para cima (o que o jogador lê). */
  readonly seconds: number;
  /** Poucos segundos restantes: a barra muda de cor. */
  readonly urgent: boolean;
}

/** Limite de "urgente" em ms. */
export const URGENT_MS = 5000;

/** Estado do cronômetro a partir de `turnDeadlineAt` (epoch ms; 0/negativo = sem prazo). Função pura. */
export function timerState(deadlineAt: number, now: number, totalMs = TURN_TIMEOUT_MS): TimerState {
  if (!Number.isFinite(deadlineAt) || deadlineAt <= 0) {
    return { active: false, remainingMs: 0, fraction: 0, seconds: 0, urgent: false };
  }
  const remainingMs = Math.max(0, deadlineAt - now);
  const fraction = totalMs > 0 ? Math.min(1, remainingMs / totalMs) : 0;
  return {
    active: true,
    remainingMs,
    fraction,
    seconds: Math.ceil(remainingMs / 1000),
    urgent: remainingMs <= URGENT_MS,
  };
}

export interface TickTimers {
  readonly setInterval: (fn: () => void, ms: number) => unknown;
  readonly clearInterval: (handle: unknown) => void;
}

/** Intervalo de atualização do cronômetro. */
export const TICK_MS = 250;

/** Liga um tick periódico e devolve a função que o desliga (injeta timers nos testes). */
export function startTicker(
  onTick: () => void,
  ms = TICK_MS,
  timers: TickTimers = {
    setInterval: (fn, t) => setInterval(fn, t),
    clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
  },
): () => void {
  const handle = timers.setInterval(onTick, ms);
  return () => timers.clearInterval(handle);
}
