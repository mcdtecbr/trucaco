import { describe, expect, it } from 'vitest';
import {
  CHAT_MAX_LENGTH,
  PARTNER_CODE_MAX_LENGTH,
  parseClientMessage,
  type ClientMessage,
} from './index';

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
    for (const type of [
      'bet',
      'accept',
      'run',
      'voteCancel',
      'voteRematch',
      'ready',
      'fillBots',
    ] as const) {
      ok({ type }, { type });
      bad({ type, extra: 1 });
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
    bad({ type: 'chat', scope: 'table', text: t + 'a' }, 'CHAT_BLOCKED');
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
    bad({ type: 'chat', scope: 'table', text: '   ' }, 'CHAT_BLOCKED');
    bad({ type: 'chat', scope: 'table', text: 5 });
    bad({ type: 'chat', scope: 'table', text: 'x'.repeat(100_000) }, 'CHAT_BLOCKED');
    bad({ type: 'chat', scope: 'table', text: 'oi', phraseId: 'good_luck' });
  });
});

describe('chat: caracteres perigosos', () => {
  it('emoji com ZWJ é CHAT_BLOCKED, e formato malformado continua INVALID_PAYLOAD', () => {
    bad({ type: 'chat', scope: 'table', text: '👨‍👩‍👧' }, 'CHAT_BLOCKED');
    bad({ type: 'chat', scope: 'table', text: '👨‍👩‍👧', seat: 1 });
    bad({ type: 'chat', scope: 'x', text: '👨‍👩‍👧' });
    bad({ type: 'chat', scope: 'table', text: 7 });
  });
  const chat = (text: string): unknown => ({ type: 'chat', scope: 'table', text });
  it('rejeita zero-width, bidi, controle, BOM e surrogate solto', () => {
    for (const t of [
      'a​b',
      'a‌b',
      'a‍b',
      'a‮b',
      'a‪b',
      'a⁦b',
      'a⁩b',
      'a\u0000b',
      'a\u001bb',
      'a\u007fb',
      'a\u0085b',
      'a﻿b',
      'a\uD800b',
      '\uDC00',
      'ab\uD83D',
    ]) {
      bad(chat(t), 'CHAT_BLOCKED');
    }
  });
  it('quebras de linha e tab viram espaço', () => {
    ok(chat('a\nb\r\nc\td'), { type: 'chat', scope: 'table', text: 'a b  c d' });
    bad(chat('\n \t\r'), 'CHAT_BLOCKED');
    bad(chat('   '), 'CHAT_BLOCKED');
  });
  it('zalgo: até 3 combinantes passam, mais que 3 (após NFC) rejeitam', () => {
    ok(chat('é̂̃'.normalize('NFD')), {
      type: 'chat',
      scope: 'table',
      text: 'é̂̃'.normalize('NFC'),
    });
    bad(chat('a' + '́'.repeat(139)), 'CHAT_BLOCKED');
    bad(chat('a' + '́'.repeat(5)), 'CHAT_BLOCKED');
  });
  it('normaliza NFC e conta o limite em code points depois', () => {
    ok(chat('é'), { type: 'chat', scope: 'table', text: 'é' });
    ok(chat('😀'.repeat(CHAT_MAX_LENGTH)), {
      type: 'chat',
      scope: 'table',
      text: '😀'.repeat(CHAT_MAX_LENGTH),
    });
    bad(chat('😀'.repeat(CHAT_MAX_LENGTH + 1)), 'CHAT_BLOCKED');
    bad(chat('a'.repeat(CHAT_MAX_LENGTH * 2 + 1)), 'CHAT_BLOCKED');
  });
  it('texto normal pt-BR, emoji e HTML passam intactos (escape é do cliente)', () => {
    for (const text of ['Ação já! Truco, são três cartões 👍🏽', '<img src=x onerror=alert(1)>']) {
      ok(chat(text), { type: 'chat', scope: 'table', text });
    }
  });
});

