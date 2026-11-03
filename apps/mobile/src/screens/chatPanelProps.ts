/** Montagem pura das props do `ChatPanel` (testável sem React nem `getApp`). */
import type { ChatScope } from '@trucaco/protocol';
import type { TableController } from '../table/tableController';
import type { ChatEntry } from '../table/tableStore';
import { normalizeNickname } from '../platform/mutedStorageCore';
import type { ChatPanelProps, MuteEntry } from './ChatPanel';

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
  /** Abas permitidas. Omitido = todas. */
  scopes?: readonly ChatScope[];
  /** Outros jogadores e se estão silenciados neste aparelho. */
  mutes?: readonly MuteEntry[];
  toggleMute?(seat: number): void;
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
    ...(i.mutes !== undefined ? { mutes: i.mutes } : {}),
    on: {
      ...(i.toggleMute !== undefined ? { toggleMute: i.toggleMute } : {}),
      setTab: (scope) => table.setChatTab(scope),
      setDraft: (text) => table.setChatDraft(tab, text),
      send: () => void table.sendChat(tab, i.chatDraft[tab]),
      phrase: (id) => void table.sendPhrase(tab, id),
      close: () => table.setChatOpen(false),
    },
  };
}

/** Botões de silenciar: um por OUTRO jogador sentado (apelido não vazio). Preferência local. */
export function mutesFor(
  seats: readonly { readonly seat: number; readonly nickname: string }[],
  mySeat: number,
  mutedNames: readonly string[],
): MuteEntry[] {
  return seats
    .filter((s) => s.seat !== mySeat && s.nickname.trim() !== '')
    .map((s) => ({
      seat: s.seat,
      name: s.nickname,
      muted: mutedNames.includes(normalizeNickname(s.nickname)),
    }));
}

/** Balões sem os de jogadores silenciados neste aparelho. */
export function visibleBubbles<T>(
  bubbles: Readonly<Record<number, T>>,
  mutes: readonly MuteEntry[],
): Readonly<Record<number, T>> {
  const hidden = mutes.filter((m) => m.muted).map((m) => m.seat);
  if (hidden.length === 0) return bubbles;
  const out: Record<number, T> = {};
  for (const [k, v] of Object.entries(bubbles)) {
    if (!hidden.includes(Number(k))) out[Number(k)] = v;
  }
  return out;
}
