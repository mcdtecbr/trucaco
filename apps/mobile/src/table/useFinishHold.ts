import { useEffect, useState } from 'react';

/**
 * Segura a visão `playing` por `holdMs` quando a partida acaba (`playing` -> `finished`), para a última
 * carta e a vaza aparecerem antes de a tela de resultado cobrir a mesa. Só apresentação: o estado do
 * servidor já é o final. `holdMs` 0 ou `skip` (mesa cancelada, sem vencedor) = sem pausa. A troca é
 * decidida durante a renderização, para a tela final nunca chegar a ser montada antes da pausa.
 */
export function useFinishHold(phase: string, holdMs: number, skip: boolean): string {
  const [prev, setPrev] = useState(phase);
  const [held, setHeld] = useState(false);
  if (phase !== prev) {
    setPrev(phase);
    setHeld(prev === 'playing' && phase === 'finished' && holdMs > 0 && !skip);
  }
  useEffect(() => {
    if (!held) return undefined;
    const t = setTimeout(() => setHeld(false), holdMs);
    return () => clearTimeout(t);
  }, [held, holdMs]);
  return held && phase === 'finished' ? 'playing' : phase;
}