describe('parseClientMessage robustez', () => {
  it('ignora/rejeita propriedades herdadas', () => {
    bad(Object.create({ type: 'bet' }));
    bad(Object.assign(Object.create({ card: { rank: '3', suit: 'paus' } }), { type: 'play' }));
    bad(Object.assign(Object.create({ phraseId: 'good_luck' }), { type: 'chat', scope: 'table' }));
    bad({ type: 'play', card: Object.create({ rank: '3', suit: 'paus' }) });
  });
  it('getter que lança e Proxy hostil viram INVALID_PAYLOAD', () => {
    bad({
      type: 'bet',
      get x(): never {
        throw new Error('boom');
      },
    });
    const proxy = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error('boom');
        },
      },
    );
    bad(proxy);
  });
  it('getter que muda de valor: cada propriedade é lida uma vez', () => {
    let reads = 0;
    const raw = {
      type: 'signal',
      get signalId(): string {
        reads += 1;
        return reads === 1 ? 'wink' : 'inexistente';
      },
    };
    ok(raw, { type: 'signal', signalId: 'wink' });
    expect(reads).toBe(1);
  });
});

describe('setCode (combinado da dupla)', () => {
  it('aceita sinal do catálogo e limpa o texto como o chat', () => {
    ok(
      { type: 'setCode', signalId: 'wink', meaning: '  tenho zap ' },
      { type: 'setCode', signalId: 'wink', meaning: 'tenho zap' },
    );
    ok(
      { type: 'setCode', signalId: 'nod', meaning: 'a\nb' },
      { type: 'setCode', signalId: 'nod', meaning: 'a b' },
    );
  });
  it('significado vazio ou só espaços apaga o combinado', () => {
    ok(
      { type: 'setCode', signalId: 'wink', meaning: '' },
      { type: 'setCode', signalId: 'wink', meaning: '' },
    );
    ok(
      { type: 'setCode', signalId: 'wink', meaning: '   ' },
      { type: 'setCode', signalId: 'wink', meaning: '' },
    );
  });
  it('teto de 60 code points: 60 passa, 61 vira CHAT_BLOCKED', () => {
    const sixty = 'é'.repeat(PARTNER_CODE_MAX_LENGTH);
    ok(
      { type: 'setCode', signalId: 'wink', meaning: sixty },
      { type: 'setCode', signalId: 'wink', meaning: sixty },
    );
    bad({ type: 'setCode', signalId: 'wink', meaning: sixty + 'x' }, 'CHAT_BLOCKED');
    bad({ type: 'setCode', signalId: 'wink', meaning: 'x'.repeat(5000) }, 'CHAT_BLOCKED');
  });
  it('texto sujo (ZWJ, controle, bidi, zalgo) vira CHAT_BLOCKED', () => {
    for (const meaning of ['a‍b', 'a b', 'a‮b', 'a' + '́'.repeat(6)]) {
      bad({ type: 'setCode', signalId: 'wink', meaning }, 'CHAT_BLOCKED');
    }
  });
  it('id fora do catálogo, tipos errados e campos extras (seat) são INVALID_PAYLOAD', () => {
    bad({ type: 'setCode', signalId: 'inexistente', meaning: 'x' });
    bad({ type: 'setCode', signalId: 'wink' });
    bad({ type: 'setCode', meaning: 'x' });
    bad({ type: 'setCode', signalId: 'wink', meaning: 5 });
    bad({ type: 'setCode', signalId: 7, meaning: 'x' });
    bad({ type: 'setCode', signalId: 'wink', meaning: 'x', seat: 1 });
    bad({ type: 'setCode', signalId: '__proto__', meaning: 'x' });
  });
});

describe('botSeat e fillBots (bots de vaga)', () => {
  it('aceita botSeat com target 0..3 e enabled booleano', () => {
    for (const target of [0, 1, 2, 3]) {
      ok({ type: 'botSeat', target, enabled: true }, { type: 'botSeat', target, enabled: true });
    }
    ok(
      { type: 'botSeat', target: 2, enabled: false },
      { type: 'botSeat', target: 2, enabled: false },
    );
  });

  it('rejeita seat, campos extras, target fora de 0..3 e tipos errados', () => {
    bad({ type: 'botSeat', seat: 1, target: 2, enabled: true });
    bad({ type: 'botSeat', target: 2, enabled: true, extra: 1 });
    bad({ type: 'botSeat', target: 4, enabled: true });
    bad({ type: 'botSeat', target: -1, enabled: true });
    bad({ type: 'botSeat', target: 1.5, enabled: true });
    bad({ type: 'botSeat', target: '1', enabled: true });
    bad({ type: 'botSeat', target: 1, enabled: 1 });
    bad({ type: 'botSeat', target: 1 });
    bad({ type: 'botSeat', enabled: true });
    bad({ type: 'fillBots', target: 1 });
  });
});
