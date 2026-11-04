import { describe, expect, it } from 'vitest';
import {
  HTTP_ERROR_CODES,
  HTTP_ROUTES,
  ID_TOKEN_MAX_LENGTH,
  NONCE_MAX_LENGTH,
  REFRESH_TOKEN_MAX_LENGTH,
  REPORT_REASONS,
  REPORT_TEXT_MAX_LENGTH,
  isUuid,
  parseBlockRequest,
  parseDeleteAccountRequest,
  parseLinkRequest,
  parseReportRequest,
  parseSocialAuthRequest,
} from './index';

const UUID = '3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b';
const UUID2 = '11111111-2222-4333-8444-555555555555';

describe('códigos e rotas da Fase 6', () => {
  it('os 7 códigos novos estão no catálogo HTTP', () => {
    for (const c of [
      'PROVIDER_TAKEN',
      'INVALID_ID_TOKEN',
      'SOCIAL_LOGIN_DISABLED',
      'ALREADY_LINKED',
      'INVALID_REPORT',
      'INVALID_BLOCK',
      'USER_NOT_FOUND',
    ]) {
      expect(HTTP_ERROR_CODES).toContain(c);
    }
  });

  it('rotas começam com / e não se repetem', () => {
    const paths = Object.values(HTTP_ROUTES);
    expect(new Set(paths).size).toBe(paths.length);
    for (const p of paths) expect(p.startsWith('/')).toBe(true);
    expect(HTTP_ROUTES.publicProfile).toBe('/users/:id');
  });

  it('motivos de denúncia espelham o enum do banco', () => {
    expect([...REPORT_REASONS]).toEqual([
      'cheating',
      'abusive_chat',
      'offensive_nickname',
      'harassment',
      'other',
    ]);
  });

  it('isUuid', () => {
    expect(isUuid(UUID)).toBe(true);
    expect(isUuid(UUID.toUpperCase())).toBe(true);
    expect(isUuid('abc')).toBe(false);
    expect(isUuid(`${UUID}x`)).toBe(false);
    expect(isUuid(5)).toBe(false);
  });
});

describe('parseSocialAuthRequest / parseLinkRequest', () => {
  it('aceita com e sem nonce', () => {
    expect(parseSocialAuthRequest({ provider: 'google', idToken: 'a.b.c' })).toEqual({
      provider: 'google',
      idToken: 'a.b.c',
    });
    expect(parseLinkRequest({ provider: 'apple', idToken: 'x', nonce: 'n1' })).toEqual({
      provider: 'apple',
      idToken: 'x',
      nonce: 'n1',
    });
  });

  it('recusa chave extra, tipo errado, provedor inválido e vazios', () => {
    expect(parseSocialAuthRequest({ provider: 'google', idToken: 'x', extra: 1 })).toBeNull();
    expect(parseSocialAuthRequest({ provider: 'guest', idToken: 'x' })).toBeNull();
    expect(parseSocialAuthRequest({ provider: 'google', idToken: 5 })).toBeNull();
    expect(parseSocialAuthRequest({ provider: 'google', idToken: '' })).toBeNull();
    expect(parseSocialAuthRequest({ provider: 'google' })).toBeNull();
    expect(parseSocialAuthRequest({ provider: 'google', idToken: 'x', nonce: 3 })).toBeNull();
    expect(parseSocialAuthRequest({ provider: 'google', idToken: 'x', nonce: '' })).toBeNull();
    expect(
      parseSocialAuthRequest({ provider: 'google', idToken: 'x', nonce: undefined }),
    ).toBeNull();
    for (const bad of [null, undefined, 'x', 3, [], [{ provider: 'google', idToken: 'x' }]]) {
      expect(parseSocialAuthRequest(bad)).toBeNull();
    }
  });

  it('limites de tamanho', () => {
    const ok = 'a'.repeat(ID_TOKEN_MAX_LENGTH);
    expect(parseSocialAuthRequest({ provider: 'google', idToken: ok })).not.toBeNull();
    expect(parseSocialAuthRequest({ provider: 'google', idToken: ok + 'a' })).toBeNull();
    const n = 'n'.repeat(NONCE_MAX_LENGTH);
    expect(parseSocialAuthRequest({ provider: 'apple', idToken: 'x', nonce: n })).not.toBeNull();
    expect(parseSocialAuthRequest({ provider: 'apple', idToken: 'x', nonce: n + 'n' })).toBeNull();
  });

  it('prototype pollution: __proto__ como chave própria e protótipo estranho', () => {
    const polluted: unknown = JSON.parse(
      '{"provider":"google","idToken":"x","__proto__":{"admin":true}}',
    );
    expect(parseSocialAuthRequest(polluted)).toBeNull();
    class Evil {
      provider = 'google';
      idToken = 'x';
    }
    expect(parseSocialAuthRequest(new Evil())).toBeNull();
    const nullProto = Object.assign(Object.create(null) as object, {
      provider: 'google',
      idToken: 'x',
    });
    expect(parseSocialAuthRequest(nullProto)).toEqual({ provider: 'google', idToken: 'x' });
    expect(({} as Record<string, unknown>)['admin']).toBeUndefined();
  });
});

