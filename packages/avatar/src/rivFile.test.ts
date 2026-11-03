import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AVATAR_PART_KEYS } from '@trucaco/protocol';
import { RIVE_CONTRACT } from './riveContract';

const RIV = resolve(__dirname, '../../../assets/rive/avatar.riv');

describe('assets/rive/avatar.riv', () => {
  // O .riv guarda os nomes dos inputs como texto: confere que cada trigger e Number do contrato existe.
  const text = readFileSync(RIV).toString('latin1');

  it('tem o cabeçalho RIVE e cabe no limite de 500 KB', () => {
    expect(text.startsWith('RIVE')).toBe(true);
    expect(readFileSync(RIV).byteLength).toBeLessThan(500 * 1024);
  });

  it('tem um trigger para cada sinal do contrato (16, com trig_mouth_open)', () => {
    for (const trigger of Object.values(RIVE_CONTRACT.triggers)) {
      expect(text.includes(trigger), `trigger ausente no .riv: ${trigger}`).toBe(true);
    }
    expect(Object.keys(RIVE_CONTRACT.triggers)).toHaveLength(16);
  });

  // Fatia 2: o .riv exportado guarda o nome das animações (não o dos objetos): confere as timelines novas.
  it('tem as animações da 5ª boca e dos sinais de boca aberta e língua', () => {
    for (const name of ['mouth_4', 'sig_mouth_open', 'sig_tongue']) {
      expect(text.includes(name), `animação ausente no .riv: ${name}`).toBe(true);
    }
  });

  it('tem um input Number para cada parte do avatar', () => {
    for (const key of AVATAR_PART_KEYS) {
      expect(text.includes(key), `input ausente no .riv: ${key}`).toBe(true);
    }
  });
});
