import { RANKS, SUITS, parseClientMessage } from '@trucaco/protocol';
import { describe, expect, it } from 'vitest';
import { messageForAction, payloadOf } from './actionMessage';

describe('messageForAction', () => {
  it('traduz cada tipo de ação legal', () => {
    expect(messageForAction('play:3paus')).toEqual({
      type: 'play',
      card: { rank: '3', suit: 'paus' },
    });
    expect(messageForAction('playCovered:Kouros')).toEqual({
      type: 'play',
      card: { rank: 'K', suit: 'ouros' },
      covered: true,
    });
    expect(messageForAction('playBlind:2')).toEqual({ type: 'playBlind', index: 2 });
    expect(messageForAction('bet')).toEqual({ type: 'bet' });
    expect(messageForAction('accept')).toEqual({ type: 'accept' });
    expect(messageForAction('run')).toEqual({ type: 'run' });
    expect(messageForAction('specialPlay')).toEqual({ type: 'special', decision: 'play' });
    expect(messageForAction('specialRun')).toEqual({ type: 'special', decision: 'run' });
  });

  it('toda carta do baralho gera uma mensagem aceita pela porta de entrada do servidor', () => {
    for (const rank of RANKS) {
      for (const suit of SUITS) {
        const msg = messageForAction(`play:${rank}${suit}`);
        expect(msg).not.toBeNull();
        expect(parseClientMessage(msg).ok).toBe(true);
      }
    }
  });

  it.each([
    '',
    'hack',
    'play:',
    'play:9paus',
    'playBlind:3',
    'chat',
    'signal',
    'voteCancel',
    ' bet',
  ])('id fora do formato (%j) não vira mensagem', (id) => {
    expect(messageForAction(id)).toBeNull();
  });

  it('payload nunca leva type nem seat', () => {
    const msg = messageForAction('play:3paus');
    expect(msg).not.toBeNull();
    const payload = payloadOf(msg!);
    expect(payload).toEqual({ card: { rank: '3', suit: 'paus' } });
    expect(Object.keys(payload)).not.toContain('seat');
    expect(payloadOf({ type: 'bet' })).toEqual({});
  });
});
