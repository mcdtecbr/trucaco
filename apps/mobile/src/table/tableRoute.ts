/**
 * Lógica pura da tela dona da sala `/table/[code]`: qual visão mostrar por fase, qual faixa de conexão e
 * o "aluguel" da sala (a sala só é largada quando a tela sai de verdade, nunca ao mudar de fase).
 */
import type { RoomConnection } from '../store/roomStore';
import type { TableViewModel } from './projectTable';
import type { TableNotice } from './tableStore';

export type RoomView = 'waiting' | 'playing' | 'finished';

/** Fase do servidor -> visão. Fase desconhecida/ausente cai na espera (estado ainda não chegou). */
export function roomViewFor(phase: string): RoomView {
  return phase === 'playing' || phase === 'finished' ? phase : 'waiting';
}

export type ConnectionBanner = 'reconnecting' | 'closed' | 'reconnected' | null;

export function connectionBanner(
  connection: RoomConnection,
  notice: TableNotice,
): ConnectionBanner {
  if (connection === 'reconnecting') return 'reconnecting';
  if (connection === 'closed') return 'closed';
  return notice === 'reconnected' ? 'reconnected' : null;
}

/**
 * Chamar UMA vez, no efeito de montagem da tela dona da sala (deps `[]`). O cleanup devolvido é o único
 * ponto que larga a sala (leave consentido: o bot assume). Mudar de `waiting` para `playing` apenas troca
 * a visão e NÃO passa por aqui.
 */
export function holdRoom(rooms: { leave(): Promise<void> }): () => void {
  return () => {
    void rooms.leave();
  };
}

/** Placar final em texto ("Nós 12 × 8 Eles"), ou `null` sem estado. Só formata o que o servidor mandou. */
export function finishedSummary(vm: TableViewModel | null): string | null {
  if (vm === null) return null;
  const me = vm.myTeam;
  const them = me === 0 ? 1 : 0;
  const game = `Nós ${vm.scores[me]} × ${vm.scores[them]} Eles`;
  if (vm.series.format !== 'bo3') return game;
  return `Série: Nós ${vm.series.games[me]} × ${vm.series.games[them]} Eles. Último jogo: ${game}`;
}
