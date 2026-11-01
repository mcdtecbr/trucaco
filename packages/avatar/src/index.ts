import { SIGNAL_IDS, type SignalId } from '@trucaco/protocol';

/** Nome do input trigger da state machine Rive para cada sinal (docs/sinais.md). */
export const SIGNAL_TRIGGERS = Object.fromEntries(
  SIGNAL_IDS.map((id) => [id, `trig_${id}`]),
) as Record<SignalId, string>;

export function signalTrigger(id: SignalId): string {
  return SIGNAL_TRIGGERS[id];
}
