import { describe, expect, it } from 'vitest';
import {
  AVATAR_PART_COUNTS,
  AVATAR_PART_KEYS,
  DEFAULT_AVATAR_PARTS,
  HAIR_WITHOUT_HAT,
} from '@trucaco/protocol';
import { BG_COLORS, EYE_COLORS, HAIR_COLORS, OUTFIT_COLORS, SKIN_COLORS } from './parts';
import {
  PARTS,
  artGroup,
  countVertices,
  effectiveCfg,
  groupParts,
  isShown,
  resolveFill,
  selectParts,
} from './art';

const base = DEFAULT_AVATAR_PARTS;

describe('arte do avatar (mesmos paths do rig)', () => {
  it('tem os 175 paths do rig, com nomes únicos e orçamento de vértices', () => {
    // Fatia 3: rostos (6) e olhos (6 estilos com branco, íris, miolo, pálpebra/cílios e brilho) refeitos
    // pela prancha de referência, mais 4 sobrancelhas e 8 narizes. O orçamento de vértices subiu de 420
    // para 760 (total atual: 725, ~7 KB a mais no .riv). Só as peças selecionadas são desenhadas, então o
    // custo por avatar não cresce; o teto segue valendo para a fatia 5 não estourar o arquivo sem aviso.
    // Fatia 4: 19 cabelos (frente e atrás), 4 barbas e 10 chapéus redesenhados pelas pranchas somam 175 paths
    // e 1210 vértices; o orçamento subiu de 760 para 1300 (cerca de 12 KB a mais no .riv). Cada avatar
    // desenha só uns 40 paths, então o custo de desenho por avatar segue parecido.
    expect(PARTS).toHaveLength(175);
    expect(new Set(PARTS.map((p) => p.name)).size).toBe(PARTS.length);
    expect(PARTS.reduce((s, p) => s + countVertices(p.d), 0)).toBeLessThanOrEqual(1300);
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
        expect(selectParts(parts).includes(p), p.name).toBe(isShown(p, effectiveCfg(parts)));
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
      // um nariz e um par de sobrancelhas (esquerda e direita do mesmo estilo)
      expect(names.filter((n) => /^nose(_\d)?$/.test(n))).toEqual([
        parts.nose === 0 ? 'nose' : `nose_${parts.nose}`,
      ]);
      const brows = names.filter((n) => /^brow_/.test(n));
      expect(brows).toEqual(
        parts.brows === 0
          ? ['brow_l', 'brow_r']
          : [`brow_${parts.brows}_l`, `brow_${parts.brows}_r`],
      );
    }
  });

  it('olhos, sobrancelhas e nariz novos caem nos grupos animados certos (piscar, eyebrow, nose_twitch)', () => {
    for (let eyes = 0; eyes < AVATAR_PART_COUNTS.eyes; eyes++) {
      const c = { ...base, eyes };
      const eyeParts = selectParts(c).filter((p) => p.name.startsWith('eye_'));
      // todo estilo tem as duas pontas: o lado esquerdo vai para eyeL e o espelhado para eyeR
      expect(groupParts('eyeL', c).length, `eyes ${eyes}`).toBeGreaterThanOrEqual(2);
      expect(groupParts('eyeL', c).length).toBe(groupParts('eyeR', c).length);
      expect(groupParts('eyeL', c).length + groupParts('eyeR', c).length).toBe(eyeParts.length);
    }
    for (let brows = 0; brows < AVATAR_PART_COUNTS.brows; brows++) {
      const c = { ...base, brows };
      expect(groupParts('browL', c), `brows ${brows}`).toHaveLength(1);
      expect(groupParts('browR', c)).toHaveLength(1);
      expect(groupParts('browR', c)[0]!.mirror).toBe(true);
    }
    for (let nose = 0; nose < AVATAR_PART_COUNTS.nose; nose++) {
      expect(groupParts('nose', { ...base, nose }), `nose ${nose}`).toHaveLength(1);
    }
  });

  it('os 6 rostos seguem a ordem da prancha: oval, redondo, quadrado, coração, V, longo', () => {
    const faces = [0, 1, 2, 3, 4, 5].map(
      (face_shape) =>
        selectParts({ ...base, face_shape }).find((p) => p.name.startsWith('face_'))!.name,
    );
    expect(faces).toEqual([
      'face_oval',
      'face_round',
      'face_square',
      'face_heart',
      'face_triangle',
      'face_long',
    ]);
    expect(new Set(PARTS.filter((p) => p.name.startsWith('face_')).map((p) => p.d)).size).toBe(6);
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

describe('cabelo, barba e chapéu (Fatia 4)', () => {
  const names = (c: typeof base) => selectParts(c).map((p) => p.name);

  it('hair: 19 formatos; 0 só a sombra da careca; cada um de 1..18 desenha frente e/ou atrás', () => {
    expect(AVATAR_PART_COUNTS.hair).toBe(19);
    expect(names(base).filter((n) => n.startsWith('hair_'))).toEqual(['hair_bald_shade']);
    for (let hair = 1; hair < 19; hair++) {
      const own = names({ ...base, hair }).filter((n) => n.startsWith('hair_'));
      expect(own.length, `hair ${hair}`).toBeGreaterThan(0);
      // só nós do próprio índice; nunca boné nem chapéu dentro de hair
      for (const n of own) {
        expect(n, `hair ${hair}`).toMatch(new RegExp(`^hair_${hair}_(front|back|cap|bun)$`));
      }
    }
    // o rig não tem mais boné nem chapéu dentro de hair
    expect(PARTS.some((p) => /^(cap|hat)_(crown|brim)$/.test(p.name))).toBe(false);
  });

  it('cabelo de trás fica na camada 2 (grupo headBack) e o da frente na 7', () => {
    for (const p of PARTS.filter((x) => /^hair_\d+_back$/.test(x.name))) {
      expect(p.layer, p.name).toBe(2);
      expect(artGroup(p), p.name).toBe('headBack');
    }
    for (const p of PARTS.filter((x) => /^hair_\d+_(front|cap|bun)$/.test(x.name))) {
      expect(p.layer, p.name).toBe(7);
      expect(artGroup(p), p.name).toBe('front');
    }
  });

  it('nenhum formato de cabelo repete outro (o desenho muda, não só a cor)', () => {
    const shapes = new Set<string>();
    for (let hair = 0; hair < 19; hair++) {
      shapes.add(
        selectParts({ ...base, hair })
          .filter((p) => p.name.startsWith('hair_'))
          .map((p) => p.d)
          .join('|'),
      );
    }
    expect(shapes.size).toBe(19);
  });

  it('beard: 0 sem peça; 1..4 uma peça cada, na camada 4, com a cor do cabelo', () => {
    expect(names(base).some((n) => n.startsWith('beard_'))).toBe(false);
    for (let beard = 1; beard < 5; beard++) {
      const c = { ...base, beard, hair_color: 5 };
      const parts = selectParts(c).filter((p) => p.name.startsWith('beard_'));
      expect(parts.map((p) => p.name)).toEqual([`beard_${beard}`]);
      expect(parts[0]!.layer).toBe(4);
      expect(artGroup(parts[0]!)).toBe('head');
      expect(resolveFill(parts[0]!.fill, c)).toBe(HAIR_COLORS[5]);
    }
  });

  it('a barba vem depois do rosto e antes da boca na ordem de desenho', () => {
    const order = selectParts({ ...base, beard: 1 }).map((p) => p.name);
    expect(order.indexOf('face_oval')).toBeLessThan(order.indexOf('beard_1'));
    expect(order.indexOf('beard_1')).toBeLessThan(order.indexOf('mouth_0_upper'));
  });

  it('hat: 0 sem peça; 1..10 peças próprias na camada 7 e sem cabelo da frente', () => {
    expect(names(base).some((n) => n.startsWith('hat_'))).toBe(false);
    for (let hat = 1; hat < 11; hat++) {
      const c = { ...base, hat, hair: 1 };
      const order = selectParts(c).map((p) => p.name);
      const own = order.filter((n) => n.startsWith('hat_'));
      expect(own.length, `hat ${hat}`).toBeGreaterThanOrEqual(3);
      for (const n of own) expect(n).toMatch(new RegExp(`^hat_${hat}_`));
      // com chapéu o cabelo da frente some: o chapéu assenta direto na cabeça
      expect(order.some((n) => n === 'hair_1_front')).toBe(false);
    }
  });

  it('mudar hair_color recolore cabelo e barba, mas não o chapéu', () => {
    const c0 = { ...base, hair: 1, beard: 1, hat: 3, hair_color: 0 };
    const c1 = { ...c0, hair_color: 6 };
    const color = (c: typeof c0, name: string) =>
      resolveFill(PARTS.find((p) => p.name === name)!.fill, c);
    expect(color(c0, 'hair_1_front')).not.toBe(color(c1, 'hair_1_front'));
    expect(color(c0, 'beard_1')).not.toBe(color(c1, 'beard_1'));
    expect(color(c0, 'hat_3_crown')).toBe(color(c1, 'hat_3_crown'));
  });

  it('o cabelo da frente e o chapéu caem no grupo da frente (acompanham a cabeça)', () => {
    expect(groupParts('front', { ...base, hair: 8 }).map((p) => p.name)).toEqual(['hair_8_front']);
    const c = { ...base, hair: 8, hat: 1 };
    expect(groupParts('front', c).map((p) => p.name)).toEqual([
      'hat_1_crown',
      'hat_1_brim',
      'hat_1_button',
    ]);
  });
});

describe('chapéu esconde o cabelo da frente e do topo', () => {
  it('hat != 0: nenhuma peça de frente do cabelo (nem a sombra da careca) e nenhum volume acima da cabeça', () => {
    const front = PARTS.filter((p) => p.layer === 7 && p.name.startsWith('hair_'));
    expect(front.length).toBeGreaterThan(19);
    for (const p of front) expect(p.hideWithHat, p.name).toBe(true);
    for (let hat = 1; hat < AVATAR_PART_COUNTS.hat; hat++) {
      for (let hair = 0; hair < AVATAR_PART_COUNTS.hair; hair++) {
        if (HAIR_WITHOUT_HAT.includes(hair)) continue; // combinação inválida (testada abaixo)
        const names = selectParts({ ...base, hat, hair }).map((p) => p.name);
        expect(
          names.filter((n) => /^hair_(\d+_(front|cap|bun)|bald_shade)$/.test(n)),
          `hat ${hat} hair ${hair}`,
        ).toEqual([]);
        // cacheado e afro (volume acima da cabeça) também somem; os longos ficam atrás
        const back = names.filter((n) => /^hair_\d+_back$/.test(n));
        expect(back.length > 0, `hat ${hat} hair ${hair}`).toBe(
          ![3, 8].includes(hair) && PARTS.some((p) => p.name === `hair_${hair}_back`),
        );
      }
    }
  });

  it('cabelo 2 e 14 com chapéu (dado antigo) desenham como hat 0, sem quebrar', () => {
    for (const hair of HAIR_WITHOUT_HAT) {
      for (let hat = 1; hat < AVATAR_PART_COUNTS.hat; hat++) {
        const a = selectParts({ ...base, hair, hat }).map((p) => p.name);
        expect(a, `hair ${hair} hat ${hat}`).toEqual(
          selectParts({ ...base, hair }).map((p) => p.name),
        );
        expect(a.some((n) => n.startsWith('hat_'))).toBe(false);
        expect(
          groupParts('front', { ...base, hair, hat }).some((p) => p.name.startsWith('hat_')),
        ).toBe(false);
      }
    }
  });

  it('hat 0: o cabelo da frente volta', () => {
    expect(selectParts({ ...base, hair: 1 }).map((p) => p.name)).toContain('hair_1_front');
    expect(selectParts({ ...base, hair: 0 }).map((p) => p.name)).toContain('hair_bald_shade');
  });

  it('o cabelo de trás começa abaixo do topo da copa (y >= 90) quando fica com chapéu', () => {
    for (const p of PARTS.filter((x) => /^hair_\d+_back$/.test(x.name) && x.hideWithHat !== true)) {
      const m = /^M256,(\d+(?:\.\d+)?)/.exec(p.d);
      expect(Number(m![1]), p.name).toBeGreaterThanOrEqual(90);
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
      hair_1_front: '#2B1B12',
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

  it('chapéus e bonés têm cor própria (não há hat_color) e as cores não alteram a seleção de peças', () => {
    for (const p of PARTS.filter((x) => x.name.startsWith('hat_'))) {
      expect(p.fill, p.name).toMatch(/^#[0-9A-F]{6}$/i);
    }
    const names = (c: typeof base) => selectParts(c).map((p) => p.name);
    expect(names({ ...base, hair_color: 7, eye_color: 2, outfit_color: 10 })).toEqual(names(base));
  });
});
