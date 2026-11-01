import { describe, expect, it } from 'vitest';
import { APP_NAME, describeSignalForSeat } from './index';

describe('mobile', () => {
  it('resolve as dependências internas (ui, avatar, protocol)', () => {
    expect(APP_NAME).toBe('Trucaco');
    expect(describeSignalForSeat(0, 2, 'wink')).toBe('partner:trig_wink');
  });
});
