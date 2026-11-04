import { describe, expect, it } from 'vitest';
import {
  HTTP_ERROR_CODES,
  RESERVATION_TTL_SECONDS,
  WS_BEARER_PROTOCOL,
  isHttpErrorCode,
} from './index';

describe('http', () => {
  it('códigos únicos, ordenados e com os de handshake e de refresh', () => {
    expect(new Set(HTTP_ERROR_CODES).size).toBe(HTTP_ERROR_CODES.length);
    expect([...HTTP_ERROR_CODES]).toEqual([...HTTP_ERROR_CODES].sort());
    expect(HTTP_ERROR_CODES).toHaveLength(40);
    for (const c of ['INVALID_REFRESH_TOKEN', 'BO3_REQUIRES_PRIVATE', 'TABLE_UNAVAILABLE']) {
      expect(HTTP_ERROR_CODES).toContain(c);
    }
  });

  it('isHttpErrorCode', () => {
    expect(isHttpErrorCode('RATE_LIMITED')).toBe(true);
    expect(isHttpErrorCode('NOPE')).toBe(false);
    expect(isHttpErrorCode('__proto__')).toBe(false);
    expect(isHttpErrorCode(undefined)).toBe(false);
  });

  it('constantes', () => {
    expect(RESERVATION_TTL_SECONDS).toBe(15);
    expect(WS_BEARER_PROTOCOL).toBe('trucaco.bearer');
  });
});
