import { SFX_IDS } from '@trucaco/protocol';
import { describe, expect, it } from 'vitest';
import { SOUNDBOARD_SFX } from './sfx';

describe('soundboard x protocolo', () => {
  it('SFX_IDS e SOUNDBOARD_SFX têm exatamente os mesmos ids', () => {
    expect(SOUNDBOARD_SFX.map((s) => s.id).sort()).toEqual([...SFX_IDS].sort());
  });
});
