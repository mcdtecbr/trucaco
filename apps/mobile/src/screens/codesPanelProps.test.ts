import { describe, expect, it, vi } from 'vitest';
import { buildCodesPanelProps, humanPartnerName } from './codesPanelProps';
import { MUTE_FULL_NOTE, muteFeedback, mutesFor, visibleBubbles } from './chatPanelProps';

const seats = [
  { seat: 0, nickname: 'Ana', status: 'connected', isBot: false },
  { seat: 1, nickname: 'Bia', status: 'connected', isBot: false },
  { seat: 2, nickname: 'Caio', status: 'connected', isBot: false },
  { seat: 3, nickname: 'Davi', status: 'connected', isBot: false },
];

function input(over: Partial<Parameters<typeof buildCodesPanelProps>[0]> = {}) {
  const table = { sendCode: vi.fn(() => true), setCodesOpen: vi.fn() };
  return {
    table,
    i: {
      codesOpen: true,
      codes: { wink: 'zap' },
      codesError: null,
      seats,
      mySeat: 0,
      connected: true,
      guest: true,
      table,
      ...over,
    },
  };
}

describe('humanPartnerName', () => {
  it('é o assento oposto, só se humano e sentado', () => {
    expect(humanPartnerName(seats, 0)).toBe('Caio');
    expect(humanPartnerName(seats, 1)).toBe('Davi');
    expect(humanPartnerName(seats, -1)).toBeNull();
    const at = (over: object) => seats.map((s) => (s.seat === 2 ? { ...s, ...over } : s));
    expect(humanPartnerName(at({ isBot: true }), 0)).toBeNull();
    expect(humanPartnerName(at({ status: 'bot' }), 0)).toBeNull();
    expect(humanPartnerName(at({ status: 'empty', nickname: '' }), 0)).toBeNull();
    expect(humanPartnerName(at({ status: 'away' }), 0)).toBe('Caio');
    expect(humanPartnerName([], 0)).toBeNull();
  });
});

describe('buildCodesPanelProps', () => {
  it('fechado ou sem assento: null (espectador nunca vê o painel)', () => {
    expect(buildCodesPanelProps(input({ codesOpen: false }).i)).toBeNull();
    expect(buildCodesPanelProps(input({ mySeat: -1 }).i)).toBeNull();
  });

  it('aberto: codes, parceiro, aviso de convidado e erro traduzido', () => {
    const p = buildCodesPanelProps(input({ codesError: 'RATE_LIMITED' }).i);
    expect(p).toMatchObject({
      codes: { wink: 'zap' },
      partnerName: 'Caio',
      connected: true,
      guest: true,
      errorText: 'Aguarde um segundo antes de salvar outro sinal.',
    });
  });

  it('save e close vão para o controlador', () => {
    const { i, table } = input();
    const p = buildCodesPanelProps(i);
    expect(p?.on.save('nod', 'sim')).toBe(true);
    expect(table.sendCode).toHaveBeenCalledWith('nod', 'sim');
    p?.on.close();
    expect(table.setCodesOpen).toHaveBeenCalledWith(false);
  });
});

describe('silenciar', () => {
  it('mutesFor lista só os outros jogadores sentados e marca os silenciados', () => {
    expect(mutesFor(seats, 0, ['bia'])).toEqual([
      { seat: 1, name: 'Bia', muted: true },
      { seat: 2, name: 'Caio', muted: false },
      { seat: 3, name: 'Davi', muted: false },
    ]);
    expect(mutesFor([{ seat: 1, nickname: '' }], 0, [])).toEqual([]);
  });

  it('mutesFor não oferece silenciar bot', () => {
    expect(
      mutesFor([{ seat: 1, nickname: 'Bot 2', isBot: true }, ...seats.slice(2)], 0, []).map(
        (m) => m.seat,
      ),
    ).toEqual([2, 3]);
  });

  it('muteFeedback avisa só quando a lista está cheia', () => {
    expect(muteFeedback(true)).toBeNull();
    expect(muteFeedback(false)).toBe(MUTE_FULL_NOTE);
  });

  it('visibleBubbles esconde os balões dos silenciados', () => {
    const b = { 1: 'a', 2: 'b' };
    expect(visibleBubbles(b, [{ seat: 1, name: 'Bia', muted: true }])).toEqual({ 2: 'b' });
    expect(visibleBubbles(b, [{ seat: 1, name: 'Bia', muted: false }])).toBe(b);
  });
});
