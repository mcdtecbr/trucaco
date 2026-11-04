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

  // Fatia 3: 13 Numbers (com `brows` e `nose`), 6 rostos, 6 estilos de olho, 4 sobrancelhas e 8 narizes.
  // O .riv guarda o nome das animações (não o dos objetos): confere a última timeline de cada dimensão.
  it('tem as animações dos rostos, olhos, sobrancelhas e narizes da Fatia 3', () => {
    for (const name of ['face_5', 'eyes_5', 'brows_3', 'nose_7']) {
      expect(text.includes(name), `animação ausente no .riv: ${name}`).toBe(true);
    }
  });

  // Fatia 4: 15 Numbers (com `beard` e `hat`), 19 cabelos, 5 barbas e 11 chapéus. O .riv guarda o nome das
  // animações (não o dos objetos): confere a última timeline de cada dimensão.
  it('tem um input Number para cada parte do avatar (15)', () => {
    expect(AVATAR_PART_KEYS).toHaveLength(15);
    for (const key of AVATAR_PART_KEYS) {
      expect(text.includes(key), `input ausente no .riv: ${key}`).toBe(true);
    }
  });

  it('tem as animações dos cabelos, barbas e chapéus da Fatia 4', () => {
    for (const name of ['hair_18', 'beard_4', 'hat_10']) {
      expect(text.includes(name), `animação ausente no .riv: ${name}`).toBe(true);
    }
  });
});
