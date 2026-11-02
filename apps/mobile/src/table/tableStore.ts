/**
 * Estado da mesa no cliente: a projeção de `room.state` (`vm`, substituída inteira a cada patch) mais
 * estado de UI local (carta selecionada, ação em voo, aviso). A fonte de verdade continua sendo o
 * servidor: nada aqui decide jogada.
 */
import type { ChatScope } from '@trucaco/protocol';
import type { HandResult } from '@trucaco/ui';
import { createStore, useStore } from 'zustand';
import type { TableViewModel } from './projectTable';

export type TableNotice = 'reconnected' | null;

/** Última vaza fechada, mantida na tela por um instante depois que o servidor limpa `hand.current`. */
export interface LingeringTrick {
  readonly plays: TableViewModel['current'];
  readonly winnerSeat: number;
  readonly ownCovered: { readonly rank: string; readonly suit: string } | null;
}

/** Mensagem de chat recebida. `text` é sempre exibido como `<Text>` (nunca HTML). */
export interface ChatEntry {
  readonly id: number;
  readonly scope: ChatScope;
  readonly seat: number;
  readonly text: string;
  readonly at: number;
}

export interface TableStoreState {
  readonly vm: TableViewModel | null;
  /** Histórico das mãos, derivado de eventos. Descartado em salto de `seq`. */
  readonly history: readonly HandResult[];
  /** Linhas da mão em curso (derivadas de eventos); viram `details` ao fechar a mão. */
  readonly handLog: readonly string[];
  /** Vaza recém-fechada, ainda exibida por um instante. */
  readonly lingering: LingeringTrick | null;
  /** Modo "jogar coberta": o toque na carta seleciona `playCovered:`. */
  readonly coverMode: boolean;
  readonly chatOpen: boolean;
  readonly chatTab: ChatScope;
  readonly chat: readonly ChatEntry[];
  readonly chatUnread: Readonly<Record<ChatScope, number>>;
  readonly chatDraft: Readonly<Record<ChatScope, string>>;
  /** Código do último erro de chat (traduzido na tela). */
  readonly chatError: string | null;
  /** Servidor − cliente em ms (suavizado). */
  readonly clockOffsetMs: number;
  /** Última mensagem `turnTimer` (reserva quando o estado ainda não traz o prazo). */
  readonly timer: { readonly seat: number; readonly deadlineAt: number } | null;
  /** Ação enviada e ainda não refletida no estado (anti duplo clique). */
  readonly busy: boolean;
  /** Carta (ação legal) selecionada, aguardando confirmação. */
  readonly selected: string | null;
  /** Código do último `error` do servidor (traduzido na tela). */
  readonly errorCode: string | null;
  readonly notice: TableNotice;
  /** Aviso transitório de presença ("Ana está ausente."). */
  readonly presenceNote: string | null;
  /** Confirmação de "Sair da mesa" aberta. */
  readonly leaveConfirm: boolean;
  patch(p: Partial<Omit<TableStoreState, 'patch' | 'reset'>>): void;
  reset(): void;
}

const INITIAL = {
  vm: null as TableViewModel | null,
  history: [] as readonly HandResult[],
  handLog: [] as readonly string[],
  lingering: null as LingeringTrick | null,
  coverMode: false,
  chatOpen: false,
  chatTab: 'table' as ChatScope,
  chat: [] as readonly ChatEntry[],
  chatUnread: { table: 0, partner: 0 } as Readonly<Record<ChatScope, number>>,
  chatDraft: { table: '', partner: '' } as Readonly<Record<ChatScope, string>>,
  chatError: null as string | null,
  clockOffsetMs: 0,
  timer: null as TableStoreState['timer'],
  busy: false,
  selected: null as string | null,
  errorCode: null as string | null,
  notice: null as TableNotice,
  presenceNote: null as string | null,
  leaveConfirm: false,
};

export function createTableStore() {
  return createStore<TableStoreState>()((set) => ({
    ...INITIAL,
    patch: (p) => set(p),
    reset: () => set({ ...INITIAL }),
  }));
}

export type TableStore = ReturnType<typeof createTableStore>;
export const tableStore: TableStore = createTableStore();

export function useTableStore<T>(selector: (s: TableStoreState) => T): T {
  return useStore(tableStore, selector);
}

/** Prazo do turno: o do estado; sem ele, o da última `turnTimer` se for do assento da vez. */
export function effectiveDeadline(s: Pick<TableStoreState, 'vm' | 'timer'>): number {
  const vm = s.vm;
  if (vm === null) return 0;
  if (vm.turnDeadlineAt > 0) return vm.turnDeadlineAt;
  return s.timer !== null && s.timer.seat === vm.actingSeat ? s.timer.deadlineAt : 0;
}
