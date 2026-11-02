import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from './index';

describe('ErrorCode', () => {
  it('únicos, com os do motor e os do servidor', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    expect(ERROR_CODES).toHaveLength(26);
    for (const c of [
      'GAME_FINISHED',
      'SERIES_FINISHED',
      'NOT_YOUR_TURN',
      'RATE_LIMITED',
      'TOKEN_EXPIRED',
      'REMATCH_NOT_AVAILABLE',
    ]) {
      expect(ERROR_CODES).toContain(c);
    }
  });
});
