import { describe, expect, it } from 'vitest';
import { CHAT_MAX_LENGTH, parseClientMessage, type ClientMessage } from './index';

const ok = (raw: unknown, message: ClientMessage): void =>
  expect(parseClientMessage(raw)).toEqual({ ok: true, message });
const bad = (raw: unknown, code = 'INVALID_PAYLOAD'): void =>
  expect(parseClientMessage(raw)).toEqual({ ok: false, code });

describe('parseClientMessage válidas', () => {
  it('aceita todas as mensagens', () => {
    const card = { rank: '3', suit: 'paus' } as const;
    ok({ type: 'play', card }, { type: 'play', card });
    ok({ type: 'play', card, covered: true }, { type: 'play', card, covered: true });
    ok({ type: 'playBlind', index: 0 }, { type: 'playBlind', index: 0 });
    for (const type of ['bet', 'accept', 'run', 'voteCancel', 'ready'] as const) {
      ok({ type }, { type });
    }
    ok({ type: 'special', decision: 'run' }, { type: 'special', decision: 'run' });
    ok({ type: 'signal', signalId: 'wink' }, { type: 'signal', signalId: 'wink' });
    ok({ type: 'sfx', sfxId: 'horn' }, { type: 'sfx', sfxId: 'horn' });
    ok(
      { type: 'chat', scope: 'table', text: '  oi  ' },
      { type: 'chat', scope: 'table', text: 'oi' },
    );
    ok(
      { type: 'chat', scope: 'partner', phraseId: 'good_luck' },
      { type: 'chat', scope: 'partner', phraseId: 'good_luck' },
    );
  });
  it('texto no limite passa e acima falha', () => {
    const t = 'a'.repeat(CHAT_MAX_LENGTH);
    ok({ type: 'chat', scope: 'table', text: t }, { type: 'chat', scope: 'table', text: t });
    bad({ type: 'chat', scope: 'table', text: t + 'a' });
  });
});

describe('parseClientMessage inválidas', () => {
  it('não-objetos', () => {
    for (const raw of [null, undefined, [], 'play', 42, true, () => 1]) bad(raw);
  });
  it('type ausente, errado ou desconhecido', () => {
    bad({});
    bad({ type: 1 });
    bad({ type: 'hack' });
    bad({ type: '__proto__' });
  });
  it('seat vindo do cliente é rejeitado', () => {
    bad({ type: 'bet', seat: 1 });
    bad({ type: 'play', card: { rank: '3', suit: 'paus' }, seat: 0 });
    bad({ type: 'chat', scope: 'table', text: 'oi', seat: 2 });
  });
  it('campos extras', () => {
    bad({ type: 'accept', foo: 1 });
    bad({ type: 'play', card: { rank: '3', suit: 'paus', extra: 1 } });
  });
  it('cartas inválidas', () => {
    bad({ type: 'play' });
    bad({ type: 'play', card: null });
    bad({ type: 'play', card: { rank: '8', suit: 'paus' } });
    bad({ type: 'play', card: { rank: '3', suit: 'clubs' } });
    bad({ type: 'play', card: { rank: 3, suit: 'paus' } });
    bad({ type: 'play', card: { rank: '3', suit: 'paus' }, covered: 'yes' });
  });
  it('playBlind index inválido', () => {
    for (const index of [-1, 1.5, NaN, Infinity, 3, '0', null, undefined]) {
      bad({ type: 'playBlind', index });
    }
  });
  it('special', () => {
    bad({ type: 'special' });
    bad({ type: 'special', decision: 'maybe' });
  });
  it('catálogos', () => {
    bad({ type: 'signal', signalId: 'nope' }, 'INVALID_SIGNAL');
    bad({ type: 'signal', signalId: 5 });
    bad({ type: 'sfx', sfxId: 'nope' }, 'INVALID_SFX');
    bad({ type: 'sfx' });
    bad({ type: 'chat', scope: 'table', phraseId: 'nope' });
  });
  it('chat', () => {
    bad({ type: 'chat', scope: 'all', text: 'oi' });
    bad({ type: 'chat', text: 'oi' });
    bad({ type: 'chat', scope: 'table' });
    bad({ type: 'chat', scope: 'table', text: '   ' });
    bad({ type: 'chat', scope: 'table', text: 5 });
    bad({ type: 'chat', scope: 'table', text: 'x'.repeat(100_000) });
    bad({ type: 'chat', scope: 'table', text: 'oi', phraseId: 'good_luck' });
  });
});
