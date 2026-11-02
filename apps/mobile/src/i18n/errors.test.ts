import { ERROR_CODES, HTTP_ERROR_CODES } from '@trucaco/protocol';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../net/api';
import { GameClientError } from '../net/colyseus';
import { SessionRequiredError } from '../net/session';
import {
  ALL_KNOWN_CODES,
  CLIENT_ERROR_CODES,
  errorCodeOf,
  errorMessage,
  hasMessage,
  messageForError,
  withRetry,
} from './errors';

describe('i18n de erros', () => {
  it('TODO código de HTTP_ERROR_CODES tem mensagem', () => {
    const missing = HTTP_ERROR_CODES.filter((c) => !hasMessage(c));
    expect(missing).toEqual([]);
  });

  it('todo código do canal da sala e do cliente tem mensagem', () => {
    expect(ERROR_CODES.filter((c) => !hasMessage(c))).toEqual([]);
    expect(CLIENT_ERROR_CODES.filter((c) => !hasMessage(c))).toEqual([]);
    expect(ALL_KNOWN_CODES.length).toBeGreaterThan(HTTP_ERROR_CODES.length);
  });

  it('textos curtos, em pt-BR e sem vazar o código interno nem detalhes', () => {
    for (const code of ALL_KNOWN_CODES) {
      const text = errorMessage(code);
      expect(text.length).toBeGreaterThan(5);
      expect(text.length).toBeLessThanOrEqual(100);
      expect(text).not.toMatch(/[A-Z]{3,}_[A-Z_]+/); // sem FOO_BAR cru
      expect(text.toLowerCase()).not.toMatch(
        /stack|undefined|exception|http|redis|postgres|jwt|token/,
      );
    }
  });

  it('mesa inexistente, cheia ou fechada tem UMA mensagem (não revela existência)', () => {
    expect(errorMessage('TABLE_UNAVAILABLE')).toBe(errorMessage('ROOM_FULL'));
  });

  it('código desconhecido (servidor mais novo) cai no genérico, sem eco', () => {
    expect(errorMessage('ALGO_NOVO')).toBe(errorMessage('UNKNOWN'));
    expect(errorMessage(undefined)).toBe(errorMessage('UNKNOWN'));
    expect(errorMessage('toString')).toBe(errorMessage('UNKNOWN'));
  });

  it('extrai o código de ApiError, GameClientError e sessão ausente; resto vira UNKNOWN', () => {
    const api = new ApiError({ status: 409, code: 'NICKNAME_TAKEN', kind: 'http' });
    expect(errorCodeOf(api)).toBe('NICKNAME_TAKEN');
    expect(messageForError(api)).toBe(errorMessage('NICKNAME_TAKEN'));
    expect(errorCodeOf(new GameClientError('JOIN_FAILED', new Error('segredo')))).toBe(
      'JOIN_FAILED',
    );
    expect(errorCodeOf(new SessionRequiredError())).toBe('SESSION_REQUIRED');
    expect(errorCodeOf(new Error('boom segredo'))).toBe('UNKNOWN');
    expect(messageForError(new Error('boom segredo'))).not.toContain('segredo');
  });

  it('withRetry acrescenta o Retry-After arredondado para cima', () => {
    expect(withRetry('QUEUE_COOLDOWN', 12.2)).toContain('(13 s)');
    expect(withRetry('QUEUE_COOLDOWN', undefined)).toBe(errorMessage('QUEUE_COOLDOWN'));
    expect(withRetry('QUEUE_COOLDOWN', 0)).toBe(errorMessage('QUEUE_COOLDOWN'));
  });
});
