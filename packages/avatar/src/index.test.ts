import { describe, expect, it } from 'vitest';
import { SIGNAL_IDS } from '@trucaco/protocol';
import { signalTrigger } from './index';

describe('avatar', () => {
  it('todo sinal do protocolo tem um trigger Rive trig_<id>', () => {
    for (const id of SIGNAL_IDS) {
      expect(signalTrigger(id)).toBe(`trig_${id}`);
    }
  });
});
