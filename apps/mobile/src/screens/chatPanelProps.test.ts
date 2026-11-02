import { describe, expect, it, vi } from 'vitest';
import { buildChatPanelProps } from './chatPanelProps';
import type { ChatPanelInput } from './chatPanelProps';

function input(over: Partial<ChatPanelInput> = {}): ChatPanelInput {
  return {
    chatOpen: true,
    chatTab: 'table',
    chat: [],
    chatUnread: { table: 0, partner: 0 },
    chatDraft: { table: 'mesa', partner: 'dupla' },
    errorText: null,
    connected: true,
    nicknameOf: () => 'Ana',
    mySeat: 0,
    table: {
      setChatTab: vi.fn(),
      setChatDraft: vi.fn(),
      sendChat: vi.fn(() => true),
      sendPhrase: vi.fn(() => true),
      setChatOpen: vi.fn(),
    },
    ...over,
  };
}

describe('buildChatPanelProps', () => {
  it('fechado: null', () => {
    expect(buildChatPanelProps(input({ chatOpen: false }))).toBeNull();
  });

  it('mesa: usa a aba e o rascunho do store e envia nesse escopo', () => {
    const i = input({ chatTab: 'partner' });
    const p = buildChatPanelProps(i)!;
    expect(p.tab).toBe('partner');
    expect(p.draft).toBe('dupla');
    expect(p.scopes).toBeUndefined();
    p.on.send();
    expect(i.table.sendChat).toHaveBeenCalledWith('partner', 'dupla');
  });

  it("espera com chatTab='partner' e scopes=['table']: cai para a Mesa (aba, rascunho, envio)", () => {
    const i = input({ chatTab: 'partner', scopes: ['table'] });
    const p = buildChatPanelProps(i)!;
    expect(p.tab).toBe('table');
    expect(p.draft).toBe('mesa');
    expect(p.scopes).toEqual(['table']);
    p.on.send();
    p.on.phrase('x');
    p.on.setDraft('oi');
    expect(i.table.sendChat).toHaveBeenCalledWith('table', 'mesa');
    expect(i.table.sendPhrase).toHaveBeenCalledWith('table', 'x');
    expect(i.table.setChatDraft).toHaveBeenCalledWith('table', 'oi');
    p.on.close();
    expect(i.table.setChatOpen).toHaveBeenCalledWith(false);
  });
});
