import { describe, expect, it } from 'vitest';
import { AVATAR_PART_COUNTS, AVATAR_PART_KEYS, DEFAULT_AVATAR_PARTS } from '@trucaco/protocol';
import { BG_COLORS, EYE_COLORS, HAIR_COLORS, OUTFIT_COLORS, SKIN_COLORS } from './parts';
import { PARTS, artGroup, countVertices, groupParts, resolveFill, selectParts } from './art';

const base = DEFAULT_AVATAR_PARTS;

describe('arte do avatar (mesmos paths do rig)', () => {
  it('tem os 75 paths do rig, com nomes únicos e orçamento de vértices', () => {
    // 65 (Fatia 1) + 10: boca 4 (2), interior e dentes da boca 1 (2), interior da boca 2 (1) e 5 peças
    // ocultas da boca aberta dos sinais (dentes de cima e de baixo, lábios aberto superior e inferior,
    // língua centrada; `mouth_inside` e `tongue` já existiam). O orçamento de vértices continua 420
    // (total atual: 403): as peças novas cabem nele, então não foi elevado.
    expect(PARTS).toHaveLength(75);
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
      // exatamente um rosto, um olho de cada lado por estilo, uma boca (2 lábios + interior/dentes)
      const names = selectParts(parts).map((p) => p.name);
      expect(names.filter((n) => n.startsWith('face_'))).toHaveLength(1);
      const mouthParts = names.filter((n) => /^mouth_\d_/.test(n));
      expect(mouthParts.filter((n) => /_(upper|lower)$/.test(n))).toHaveLength(2);
      expect(new Set(mouthParts.map((n) => n[6])).size).toBe(1); // todas da mesma boca
      expect(mouthParts[0]).toMatch(new RegExp(`^mouth_${parts.mouth}_`));
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

  it('boca aberta e línguas ficam ocultas em repouso e só entram com withHidden', () => {
    for (const g of ['mouthOpen', 'tongueCenter', 'tongueSide'] as const) {
      expect(groupParts(g, base), g).toHaveLength(0);
    }
    expect(groupParts('mouthOpen', base, true).map((p) => p.name)).toEqual([
      'mouth_inside',
      'mouth_open_teeth_upper',
      'mouth_open_teeth_lower',
      'mouth_open_lower',
      'mouth_open_upper',
    ]);
    expect(groupParts('tongueCenter', base, true).map((p) => p.name)).toEqual(['tongue_center']);
    expect(groupParts('tongueSide', base, true).map((p) => p.name)).toEqual(['tongue']);
    // nenhuma peça da boca aberta cai no grupo da boca escolhida
    expect(groupParts('mouth', base, true).every((p) => /^mouth_\d_/.test(p.name))).toBe(true);
  });

  it('cores de pele e fundo vêm do catálogo do rig', () => {
    expect(resolveFill('skin', { ...base, skin: 2 })).toBe(SKIN_COLORS[2]!.base);
    expect(resolveFill('shade', { ...base, skin: 2 })).toBe(SKIN_COLORS[2]!.shade);
    expect(resolveFill('bg', { ...base, bg_color: 7 })).toBe(BG_COLORS[7]);
    expect(SKIN_COLORS).toHaveLength(8);
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

describe('cores como dimensão própria', () => {
  it('resolveFill de hair/iris por índice, todo índice válido', () => {
    for (let i = 0; i < AVATAR_PART_COUNTS.hair_color; i++) {
      expect(resolveFill('hair', { ...base, hair_color: i })).toBe(HAIR_COLORS[i]);
    }
    for (let i = 0; i < AVATAR_PART_COUNTS.eye_color; i++) {
      expect(resolveFill('iris', { ...base, eye_color: i })).toBe(EYE_COLORS[i]);
    }
    expect(resolveFill('iris', base)).toBe('#1B1B1F');
    expect(resolveFill('hair', base)).toBe('#2B1B12');
  });

  it('resolveFill de outfit: 0 = cor própria do modelo; 6..10 = cor escolhida', () => {
    for (let o = 0; o < AVATAR_PART_COUNTS.outfit; o++) {
      expect(resolveFill('outfit', { ...base, outfit: o })).toBe(OUTFIT_COLORS[o]);
    }
    for (let i = 1; i < AVATAR_PART_COUNTS.outfit_color; i++) {
      expect(resolveFill('outfit', { ...base, outfit: 2, outfit_color: i })).toBe(OUTFIT_COLORS[i]);
    }
  });

  it('o padrão preserva as cores antigas dos paths', () => {
    const legacy: Record<string, string> = {
      outfit_tee_v: '#F2A0A0',
      outfit_polo: '#0EA5E9',
      outfit_shirt: '#7C2D12',
      outfit_vest: '#1F2937',
      outfit_tank: '#F9FAFB',
      outfit_tee_crew: '#E5E7EB',
      eye_pupil_0: '#1B1B1F',
      brow_l: '#2B1B12',
      hair_short: '#2B1B12',
      acc_mustache: '#2B1B12',
    };
    for (const [name, color] of Object.entries(legacy)) {
      const p = PARTS.find((x) => x.name === name)!;
      const o = name.startsWith('outfit_')
        ? {
            outfit: [
              'outfit_tee_crew',
              'outfit_tee_v',
              'outfit_polo',
              'outfit_shirt',
              'outfit_vest',
              'outfit_tank',
            ].indexOf(name),
          }
        : {};
      expect(resolveFill(p.fill, { ...base, ...o }), name).toBe(color);
    }
  });

  it('chapéus e bonés não mudam e as cores não alteram a seleção de peças', () => {
    for (const name of ['cap_crown', 'cap_brim', 'hat_crown', 'hat_brim']) {
      expect(PARTS.find((x) => x.name === name)!.fill).toMatch(/^#/);
    }
    const names = (c: typeof base) => selectParts(c).map((p) => p.name);
    expect(names({ ...base, hair_color: 7, eye_color: 2, outfit_color: 10 })).toEqual(names(base));
  });
});
