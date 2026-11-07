/**
 * Estado da mesa no cliente: a projeção de `room.state` (`vm`, substituída inteira a cada patch) mais
 * estado de UI local (carta selecionada, ação em voo, aviso). A fonte de verdade continua sendo o
 * servidor: nada aqui decide jogada.
 */
import type { ChatScope, SignalId } from '@trucaco/protocol';
import type { HandResult } from '@trucaco/ui';
import { createStore, useStore } from 'zustand';
import type { TableViewModel } from './projectTable';

export type TableNotice = 'reconnected' | null;

/** Última vaza fechada, mantida na tela por um instante depois que o servidor limpa `hand.current`. */
export interface LingeringTrick {
  readonly plays: TableViewModel['current'];
  readonly winnerSeat: number;
  readonly ownCovered: { readonly rank: string; readonly suit: string } | null;
  /** A vaza fechou a mão (ou a partida): a tela a segura pela pausa do fim da mão, antes de recolher. */
  readonly handEnd?: boolean;
  /** Só com `handEnd`: número da mão que acabou (para casar com o `trickDecided` que a completa). */
  readonly handNumber?: number;
  /**
   * Só com `handEnd`: a vaza fechada que ainda estava na janela de leitura quando a mão acabou (correu
   * com a vaza aberta). Recolhe junto com as cartas de `plays`.
   */
  readonly previous?: {
    readonly plays: TableViewModel['current'];
    readonly ownCovered: { readonly rank: string; readonly suit: string } | null;
  };
}

/** Mensagem de chat recebida. `text` é sempre exibido como `<Text>` (nunca HTML). */
export interface ChatEntry {
  readonly id: number;
  readonly scope: ChatScope;
  readonly seat: number;
  readonly text: string;
  readonly at: number;
}

/** Balão de chat ativo sobre um assento (o mais novo substitui o anterior). */
export interface ChatBubbleEntry {
  readonly id: number;
  readonly scope: ChatScope;
  readonly text: string;
}

/**
 * Legenda grande da fala de um avatar (grito de truco, "quero", "corro"...), ~2 s. Local: nada vai à rede.
 * `event` é o ponto de extensão para o visual do grito no avatar (boca aberta) quando existir o trigger.
 */
export interface SpeechBubbleEntry {
  readonly id: number;
  readonly event: string;
  readonly text: string;
}

/** Legenda curta de um efeito do painel (emoji sobre o avatar, ~1,5 s). Local. */
export interface SfxMarkEntry {
  readonly id: number;
  readonly icon: string;
  readonly label: string;
}

/** Sinal em animação sobre um assento. `key` muda a cada sinal (o mesmo id duas vezes anima duas vezes). */
export interface ActiveSignal {
  readonly id: SignalId;
  readonly key: number;
}

export interface TableStoreState {
  readonly vm: TableViewModel | null;
  /** Sinal animando por assento (um por vez; o controlador mantém a fila de 1 posição). */
  readonly signals: Readonly<Record<number, ActiveSignal>>;
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
  /** Balão por assento (some sozinho após ~4 s). */
  readonly bubbles: Readonly<Record<number, ChatBubbleEntry>>;
  /** Legenda da fala por assento (some sozinha após ~2 s; independente do balão de chat). */
  readonly speech: Readonly<Record<number, SpeechBubbleEntry>>;
  /** Emoji do efeito engraçado por assento (some sozinho após ~1,5 s). */
  readonly sfxMarks: Readonly<Record<number, SfxMarkEntry>>;
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
  /** Combinado da dupla (último `codes` do servidor; só a MINHA dupla o recebe). Vazio = nada combinado. */
  readonly codes: Readonly<Partial<Record<SignalId, string>>>;
  /** Painel "Combinar sinais" aberto (UI local). */
  readonly codesOpen: boolean;
  /** Código do último erro de `setCode` (traduzido na tela). */
  readonly codesError: string | null;
  /** Aviso curto quando o PARCEIRO sinaliza algo combinado ("Ana: Piscar um olho = tenho o zap"). */
  readonly partnerSignalNote: string | null;
  patch(p: Partial<Omit<TableStoreState, 'patch' | 'reset'>>): void;
  reset(): void;
}

const INITIAL = {
  vm: null as TableViewModel | null,
  signals: {} as Readonly<Record<number, ActiveSignal>>,
  history: [] as readonly HandResult[],
  handLog: [] as readonly string[],
  lingering: null as LingeringTrick | null,
  coverMode: false,
  chatOpen: false,
  chatTab: 'table' as ChatScope,
  chat: [] as readonly ChatEntry[],
  bubbles: {} as Readonly<Record<number, ChatBubbleEntry>>,
  speech: {} as Readonly<Record<number, SpeechBubbleEntry>>,
  sfxMarks: {} as Readonly<Record<number, SfxMarkEntry>>,
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
  codes: {} as Readonly<Partial<Record<SignalId, string>>>,
  codesOpen: false,
  codesError: null as string | null,
  partnerSignalNote: null as string | null,
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
