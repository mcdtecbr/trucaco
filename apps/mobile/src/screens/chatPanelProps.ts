/** Montagem pura das props do `ChatPanel` (testável sem React nem `getApp`). */
import type { ChatScope } from '@trucaco/protocol';
import type { TableController } from '../table/tableController';
import type { ChatEntry } from '../table/tableStore';
import type { ChatPanelProps } from './ChatPanel';

export interface ChatPanelInput {
  chatOpen: boolean;
  chatTab: ChatScope;
  chat: readonly ChatEntry[];
  chatUnread: Readonly<Record<ChatScope, number>>;
  chatDraft: Readonly<Record<ChatScope, string>>;
  /** Texto pt-BR já traduzido, ou null. */
  errorText: string | null;
  connected: boolean;
  nicknameOf(seat: number): string;
  mySeat: number;
  /** Abas permitidas (espera: só `table`). Omitido = todas. */
  scopes?: readonly ChatScope[];
  table: Pick<
    TableController,
    'setChatTab' | 'setChatDraft' | 'sendChat' | 'sendPhrase' | 'setChatOpen'
  >;
}

export function buildChatPanelProps(i: ChatPanelInput): ChatPanelProps | null {
  if (!i.chatOpen) return null;
  const { scopes, table } = i;
  // Com abas limitadas, o escopo ativo é sempre um permitido (o store pode ter ficado em 'partner').
  const tab =
    scopes !== undefined && !scopes.includes(i.chatTab) ? (scopes[0] ?? i.chatTab) : i.chatTab;
  return {
    tab,
    chat: i.chat,
    unread: i.chatUnread,
    draft: i.chatDraft[tab],
    errorText: i.errorText,
    connected: i.connected,
    nicknameOf: i.nicknameOf,
    mySeat: i.mySeat,
    ...(scopes !== undefined ? { scopes } : {}),
    on: {
      setTab: (scope) => table.setChatTab(scope),
      setDraft: (text) => table.setChatDraft(tab, text),
      send: () => void table.sendChat(tab, i.chatDraft[tab]),
      phrase: (id) => void table.sendPhrase(tab, id),
      close: () => table.setChatOpen(false),
    },
  };
}
