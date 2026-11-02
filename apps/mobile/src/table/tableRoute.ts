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

/** Janela de revanche pronta para desenhar. `null` = oculta (sem prazo publicado, mesa cancelada). */
export interface RematchView {
  /** Prazo no relógio do servidor. */
  readonly deadlineAt: number;
  readonly iVoted: boolean;
  readonly votes: number;
  /** Apelidos de quem já votou (inclui eu). */
  readonly voters: readonly string[];
  /** Posso votar agora (falta o prazo, que a tela confere com o relógio). */
  readonly canVote: boolean;
}

export function rematchView(vm: TableViewModel | null): RematchView | null {
  if (vm === null || !vm.rematchOpen) return null;
  return {
    deadlineAt: vm.rematchDeadlineAt,
    iVoted: vm.iVotedRematch,
    votes: vm.rematchVotes.length,
    voters: vm.rematchVotes.map((s) => vm.seats[s]?.nickname ?? '').filter((n) => n !== ''),
    canVote: !vm.iVotedRematch && vm.mySeat >= 0,
  };
}

/** Segundos que faltam (arredondado para cima) no relógio do servidor; nunca negativo. */
export function secondsLeft(deadlineAt: number, clientNow: number, clockOffsetMs: number): number {
  return Math.max(0, Math.ceil((deadlineAt - (clientNow + clockOffsetMs)) / 1000));
}

export type FinishedOutcome = 'won' | 'lost' | 'cancelled' | 'unknown';

export interface FinishedResult {
  readonly outcome: FinishedOutcome;
  readonly title: string;
  /** Linhas de placar já formatadas (jogo e, na série, os jogos ganhos). */
  readonly lines: readonly string[];
}

/**
 * Resultado da partida/série para a tela final. Quem venceu vem de `series.winnerTeam` (servidor);
 * `-1` com a mesa encerrada = cancelada. Aqui só se formata.
 */
export function finishedResult(vm: TableViewModel | null): FinishedResult {
  if (vm === null) return { outcome: 'unknown', title: 'Partida encerrada', lines: [] };
  const me = vm.myTeam;
  const them = me === 0 ? 1 : 0;
  const lines: string[] = [`Último jogo: Nós ${vm.scores[me]} × ${vm.scores[them]} Eles`];
  if (vm.series.format === 'bo3') {
    lines.unshift(`Série: Nós ${vm.series.games[me]} × ${vm.series.games[them]} Eles`);
  }
  const w = vm.series.winnerTeam;
  if (w < 0) return { outcome: 'cancelled', title: 'Mesa cancelada', lines: [] };
  return w === me
    ? { outcome: 'won', title: 'Vitória da sua dupla!', lines }
    : { outcome: 'lost', title: 'A dupla adversária venceu', lines };
}
