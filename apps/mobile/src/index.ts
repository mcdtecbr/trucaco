import { signalTrigger } from '@trucaco/avatar';
import type { SignalId } from '@trucaco/protocol';
import { screenPosition } from '@trucaco/ui';

export const APP_NAME = 'Trucaco';

/**
 * Esqueleto do app. O Expo (Expo Router, React Native, web) é inicializado na Fase 3;
 * até lá este pacote só prova que as dependências internas resolvem.
 */
export function describeSignalForSeat(mySeat: number, seat: number, signal: SignalId): string {
  return `${screenPosition(mySeat, seat)}:${signalTrigger(signal)}`;
}
