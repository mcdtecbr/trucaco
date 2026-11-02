/**
 * Relógio do servidor − relógio do cliente, a partir do `at` das mensagens do servidor. Cada amostra é
 * `at - recebidoEm` (a latência de ida faz a amostra ficar um pouco abaixo do offset real); a mediana de
 * uma janela curta suaviza picos e descarta replays antigos (um evento de 60 s atrás é um ponto isolado).
 */
export const OFFSET_WINDOW = 9;
/** Amostras absurdas (relógio zerado, replay muito antigo) são ignoradas. */
export const OFFSET_MAX_ABS_MS = 10 * 60 * 1000;

export interface ClockOffset {
  /** Registra uma amostra e devolve o offset atual. Entrada inválida não muda nada. */
  add(serverAt: number, clientNow: number): number;
  get(): number;
  reset(): void;
}

export function createClockOffset(windowSize = OFFSET_WINDOW): ClockOffset {
  let samples: number[] = [];
  let current = 0;
  return {
    add(serverAt, clientNow) {
      if (!Number.isFinite(serverAt) || !Number.isFinite(clientNow) || serverAt <= 0)
        return current;
      const sample = serverAt - clientNow;
      if (Math.abs(sample) > OFFSET_MAX_ABS_MS) return current;
      samples.push(sample);
      if (samples.length > windowSize) samples = samples.slice(-windowSize);
      const sorted = [...samples].sort((a, b) => a - b);
      current = Math.round(sorted[Math.floor(sorted.length / 2)] as number);
      return current;
    },
    get: () => current,
    reset() {
      samples = [];
      current = 0;
    },
  };
}