describe('parseDeleteAccountRequest', () => {
  it('válido, chave extra, tipo, limite e pollution', () => {
    expect(parseDeleteAccountRequest({ refreshToken: 'r' })).toEqual({ refreshToken: 'r' });
    expect(parseDeleteAccountRequest({ refreshToken: 'r', all: true })).toBeNull();
    expect(parseDeleteAccountRequest({ refreshToken: 1 })).toBeNull();
    expect(parseDeleteAccountRequest({ refreshToken: '' })).toBeNull();
    expect(parseDeleteAccountRequest({})).toBeNull();
    expect(
      parseDeleteAccountRequest({ refreshToken: 'a'.repeat(REFRESH_TOKEN_MAX_LENGTH + 1) }),
    ).toBeNull();
    expect(
      parseDeleteAccountRequest(JSON.parse('{"refreshToken":"r","__proto__":{"x":1}}')),
    ).toBeNull();
  });
});

describe('parseBlockRequest', () => {
  it('válido, chave extra, não UUID, tipo e pollution', () => {
    expect(parseBlockRequest({ userId: UUID })).toEqual({ userId: UUID });
    expect(parseBlockRequest({ userId: UUID, x: 1 })).toBeNull();
    expect(parseBlockRequest({ userId: 'nope' })).toBeNull();
    expect(parseBlockRequest({ userId: 7 })).toBeNull();
    expect(parseBlockRequest({})).toBeNull();
    expect(parseBlockRequest([UUID])).toBeNull();
    expect(
      parseBlockRequest(JSON.parse('{"userId":"' + UUID + '","__proto__":{"a":1}}')),
    ).toBeNull();
  });
});

describe('ids em minúsculas e texto da denúncia limpo', () => {
  it('parsers devolvem ids em minúsculas (a caixa não contorna comparações)', () => {
    expect(parseBlockRequest({ userId: UUID.toUpperCase() })).toEqual({ userId: UUID });
    expect(
      parseReportRequest({
        userId: UUID.toUpperCase(),
        matchId: UUID2.toUpperCase(),
        reason: 'other',
      }),
    ).toEqual({ userId: UUID, matchId: UUID2, reason: 'other' });
  });

  it('recusa NUL, controle C0, bidi e formatação no texto', () => {
    for (const text of ['a\u0000b', 'a\u0007b', 'a\u001Bb', 'a‮b', 'a⁦b', 'a​b']) {
      expect(parseReportRequest({ userId: UUID, reason: 'other', text })).toBeNull();
    }
  });

  it('quebra de linha e tabulação viram espaço; texto só de espaços é recusado', () => {
    expect(parseReportRequest({ userId: UUID, reason: 'other', text: 'a\nb\tc' })).toEqual({
      userId: UUID,
      reason: 'other',
      text: 'a b c',
    });
    expect(parseReportRequest({ userId: UUID, reason: 'other', text: '  \n ' })).toBeNull();
  });
});

describe('parseReportRequest', () => {
  it('aceita o mínimo e o completo', () => {
    expect(parseReportRequest({ userId: UUID, reason: 'cheating' })).toEqual({
      userId: UUID,
      reason: 'cheating',
    });
    expect(
      parseReportRequest({ userId: UUID, matchId: UUID2, reason: 'other', text: 'o que houve' }),
    ).toEqual({ userId: UUID, matchId: UUID2, reason: 'other', text: 'o que houve' });
  });

  it('todos os motivos do catálogo passam e fora dele não', () => {
    for (const reason of REPORT_REASONS) {
      expect(parseReportRequest({ userId: UUID, reason })).not.toBeNull();
    }
    expect(parseReportRequest({ userId: UUID, reason: 'spam' })).toBeNull();
    expect(parseReportRequest({ userId: UUID, reason: 'abuse' })).toBeNull();
    expect(parseReportRequest({ userId: UUID })).toBeNull();
  });

  it('chave extra, tipos errados e ids inválidos', () => {
    expect(parseReportRequest({ userId: UUID, reason: 'other', extra: 1 })).toBeNull();
    expect(parseReportRequest({ userId: 'x', reason: 'other' })).toBeNull();
    expect(parseReportRequest({ userId: UUID, reason: 'other', matchId: 'x' })).toBeNull();
    expect(parseReportRequest({ userId: UUID, reason: 'other', matchId: 5 })).toBeNull();
    expect(parseReportRequest({ userId: UUID, reason: 'other', text: 5 })).toBeNull();
    expect(parseReportRequest({ userId: UUID, reason: 'other', text: '' })).toBeNull();
    expect(parseReportRequest({ userId: UUID, reason: 'other', text: undefined })).toBeNull();
    expect(parseReportRequest(null)).toBeNull();
  });

  it('limite do texto', () => {
    const ok = 'a'.repeat(REPORT_TEXT_MAX_LENGTH);
    expect(parseReportRequest({ userId: UUID, reason: 'other', text: ok })).not.toBeNull();
    expect(parseReportRequest({ userId: UUID, reason: 'other', text: ok + 'a' })).toBeNull();
  });

  it('prototype pollution', () => {
    const base = '"userId":"' + UUID + '","reason":"other"';
    expect(parseReportRequest(JSON.parse('{' + base + ',"__proto__":{"admin":true}}'))).toBeNull();
    expect(parseReportRequest(JSON.parse('{' + base + ',"constructor":{"x":1}}'))).toBeNull();
    expect(({} as Record<string, unknown>)['admin']).toBeUndefined();
  });
});
