import { describe, expect, it } from 'vitest';
import { AVATAR_PART_COUNTS, AVATAR_PART_KEYS, DEFAULT_AVATAR_PARTS } from '@trucaco/protocol';
import { BG_COLORS, SKIN_COLORS } from './parts';
import { PARTS, artGroup, countVertices, groupParts, resolveFill, selectParts } from './art';

const base = DEFAULT_AVATAR_PARTS;

describe('arte do avatar (mesmos paths do rig)', () => {
  it('tem os 65 paths do rig, com nomes únicos e orçamento de vértices', () => {
    expect(PARTS).toHaveLength(65);
    expect(new Set(PARTS.map((p) => p.name)).size).toBe(PARTS.length);
    expect(PARTS.reduce((s, p) => s + countVertices(p.d), 0)).toBeLessThanOrEqual(420);
  });

  it('todo `when` aponta para parte e valor dentro do catálogo', () => {
    for (const p of PARTS) {
      if (!p.when) continue;
      expect(AVATAR_PART_KEYS, p.name).toContain(p.when.key);
      expect(p.when.value, p.name).toBeGreaterThanOrEqual(0);
      expect(p.when.value, p.name).toBeLessThan(AVATAR_PART_COUNTS[p.when.key]);
    }
  });

  it('toda combinação seleciona sem path órfão e cada path pertence a um grupo', () => {
    for (const p of PARTS) {
      if (p.name !== 'BG') expect(artGroup(p), p.name).not.toBeNull();
    }
    // varre cada parte com as demais em 0 e algumas combinações cruzadas
    for (const key of AVATAR_PART_KEYS) {
      for (let v = 0; v < AVATAR_PART_COUNTS[key]; v++) {
        const parts = { ...base, [key]: v };
        const selected = selectParts(parts);
        expect(selected.length).toBeGreaterThan(5);
        expect(selected.every((p) => !p.hidden)).toBe(true);
        for (const p of selected) expect(resolveFill(p.fill, parts)).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    }
    let seed = 7;
    const next = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let i = 0; i < 300; i++) {
      const parts = Object.fromEntries(
        AVATAR_PART_KEYS.map((k) => [k, next(AVATAR_PART_COUNTS[k])]),
      ) as unknown as typeof base;
      // cada parte com `when` é escolhida exatamente quando sua condição vale
      for (const p of PARTS.filter((q) => q.when && !q.hidden)) {
        expect(selectParts(parts).includes(p), p.name).toBe(p.when!(parts));
      }
      // exatamente um rosto, um olho de cada lado por estilo, uma boca (2 lábios)
      const names = selectParts(parts).map((p) => p.name);
      expect(names.filter((n) => n.startsWith('face_'))).toHaveLength(1);
      expect(names.filter((n) => /^mouth_\d_/.test(n))).toHaveLength(2);
      expect(names.filter((n) => /^eye_white_\d$/.test(n))).toHaveLength(1);
      expect(names.filter((n) => /^eye_white_\d_r$/.test(n))).toHaveLength(1);
    }
  });

  it('desenha na ordem de sobreposição (layer crescente)', () => {
    const layers = selectParts({ ...base, hair: 3, accessory: 2, outfit: 4 }).map((p) => p.layer);
    expect(layers).toEqual([...layers].sort((a, b) => a - b));
  });

  it('cada variante de cada parte muda a seleção ou as cores', () => {
    for (const key of AVATAR_PART_KEYS) {
      const seen = new Set<string>();
      for (let v = 0; v < AVATAR_PART_COUNTS[key]; v++) {
        const parts = { ...base, [key]: v };
        seen.add(
          selectParts(parts)
            .map((p) => `${p.name}:${resolveFill(p.fill, parts)}`)
            .join('|'),
        );
      }
      // hair 0 (careca) e accessory 0 mudam a seleção; nenhuma variante repete outra
      expect(seen.size, key).toBe(AVATAR_PART_COUNTS[key]);
    }
  });

  it('língua e interior da boca ficam ocultos em repouso e só entram com withHidden', () => {
    expect(groupParts('tongue', base)).toHaveLength(0);
    expect(groupParts('tongue', base, true).map((p) => p.name)).toEqual(['mouth_inside', 'tongue']);
  });

  it('cores de pele e fundo vêm do catálogo do rig', () => {
    expect(resolveFill('skin', { ...base, skin: 2 })).toBe(SKIN_COLORS[2]!.base);
    expect(resolveFill('shade', { ...base, skin: 2 })).toBe(SKIN_COLORS[2]!.shade);
    expect(resolveFill('bg', { ...base, bg_color: 7 })).toBe(BG_COLORS[7]);
  });

  it('conta vértices de elipse e retângulo', () => {
    expect(countVertices('M0,0L1,0L1,1L0,1Z')).toBe(4);
    expect(countVertices('M0,0C1,1 2,2 3,3Q4,4 5,5Z')).toBe(3);
  });
  it('a ordem efetiva de desenho (cabelo de trás/orelhas, corpo, cabeça) segue as camadas do rig', () => {
    // O pescoço fica atrás da roupa e as orelhas e o cabelo de trás atrás do pescoço; o rosto vem depois.
    for (const outfit of [0, 1, 2, 3, 4, 5]) {
      for (const hair of [0, 2, 3]) {
        const c = { ...DEFAULT_AVATAR_PARTS, outfit, hair };
        const drawn = (['headBack', 'body', 'head'] as const)
          .flatMap((g) => groupParts(g, c))
          .map((p) => p.name);
        const expected = PARTS.filter((p) => !p.when || p.when(c))
          .filter((p) => ['headBack', 'body', 'head'].includes(artGroup(p) ?? ''))
          .map((p, i) => ({ p, i }))
          .sort((a, b) => a.p.layer - b.p.layer || a.i - b.i)
          .map(({ p }) => p.name);
        expect(drawn, `outfit ${outfit} hair ${hair}`).toEqual(expected);
      }
    }
  });
});
