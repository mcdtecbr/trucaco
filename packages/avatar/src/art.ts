/**
 * Arte vetorial do avatar: os mesmos paths do rig `assets/rive/avatar.riv` (viewBox 512x512). É o que
 * o `AvatarFallback` desenha com react-native-svg, então fallback e Rive mostram o mesmo avatar (ADR 0003).
 * Só caminhos absolutos M/L/C/Q/Z (contagem de vértices confiável). Sem bitmaps.
 */
import { type AvatarPartKey, type AvatarParts, isHatAllowed } from '@trucaco/protocol';
import { BG_COLORS, EYE_COLORS, HAIR_COLORS, OUTFIT_COLORS, SKIN_COLORS } from './parts';

const HAIR = 'hair';
const LIP = '#B4443A';
const LIP_DARK = '#9A3430';
const TONGUE = '#E36B7C';
const K = 0.5523;

export type Fill = string | 'skin' | 'shade' | 'deep' | 'blush' | 'bg' | 'hair' | 'outfit' | 'iris';
export type Cfg = Readonly<Pick<AvatarParts, AvatarPartKey>>;

export interface Part {
  name: string;
  layer: 1 | 2 | 3 | 4 | 5 | 6 | 7; // ordem de sobreposição da especificação
  d: string;
  fill: Fill;
  /** Selecionada quando a config satisfaz o predicado. Ausente = sempre. */
  when?: Selector;
  mirror?: boolean; // espelha no eixo vertical central (olho/sobrancelha direitos)
  evenodd?: boolean;
  opacity?: number;
  /** Some quando há chapéu (`hat !== 0`): o chapéu assenta direto na cabeça, sem o cabelo da frente. */
  hideWithHat?: boolean;
  /**
   * Sombreado: a forma é recortada (ClipPath) pelo rosto escolhido (`face`) ou pela silhueta do cabelo da
   * frente escolhido (`hair`; sem cabelo da frente, ou coque, a peça não aparece).
   */
  clip?: 'face' | 'hair';
  hidden?: boolean; // existe no rig mas fica oculto em repouso (boca aberta e línguas dos sinais)
}

const f = (n: number) => String(Math.round(n * 10) / 10);
function ell(cx: number, cy: number, rx: number, ry: number): string {
  const kx = rx * K,
    ky = ry * K;
  return (
    `M${f(cx + rx)},${f(cy)}C${f(cx + rx)},${f(cy + ky)} ${f(cx + kx)},${f(cy + ry)} ${f(cx)},${f(cy + ry)}` +
    `C${f(cx - kx)},${f(cy + ry)} ${f(cx - rx)},${f(cy + ky)} ${f(cx - rx)},${f(cy)}` +
    `C${f(cx - rx)},${f(cy - ky)} ${f(cx - kx)},${f(cy - ry)} ${f(cx)},${f(cy - ry)}` +
    `C${f(cx + kx)},${f(cy - ry)} ${f(cx + rx)},${f(cy - ky)} ${f(cx + rx)},${f(cy)}Z`
  );
}
/** Mistura `a` e `b` (#RRGGBB) na proporção `t` de `b`. */
function mixHex(a: string, b: string, t: number): string {
  const ch = (s: string, i: number) => parseInt(s.slice(1 + i * 2, 3 + i * 2), 16);
  const hx = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  return `#${[0, 1, 2].map((i) => hx(ch(a, i) * (1 - t) + ch(b, i) * t)).join('')}`;
}
const rect = (x1: number, y1: number, x2: number, y2: number) =>
  `M${x1},${y1}L${x2},${y1}L${x2},${y2}L${x1},${y2}Z`;
/**
 * Anel da mandíbula: retângulo de x 100..412 e y `cy`..420 menos a meia-elipse INFERIOR (centro `cx,cy`),
 * num único contorno (sem evenodd). Nada acima de `cy`.
 */
function jawRing(cx: number, cy: number, rx: number, ry: number): string {
  const kx = rx * K,
    ky = ry * K;
  return (
    `M100,${cy}L${f(cx - rx)},${cy}` +
    `C${f(cx - rx)},${f(cy + ky)} ${f(cx - kx)},${f(cy + ry)} ${f(cx)},${f(cy + ry)}` +
    `C${f(cx + kx)},${f(cy + ry)} ${f(cx + rx)},${f(cy + ky)} ${f(cx + rx)},${cy}` +
    `L412,${cy}L412,420L100,420Z`
  );
}
export type Selector = ((c: Cfg) => boolean) & { key: AvatarPartKey; value: number };
const is = (k: AvatarPartKey, v: number): Selector =>
  Object.assign((c: Cfg) => c[k] === v, { key: k, value: v });

/** Vale para qualquer um dos `values` (a chave/valor do seletor apontam para o primeiro, para a checagem do catálogo). */
const oneOf = (k: AvatarPartKey, values: readonly number[]): Selector =>
  Object.assign((c: Cfg) => values.includes(c[k]), { key: k, value: values[0] ?? 0 });

type Pt = readonly [number, number];
type Seg =
  | readonly ['L', number, number]
  | readonly ['Q', number, number, number, number]
  | readonly ['C', number, number, number, number, number, number];
const pt = (x: number, y: number) => `${f(x)},${f(y)}`;
const mx = (x: number) => 512 - x;
const segEnd = (s: Seg): Pt => [s[s.length - 2] as number, s[s.length - 1] as number];
function segsToD(segs: readonly Seg[]): string {
  return segs
    .map((s) => {
      const n = s.slice(1) as number[];
      const pairs: string[] = [];
      for (let i = 0; i < n.length; i += 2) pairs.push(pt(n[i]!, n[i + 1]!));
      return s[0] + pairs.join(' ');
    })
    .join('');
}
/**
 * Contorno simétrico em torno do eixo x=256: `start` e o último ponto de `segs` ficam no eixo; o desenho
 * vai pelo lado direito e volta espelhado. Devolve um `d` fechado (só M/L/C/Q/Z).
 */
function sym(start: Pt, segs: readonly Seg[]): string {
  const anchors: Pt[] = [start, ...segs.map(segEnd)];
  const back: Seg[] = [];
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i]!;
    const to = anchors[i]!;
    if (s[0] === 'L') back.push(['L', mx(to[0]), to[1]]);
    else if (s[0] === 'Q') back.push(['Q', mx(s[1]), s[2], mx(to[0]), to[1]]);
    else back.push(['C', mx(s[3]), s[4], mx(s[1]), s[2], mx(to[0]), to[1]]);
  }
  return `M${pt(...start)}${segsToD(segs)}${segsToD(back)}Z`;
}
/**
 * Arco "de pelúcia" (cacheado, afro): `n` curvas Q sobre a elipse (cx,cy,rx,ry) entre os ângulos `a0` e `a1`
 * (graus, 0 = direita, crescendo no sentido horário da tela), com a barriga de cada curva `amp` para fora.
 * Devolve o ponto inicial e os segmentos.
 */
function scallop(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  a0: number,
  a1: number,
  n: number,
  amp: number,
): { start: Pt; segs: Seg[] } {
  const at = (deg: number, k = 1): Pt => [
    cx + rx * k * Math.cos((deg * Math.PI) / 180),
    cy + ry * k * Math.sin((deg * Math.PI) / 180),
  ];
  const segs: Seg[] = [];
  for (let i = 0; i < n; i++) {
    const c = at(a0 + ((a1 - a0) * (i + 0.5)) / n, 1 + amp);
    const p = at(a0 + ((a1 - a0) * (i + 1)) / n);
    segs.push(['Q', c[0], c[1], p[0], p[1]]);
  }
  return { start: at(a0), segs };
}

/** Par de peças de olho (esquerdo da tela e direito, espelhado): `<name>` e `<name>_r`. */
const eyePair = (name: string, eyes: number, fill: Fill, d: string): Part[] => [
  { name, layer: 5, fill, when: is('eyes', eyes), d },
  { name: `${name}_r`, layer: 5, fill, when: is('eyes', eyes), mirror: true, d },
];
/** Par de sobrancelhas (esquerda da tela e direita, espelhada) de um estilo `brows`. */
const browPair = (names: readonly [string, string], brows: number, d: string): Part[] => [
  { name: names[0], layer: 5, fill: HAIR, when: is('brows', brows), d },
  { name: names[1], layer: 5, fill: HAIR, when: is('brows', brows), mirror: true, d },
];

/** Sobrancelha esquerda (da tela) de cada estilo; a direita é a mesma espelhada. */
const BROWS: readonly string[] = [
  'M174,210Q178,198 212,196Q238,194 248,200Q250,208 242,210Q214,204 186,214Q174,216 174,210Z',
  'M174,196Q196,190 222,200Q244,208 250,216Q246,224 238,220Q220,212 196,206Q182,204 174,196Z',
  'M174,214Q200,206 226,198Q244,188 252,184Q250,196 240,204Q214,214 186,220Q174,220 174,214Z',
  'M174,214Q196,192 222,192Q244,194 250,208Q232,200 218,202Q196,204 174,214Z',
];

/**
 * Nariz de frente (silhueta com asas) a partir de: topo, meia-largura da ponte, meia-largura das asas,
 * y das asas e y da base. Proporções medidas nas duas fileiras de narizes da prancha de referência.
 */
function nose(
  top: number,
  bridge: number,
  wing: number,
  wingY: number,
  base: number,
  flat = 0,
): string {
  const x = (dx: number) => f(256 + dx);
  return (
    `M${x(-flat)},${top}${flat > 0 ? `L${x(flat)},${top}` : ''}Q${x(bridge)},${top + 6} ${x(bridge)},${f((top + wingY) / 2)}` +
    `Q${x(bridge)},${wingY - 8} ${x(wing)},${wingY - 2}Q${x(wing + 4)},${wingY + 8} ${x(wing - 8)},${wingY + 10}` +
    `Q${x(wing / 2)},${base} 256,${base - 2}Q${x(-wing / 2)},${base} ${x(-wing + 8)},${wingY + 10}` +
    `Q${x(-wing - 4)},${wingY + 8} ${x(-wing)},${wingY - 2}Q${x(-bridge)},${wingY - 8} ${x(-bridge)},${f((top + wingY) / 2)}` +
    `Q${x(-bridge)},${top + 6} ${x(-flat)},${top}Z`
  );
}
const NOSES: readonly string[] = [
  nose(236, 12, 32, 278, 292), // 0 ponte longa, ponta redonda, asas largas
  nose(232, 6, 18, 274, 286), // 1 fino e pontudo
  nose(234, 16, 30, 276, 290), // 2 ponte larga e alta
  nose(238, 11, 24, 276, 288, 8), // 3 topo reto, base média
  nose(238, 10, 32, 278, 290, 20), // 4 topo reto e largo, ponte estreita, asas largas
  nose(236, 14, 34, 280, 294), // 5 ponta bem redonda, asas muito largas
  nose(232, 18, 36, 278, 292), // 6 largo e robusto
  nose(242, 7, 20, 276, 288), // 7 pequeno e estreito
];

/** Cabelo: ${n} = índice de `hair`. Nós `hair_<n>_back` (camada 2) e `hair_<n>_front` (camada 7).
 * `hideWithHat`: o volume acima da cabeça (cacheado e afro) some com chapéu; os longos começam abaixo da copa. */
const hairBack = (n: number, d: string, hideWithHat = false): Part => ({
  name: `hair_${n}_back`,
  layer: 2,
  fill: HAIR,
  when: is('hair', n),
  ...(hideWithHat ? { hideWithHat: true } : {}),
  d,
});
const hairFront = (n: number, d: string, extra: Partial<Part> = {}, suffix = 'front'): Part => ({
  name: `hair_${n}_${suffix}`,
  layer: 7,
  fill: HAIR,
  when: is('hair', n),
  hideWithHat: true,
  d,
  ...extra,
});
/** Cacheado/afro: anel recortado em curvas. Fechado (`Z`) quando `a1 - a0 = 360`. */
const curlRing = (cx: number, cy: number, rx: number, ry: number, n: number, amp: number) => {
  const r = scallop(cx, cy, rx, ry, 0, 360, n, amp);
  return `M${pt(...r.start)}${segsToD(r.segs)}Z`;
};
/** Topo recortado em curvas do `a0` ao `a1`, seguido de `rest` (descida lateral e linha do cabelo). */
const curlTop = (
  c: readonly [number, number, number, number],
  a0: number,
  a1: number,
  n: number,
  amp: number,
  rest: string,
) => {
  const r = scallop(c[0], c[1], c[2], c[3], a0, a1, n, amp);
  return `M${pt(...r.start)}${segsToD(r.segs)}${rest}Z`;
};
const HAIR_BACK: readonly Part[] = [
  hairBack(
    2,
    sym(
      [256, 92],
      [
        ['C', 344, 92, 402, 116, 400, 228],
        ['Q', 412, 262, 396, 296],
        ['Q', 380, 330, 398, 364],
        ['Q', 414, 396, 396, 428],
        ['Q', 384, 448, 398, 468],
        ['L', 256, 468],
      ],
    ),
  ),
  hairBack(3, curlRing(256, 206, 148, 130, 11, 0.16), true),
  hairBack(
    5,
    sym(
      [256, 92],
      [
        ['C', 336, 92, 382, 124, 380, 232],
        ['L', 388, 424],
        ['L', 372, 462],
        ['L', 256, 462],
      ],
    ),
  ),
  hairBack(
    6,
    sym(
      [256, 92],
      [
        ['C', 346, 92, 398, 118, 396, 226],
        ['Q', 408, 262, 394, 298],
        ['Q', 382, 334, 402, 372],
        ['Q', 384, 392, 360, 384],
        ['L', 256, 384],
      ],
    ),
  ),
  hairBack(8, curlRing(256, 170, 152, 132, 12, 0.12), true),
  hairBack(
    11,
    sym(
      [256, 92],
      [
        ['C', 346, 92, 392, 128, 390, 232],
        ['L', 392, 322],
        ['Q', 390, 356, 366, 358],
        ['L', 256, 358],
      ],
    ),
  ),
  hairBack(
    13,
    sym(
      [256, 92],
      [
        ['C', 336, 92, 386, 126, 386, 222],
        ['Q', 402, 262, 388, 292],
        ['Q', 380, 318, 400, 336],
        ['Q', 372, 346, 346, 332],
        ['L', 256, 332],
      ],
    ),
  ),
  hairBack(
    14,
    sym(
      [256, 92],
      [
        ['C', 338, 92, 390, 124, 388, 232],
        ['L', 398, 432],
        ['L', 380, 468],
        ['L', 256, 468],
      ],
    ),
  ),
  hairBack(
    15,
    sym(
      [256, 92],
      [
        ['C', 344, 92, 390, 128, 388, 226],
        ['L', 392, 306],
        ['L', 372, 332],
        ['L', 256, 332],
      ],
    ),
  ),
  hairBack(
    17,
    sym(
      [256, 92],
      [
        ['C', 340, 92, 386, 128, 384, 230],
        ['L', 384, 330],
        ['Q', 376, 356, 350, 354],
        ['L', 256, 354],
      ],
    ),
  ),
];

/** Escala (sx, sy) de um chapéu em torno do ponto (ax, ay): ajusta o tamanho à cabeça sem refazer o desenho. */
type HatScale = readonly [sx: number, sy: number, ax: number, ay: number];
/**
 * Escala por chapéu (`<n>`) ou por peça (`<n>_<papel>`, vale mais). Com o cabelo da frente escondido
 * (`hideWithHat`) o chapéu assenta direto na cabeça nua: o topo do crânio fica entre y 88 e 108 conforme o
 * rosto, a meia-largura em y 150 vai de 100 a 120 e as orelhas ficam em ±127. A copa fecha em y ~166 e a aba
 * passa pouco da cabeça.
 */
const HAT_SCALE: Readonly<Record<string, HatScale>> = {
  '1': [1, 0.8, 256, 166],
  '1_brim': [0.95, 0.9, 256, 176],
  '2': [1, 0.8, 256, 166],
  '2_brim': [0.95, 0.9, 256, 176],
  '3': [1, 0.8, 256, 166],
  '3_brim': [0.95, 0.9, 256, 176],
  '4_brim': [0.77, 0.75, 256, 148],
  '4_crown': [1.4, 0.9, 256, 142],
  '4_band': [1.4, 0.9, 256, 142],
  '5': [1, 0.8, 256, 172],
  '5_brim': [0.78, 0.8, 214, 176],
  '6': [1, 0.9, 256, 178],
  '7': [1, 0.9, 256, 178],
  '8_brim': [0.8, 0.8, 256, 148],
  '8_crown': [1.35, 0.95, 256, 144],
  '8_band': [1.35, 0.95, 256, 144],
  '9_brim': [0.95, 0.85, 256, 150],
  '9_crown': [1.4, 0.95, 256, 152],
  '9_eyelets': [1.4, 0.95, 256, 152],
  '10': [1, 0.8, 256, 172],
  '10_brim': [0.78, 0.8, 214, 176],
};
function scaleD(d: string, [sx, sy, ax, ay]: HatScale): string {
  return d.replace(/([MLCQ])([^MLCQZ]*)/g, (_m, cmd: string, args: string) => {
    const n = args
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    const out: string[] = [];
    for (let i = 0; i < n.length; i += 2)
      out.push(pt(ax + (n[i]! - ax) * sx, ay + (n[i + 1]! - ay) * sy));
    return cmd + out.join(' ');
  });
}
/** Peça de chapéu: nó `hat_<n>_<papel>`, camada 7, cor própria. */
const hatPart = (n: number, role: string, fill: string, d: string): Part => {
  const s = HAT_SCALE[`${n}_${role}`] ?? HAT_SCALE[String(n)];
  return {
    name: `hat_${n}_${role}`,
    layer: 7,
    fill,
    when: is('hat', n),
    d: s === undefined ? d : scaleD(d, s),
  };
};
/** Boné de frente: copa, aba curva e botão. */
const cap = (n: number, crown: string, brim: string, button = crown): Part[] => [
  hatPart(
    n,
    'crown',
    crown,
    sym(
      [256, 66],
      [
        ['C', 312, 66, 366, 96, 366, 166],
        ['Q', 312, 152, 256, 152],
      ],
    ),
  ),
  hatPart(
    n,
    'brim',
    brim,
    sym(
      [256, 150],
      [
        ['Q', 330, 148, 372, 168],
        ['Q', 386, 192, 364, 202],
        ['Q', 310, 178, 256, 176],
      ],
    ),
  ),
  hatPart(n, 'button', button, ell(256, 66, 7, 6)),
];

export const PARTS: readonly Part[] = [
  // 1. Fundo
  { name: 'BG', layer: 1, d: rect(0, 0, 512, 512), fill: 'bg' },

  // 2. Cabelo posterior (19 estilos de `hair`; ver HAIR_BACK)
  ...HAIR_BACK,

  // 3. Orelhas, pescoço, ombros e roupa
  { name: 'ears', layer: 3, d: ell(142, 248, 13, 25) + ell(370, 248, 13, 25), fill: 'skin' },
  { name: 'neck', layer: 3, d: 'M226,320L286,320L296,436L216,436Z', fill: 'skin' },
  {
    name: 'outfit_tee_crew',
    layer: 3,
    fill: 'outfit',
    when: is('outfit', 0),
    d: 'M100,512Q100,440 190,420Q256,452 322,420Q412,440 412,512Z',
  },
  {
    name: 'outfit_tee_v',
    layer: 3,
    fill: 'outfit',
    when: is('outfit', 1),
    d: 'M100,512Q100,440 190,420L256,486L322,420Q412,440 412,512Z',
  },
  {
    name: 'outfit_tee_v_skin',
    layer: 3,
    fill: 'skin',
    when: is('outfit', 1),
    d: 'M192,422L256,484L320,422Z',
  },
  {
    name: 'outfit_polo',
    layer: 3,
    fill: 'outfit',
    when: is('outfit', 2),
    d: 'M100,512Q100,440 190,420Q256,448 322,420Q412,440 412,512Z',
  },
  {
    name: 'outfit_polo_collar',
    layer: 3,
    fill: '#0B79B0',
    when: is('outfit', 2),
    d: 'M190,416L232,424L256,470L214,444Z' + 'M322,416L280,424L256,470L298,444Z',
  },
  {
    name: 'outfit_polo_buttons',
    layer: 3,
    fill: '#F8FAFC',
    when: is('outfit', 2),
    d: ell(256, 482, 5, 5) + ell(256, 502, 5, 5),
  },
  {
    name: 'outfit_shirt',
    layer: 3,
    fill: 'outfit',
    when: is('outfit', 3),
    d: 'M100,512Q100,440 190,420L256,470L322,420Q412,440 412,512Z',
  },
  {
    name: 'outfit_shirt_inner',
    layer: 3,
    fill: '#F3F4F6',
    when: is('outfit', 3),
    d: 'M194,424L318,424L298,512L214,512Z',
  },
  {
    name: 'outfit_shirt_collar',
    layer: 3,
    fill: '#5E200D',
    when: is('outfit', 3),
    d: 'M186,414L236,420L256,470L208,440Z' + 'M326,414L276,420L256,470L304,440Z',
  },
  {
    name: 'outfit_vest_shirt',
    layer: 3,
    fill: '#F3F4F6',
    when: is('outfit', 4),
    d: 'M100,512Q100,440 190,420Q256,448 322,420Q412,440 412,512Z',
  },
  {
    name: 'outfit_vest',
    layer: 3,
    fill: 'outfit',
    when: is('outfit', 4),
    d: 'M118,512Q112,452 192,426L238,512Z' + 'M394,512Q400,452 320,426L274,512Z',
  },
  {
    name: 'outfit_tank_skin',
    layer: 3,
    fill: 'skin',
    when: is('outfit', 5),
    d: 'M96,512Q96,446 186,424Q256,452 326,424Q416,446 416,512Z',
  },
  {
    name: 'outfit_tank',
    layer: 3,
    fill: 'outfit',
    when: is('outfit', 5),
    d: 'M150,512L168,432Q190,430 214,438Q256,470 298,438Q322,430 344,432L362,512Z',
  },

  // 4. Formato da cabeça e sombra do pescoço. Os 6 formatos seguem a 1ª linha da prancha de referência
  // (esquerda para a direita = índices 0 a 5).
  {
    name: 'face_oval', // 0: oval alto, queixo estreito
    layer: 4,
    fill: 'skin',
    when: is('face_shape', 0),
    d: 'M256,96C320,96 358,150 358,224C358,290 318,376 256,376C194,376 154,290 154,224C154,150 192,96 256,96Z',
  },
  {
    name: 'face_round', // 1: redondo largo
    layer: 4,
    fill: 'skin',
    when: is('face_shape', 1),
    d: 'M256,104C330,104 378,160 378,234C378,314 330,372 256,372C182,372 134,314 134,234C134,160 182,104 256,104Z',
  },
  {
    name: 'face_square', // 2: quadrado de cantos arredondados
    layer: 4,
    fill: 'skin',
    when: is('face_shape', 2),
    d: 'M138,158Q138,110 188,108L324,108Q374,110 374,158L376,290Q374,366 306,370L206,370Q138,366 136,290Z',
  },
  {
    name: 'face_heart', // 3: coração (testa larga com entalhe, queixo fino)
    layer: 4,
    fill: 'skin',
    when: is('face_shape', 3),
    d: 'M256,128Q230,100 190,104Q140,112 140,190Q142,250 176,300Q216,350 256,382Q296,350 336,300Q370,250 372,190Q372,112 322,104Q282,100 256,128Z',
  },
  {
    name: 'face_triangle', // 4: bochechas largas e queixo em V
    layer: 4,
    fill: 'skin',
    when: is('face_shape', 4),
    d: 'M256,100C320,100 364,118 372,180C378,236 352,290 318,330Q286,368 256,382Q226,368 194,330C160,290 134,236 140,180C148,118 192,100 256,100Z',
  },
  {
    name: 'face_long', // 5: oval comprido
    layer: 4,
    fill: 'skin',
    when: is('face_shape', 5),
    d: 'M256,88C318,88 356,134 356,210C356,290 330,382 256,382C182,382 156,290 156,210C156,134 194,88 256,88Z',
  },
  { name: 'neck_shadow', layer: 4, d: 'M224,366Q256,402 288,366L292,396L220,396Z', fill: 'shade' },

  // Sombreado (fatia 5): formas translúcidas sem input novo. Ver `docs/avatar-rig.md`, seção 'Sombreado'.
  // Mandíbula em dois degraus (borda suave): fora de uma elipse, a partir do centro dela (sem borda reta).
  {
    name: 'shade_jaw_soft',
    layer: 4,
    fill: 'shade',
    opacity: 0.12,
    clip: 'face',
    d: jawRing(256, 226, 124, 112),
  },
  {
    name: 'shade_jaw',
    layer: 4,
    fill: 'shade',
    opacity: 0.16,
    clip: 'face',
    d: jawRing(256, 226, 124, 124),
  },
  { name: 'shade_cheek_l', layer: 4, fill: 'blush', opacity: 0.28, d: ell(194, 292, 24, 14) },
  { name: 'shade_cheek_r', layer: 4, fill: 'blush', opacity: 0.28, d: ell(318, 292, 24, 14) },
  {
    name: 'shade_beard_neck', // sombra no pescoço sob a barba cheia, bigode+cavanhaque e cavanhaque
    layer: 4,
    fill: 'deep',
    opacity: 0.35,
    when: oneOf('beard', [1, 3, 4]),
    d: 'M222,386L290,386L289,414Q256,434 223,414Z',
  },
  // Barbas (camada 4, logo depois do rosto: boca, nariz e bigode vêm por cima). Cor = `hair_color`.
  {
    name: 'beard_1', // barba cheia com bigode e furo da boca
    layer: 4,
    fill: HAIR,
    when: is('beard', 1),
    evenodd: true,
    d:
      sym(
        [256, 408],
        [
          ['C', 306, 408, 346, 372, 354, 318],
          ['L', 358, 240],
          ['L', 342, 244],
          ['Q', 336, 286, 312, 294],
          ['Q', 284, 284, 256, 296],
        ],
      ) + ell(256, 334, 56, 24),
  },
  {
    name: 'beard_2', // sombra de barba (rala): faixa no maxilar, com opacidade
    layer: 4,
    fill: HAIR,
    opacity: 0.35,
    evenodd: true,
    when: is('beard', 2),
    d:
      'M166,254Q172,332 212,368Q256,396 300,368Q340,332 346,254Q336,296 306,310Q256,296 206,310Q176,296 166,254Z' +
      ell(256, 334, 54, 24),
  },
  {
    name: 'beard_3', // cavanhaque com bigode
    layer: 4,
    fill: HAIR,
    when: is('beard', 3),
    evenodd: true,
    d:
      sym(
        [256, 392],
        [
          ['Q', 296, 390, 312, 360],
          ['Q', 330, 340, 328, 312],
          ['Q', 318, 290, 288, 292],
          ['Q', 270, 288, 256, 298],
        ],
      ) + ell(256, 330, 48, 22),
  },
  {
    name: 'beard_4', // cavanhaque (só o queixo)
    layer: 4,
    fill: HAIR,
    when: is('beard', 4),
    d: 'M226,352Q256,342 286,352Q294,378 256,398Q218,378 226,352Z',
  },

  // 5. Olhos, sobrancelhas, nariz e boca
  // Olhos (6 estilos, na ordem da prancha de referência: cima para baixo): 0 amendoado com delineador,
  // 1 aberto com pálpebra marcada, 2 redondo liso, 3 arregalado com cílios, 4 grande com brilho,
  // 5 cílios longos. Cada estilo: branco, íris (cor = `eye_color`), miolo, pálpebra/cílios (e brilho no 4).
  ...eyePair('eye_white_0', 0, '#FFFFFF', 'M176,236Q208,206 246,232Q210,258 176,236Z'),
  ...eyePair('eye_pupil_0', 0, 'iris', ell(210, 233, 13, 13)),
  ...eyePair('eye_core_0', 0, '#0B0B0D', ell(210, 233, 6, 6)),
  ...eyePair(
    'eye_lid_0',
    0,
    '#241A1A',
    'M164,230Q176,222 192,213Q224,200 250,228L246,232Q222,210 194,222Q182,230 170,236Z',
  ),
  ...eyePair(
    'eye_white_1',
    1,
    '#FFFFFF',
    'M174,238Q176,208 210,206Q244,208 246,238Q240,262 210,262Q178,262 174,238Z',
  ),
  ...eyePair('eye_pupil_1', 1, 'iris', ell(210, 236, 18, 18)),
  ...eyePair('eye_core_1', 1, '#0B0B0D', ell(210, 236, 8, 8)),
  ...eyePair(
    'eye_lid_1',
    1,
    '#241A1A',
    'M170,234Q176,198 212,196Q246,198 250,234Q244,210 212,205Q178,208 170,234Z',
  ),
  ...eyePair('eye_white_2', 2, '#FFFFFF', ell(208, 236, 31, 31)),
  ...eyePair('eye_pupil_2', 2, 'iris', ell(210, 236, 15, 15)),
  ...eyePair('eye_core_2', 2, '#0B0B0D', ell(210, 236, 7, 7)),
  ...eyePair(
    'eye_lid_2',
    2,
    '#241A1A',
    'M176,230Q182,206 208,205Q234,206 240,230Q232,214 208,213Q184,214 176,230Z',
  ),
  ...eyePair('eye_white_3', 3, '#FFFFFF', ell(208, 236, 35, 36)),
  ...eyePair('eye_pupil_3', 3, 'iris', ell(208, 238, 8, 8)),
  ...eyePair(
    'eye_lid_3',
    3,
    '#241A1A',
    'M172,234Q178,198 208,198Q238,198 244,234Q238,208 208,206Q180,208 172,234Z' +
      'M176,218L160,208Q170,206 182,212Z' +
      'M184,206L170,192Q182,192 192,201Z' +
      'M198,200L192,184Q204,188 207,198Z',
  ),
  ...eyePair('eye_white_4', 4, '#FFFFFF', ell(208, 236, 34, 34)),
  ...eyePair('eye_pupil_4', 4, 'iris', ell(210, 238, 22, 22)),
  ...eyePair('eye_core_4', 4, '#0B0B0D', ell(210, 238, 9.5, 9.5)),
  ...eyePair('eye_glint_4', 4, '#FDFDFF', ell(218, 229, 5.5, 5.5)),
  ...eyePair(
    'eye_lid_4',
    4,
    '#241A1A',
    'M172,232Q178,198 210,196Q242,198 248,232Q242,206 210,204Q180,208 172,232Z',
  ),
  ...eyePair('eye_white_5', 5, '#FFFFFF', ell(208, 236, 34, 32)),
  ...eyePair('eye_pupil_5', 5, 'iris', ell(210, 236, 17, 17)),
  ...eyePair('eye_core_5', 5, '#0B0B0D', ell(210, 236, 8, 8)),
  ...eyePair(
    'eye_lid_5',
    5,
    '#241A1A',
    'M172,232Q178,200 210,198Q242,200 248,232Q242,210 210,208Q180,210 172,232Z' +
      'M172,236L156,238Q160,230 174,228Z' +
      'M174,226L158,218Q168,214 180,220Z' +
      'M184,212L172,198Q184,198 192,206Z',
  ),
  // Sobrancelhas (4 estilos da prancha; cor = `hair_color`): 0 arco grosso, 1 inclinada para baixo (brava),
  // 2 inclinada para cima (preocupada), 3 arco fino. As de índice 0 usam os nós `brow_l`/`brow_r`.
  { name: 'brow_l', layer: 5, fill: HAIR, when: is('brows', 0), d: BROWS[0]! },
  { name: 'brow_r', layer: 5, fill: HAIR, when: is('brows', 0), mirror: true, d: BROWS[0]! },
  ...browPair(['brow_1_l', 'brow_1_r'], 1, BROWS[1]!),
  ...browPair(['brow_2_l', 'brow_2_r'], 2, BROWS[2]!),
  ...browPair(['brow_3_l', 'brow_3_r'], 3, BROWS[3]!),
  // Narizes (8 estilos das duas fileiras da prancha, só os de frente; cor = sombra da pele). O 0 usa o nó `nose`.
  { name: 'nose', layer: 5, fill: 'shade', when: is('nose', 0), d: NOSES[0]! },
  ...NOSES.slice(1).map(
    (d, i): Part => ({
      name: `nose_${i + 1}`,
      layer: 5,
      fill: 'shade',
      when: is('nose', i + 1),
      d,
    }),
  ),
  // Bocas (5 opções; ADR 0004 / Fatia 2). Cada uma é lábio superior + inferior; a 1 e a 2 têm interior
  // (e dentes na 1) porque a abertura precisa de cor própria. Lábios com arco do cupido e inferior cheio.
  {
    name: 'mouth_0_upper',
    layer: 5,
    fill: LIP,
    when: is('mouth', 0),
    d: 'M214,318Q228,314 246,312Q251,312 256,316Q261,312 266,312Q284,314 298,318Q278,327 256,327Q234,327 214,318Z',
  },
  {
    name: 'mouth_0_lower',
    layer: 5,
    fill: LIP,
    when: is('mouth', 0),
    evenodd: true, // o furo pequeno é o brilho do lábio inferior
    d: 'M222,321Q238,329 256,329Q274,329 290,321C290,334 276,344 256,344C236,344 222,334 222,321ZM243,335Q256,339 269,335Q256,342 243,335Z',
  },
  {
    name: 'mouth_1_inside',
    layer: 5,
    fill: '#3B0D0D',
    when: is('mouth', 1),
    d: 'M208,315Q256,333 304,315Q298,342 256,344Q214,342 208,315Z',
  },
  {
    name: 'mouth_1_teeth',
    layer: 5,
    fill: '#F8FAFC',
    when: is('mouth', 1),
    d: 'M212,316Q256,334 300,316L296,326Q256,342 216,326Z',
  },
  {
    name: 'mouth_1_upper',
    layer: 5,
    fill: LIP,
    when: is('mouth', 1),
    d: 'M204,313Q226,318 244,313Q251,311 256,316Q261,311 268,313Q286,318 308,313Q256,337 204,313Z',
  },
  {
    name: 'mouth_1_lower',
    layer: 5,
    fill: LIP,
    when: is('mouth', 1),
    d: 'M212,322Q222,342 256,343Q290,342 300,322C300,346 280,356 256,356C232,356 212,346 212,322Z',
  },
  {
    name: 'mouth_2_inside',
    layer: 5,
    fill: '#3B0D0D',
    when: is('mouth', 2),
    d: 'M220,323Q256,329 292,323Q256,341 220,323Z',
  },
  {
    name: 'mouth_2_upper',
    layer: 5,
    fill: LIP_DARK,
    when: is('mouth', 2),
    d: 'M218,322Q226,311 244,311Q251,311 256,315Q261,311 268,311Q286,311 294,322Q256,328 218,322Z',
  },
  {
    name: 'mouth_2_lower',
    layer: 5,
    fill: LIP_DARK,
    when: is('mouth', 2),
    d: 'M220,324Q256,338 292,324C292,342 278,352 256,352C234,352 220,342 220,324Z',
  },
  {
    name: 'mouth_3_upper',
    layer: 5,
    fill: LIP,
    when: is('mouth', 3),
    // os dois pontos nos cantos (cantinhos marcados) são subpaths do lábio superior
    d:
      'M218,320Q232,318 246,314Q251,313 256,316Q261,313 266,314Q280,318 294,320Q256,325 218,320Z' +
      ell(215.5, 320, 3, 3) +
      ell(296.5, 320, 3, 3),
  },
  {
    name: 'mouth_3_lower',
    layer: 5,
    fill: LIP,
    when: is('mouth', 3),
    d: 'M221,321Q256,326 291,321C288,331 274,337 256,337C238,337 224,331 221,321Z',
  },
  {
    name: 'mouth_4_upper',
    layer: 5,
    fill: LIP,
    when: is('mouth', 4),
    // pontas de canto (tracinhos) nos dois lados, como subpaths do lábio superior
    d:
      'M214,322Q224,318 244,312Q251,311 256,315Q261,311 268,312Q288,318 298,322Q256,328 214,322Z' +
      'M216,322Q209,322 205,317Q211,317 217,320Z' +
      'M296,322Q303,322 307,317Q301,317 295,320Z',
  },
  {
    name: 'mouth_4_lower',
    layer: 5,
    fill: LIP,
    when: is('mouth', 4),
    d: 'M218,324Q256,331 294,324C292,340 278,349 256,349C234,349 220,340 218,324Z',
  },

  // Boca aberta dos sinais `mouth_open` e `tongue` (ocultas em repouso). Em sinal, a boca escolhida some
  // e este grupo aparece; a língua vem em peças próprias (centrada ou de lado).
  {
    name: 'mouth_inside',
    layer: 5,
    fill: '#3B0D0D',
    hidden: true,
    d: 'M210,315Q256,326 302,315Q298,346 256,349Q214,346 210,315Z',
  },
  {
    name: 'mouth_open_teeth_upper',
    layer: 5,
    fill: '#F8FAFC',
    hidden: true,
    d: 'M214,317Q256,328 298,317Q294,329 256,331Q218,329 214,317Z',
  },
  {
    name: 'mouth_open_teeth_lower',
    layer: 5,
    fill: '#F8FAFC',
    hidden: true,
    d: 'M232,337Q256,332 280,337Q256,344 232,337Z',
  },
  {
    name: 'mouth_open_lower',
    layer: 5,
    fill: LIP,
    hidden: true,
    d: 'M209,327Q216,341 256,342Q296,341 303,327C300,356 282,361 256,361C230,361 212,356 209,327Z',
  },
  {
    name: 'mouth_open_upper',
    layer: 5,
    fill: LIP,
    hidden: true,
    d: 'M208,314Q228,318 244,313Q251,310 256,315Q261,310 268,313Q284,318 304,314Q282,324 256,324Q230,324 208,314Z',
  },
  {
    name: 'tongue_center',
    layer: 5,
    fill: TONGUE,
    hidden: true,
    evenodd: true,
    d: 'M238,338Q256,342 274,338Q278,358 268,367Q256,374 244,367Q234,358 238,338ZM256,350Q254.5,356 256,362Q257.5,356 256,350Z',
  },
  {
    name: 'tongue',
    layer: 5,
    fill: TONGUE,
    hidden: true,
    evenodd: true,
    d: 'M254,340Q260,332 276,334Q294,338 304,352Q312,366 301,370Q291,372 283,362Q274,352 262,351Q252,349 254,340Z',
  },

  // 6. Acessórios faciais
  {
    name: 'acc_mustache',
    layer: 6,
    fill: HAIR,
    when: is('accessory', 1),
    d: 'M256,302Q236,290 208,296Q190,300 186,318Q206,306 232,312Q250,316 256,312Q262,316 280,312Q306,306 326,318Q322,300 304,296Q276,290 256,302Z',
  },
  {
    name: 'acc_earring',
    layer: 6,
    fill: '#F5B301',
    evenodd: true,
    when: is('accessory', 2),
    d: ell(137, 282, 11, 15) + ell(137, 282, 6, 10),
  },

  // 7. Cabelo frontal e chapéus
  {
    name: 'hair_bald_shade',
    layer: 7,
    fill: 'shade',
    opacity: 0.55,
    when: is('hair', 0),
    hideWithHat: true,
    d: 'M190,134Q256,98 322,134Q256,114 190,134Z',
  },
  // 7. Cabelo frontal (cada estilo desenha só o que fica na frente da cabeça)
  hairFront(
    1,
    'M148,228C136,160 142,112 184,98L190,84L212,96L226,78L244,92L266,76L280,92L304,82L312,98C356,112 376,160 364,228C352,190 340,164 312,156C292,164 262,150 240,158C208,152 178,168 148,228Z',
  ),
  hairFront(
    2,
    sym(
      [256, 84],
      [
        ['C', 332, 84, 384, 128, 384, 230],
        ['Q', 394, 268, 382, 300],
        ['Q', 370, 332, 388, 372],
        ['C', 362, 372, 366, 326, 366, 266],
        ['C', 366, 190, 330, 132, 256, 128],
      ],
    ),
  ),
  hairFront(
    3,
    curlTop(
      [256, 158, 130, 100],
      155,
      385,
      8,
      0.16,
      'C350,178 310,160 256,162C202,160 162,178 145,210',
    ),
  ),
  hairFront(
    4,
    'M150,226C140,150 180,92 256,92C332,92 372,150 362,226L338,226C336,170 310,122 256,118C202,122 176,170 174,226Z' +
      ell(256, 68, 38, 34),
  ),
  hairFront(
    5,
    sym(
      [256, 86],
      [
        ['C', 330, 86, 374, 128, 374, 232],
        ['L', 380, 384],
        ['L', 352, 386],
        ['L', 354, 290],
        ['L', 353, 178],
        ['L', 320, 156],
        ['L', 300, 170],
        ['L', 280, 148],
        ['L', 256, 162],
      ],
    ),
  ),
  hairFront(
    6,
    'M362,236C390,150 346,84 256,84C168,84 124,146 140,236C142,284 126,310 138,342C158,328 162,292 166,252C170,206 196,168 236,148C262,150 292,150 318,134C340,160 346,200 350,250C354,292 352,320 376,342C390,306 376,270 362,236Z',
  ),
  hairFront(
    7,
    'M150,226C136,150 156,100 214,86C266,72 330,76 378,96L368,114C372,124 372,140 362,226C352,190 332,168 296,158C262,150 222,160 198,172C176,184 160,204 150,226Z',
  ),
  hairFront(
    8,
    curlTop(
      [256, 150, 112, 90],
      160,
      380,
      9,
      0.1,
      'L362,215C350,168 322,150 256,150C190,150 162,168 150,215',
    ),
  ),
  hairFront(
    9,
    'M156,206C142,140 172,92 232,80L206,58L262,76C320,76 372,108 362,206C352,180 340,166 320,160C290,166 262,154 238,170C214,166 186,176 156,206Z',
  ),
  hairFront(
    10,
    'M146,250C132,160 152,100 224,84C270,72 322,80 366,110C386,140 380,200 368,250C356,216 350,184 336,170L322,176L304,152L286,168L268,146L252,166L232,148L214,166L196,152L176,176C166,196 156,226 146,250Z',
  ),
  hairFront(
    11,
    'M142,258C130,150 158,98 240,84C320,76 388,122 380,258C376,230 370,208 358,188C326,176 296,152 270,118C258,150 214,178 166,200C152,216 146,236 142,258Z',
  ),
  hairFront(
    12,
    'M130,236C122,140 166,84 250,82C336,80 390,130 390,236C392,300 376,350 386,396C400,436 414,470 402,500C382,470 354,440 350,380C320,336 340,270 362,240C374,190 322,130 262,128C200,130 138,190 150,240C172,268 196,308 146,340C118,300 126,270 130,236Z',
  ),
  hairFront(
    13,
    'M360,232C380,150 338,96 256,94C176,94 134,150 148,232C150,262 140,284 150,308C166,292 168,262 170,244C174,204 200,176 226,160C246,184 290,170 320,146C340,172 346,210 346,246C348,266 352,286 364,306C380,286 370,258 360,232Z',
  ),
  hairFront(
    14,
    sym(
      [256, 88],
      [
        ['C', 332, 88, 380, 130, 382, 230],
        ['L', 388, 402],
        ['L', 360, 404],
        ['C', 366, 330, 366, 290, 366, 262],
        ['C', 366, 190, 330, 132, 256, 128],
      ],
    ),
  ),
  hairFront(
    15,
    'M146,276C130,170 156,104 230,86C300,72 374,102 376,196C376,230 382,254 392,288C370,276 360,262 354,246C352,212 344,190 322,176C300,184 266,160 246,134C226,176 190,200 168,222C160,238 156,256 146,276Z',
  ),
  hairFront(
    16,
    'M148,215C140,120 190,88 256,88C322,88 372,120 364,215C350,170 330,150 256,148C182,150 162,170 148,215Z',
    {},
    'cap',
  ),
  hairFront(16, ell(256, 76, 40, 33), {}, 'bun'),
  hairFront(
    17,
    sym(
      [256, 88],
      [
        ['C', 328, 88, 372, 128, 372, 232],
        ['L', 376, 320],
        ['Q', 366, 338, 350, 338],
        ['L', 354, 280],
        ['L', 353, 186],
        ['L', 326, 164],
        ['L', 256, 160],
      ],
    ),
  ),
  hairFront(
    18,
    'M164,200C158,130 200,104 256,102C312,104 354,130 348,200C336,168 304,148 256,146C208,148 176,168 164,200Z',
    { opacity: 0.72 },
  ),
  // Chapéus e bonés (camada 7, depois do cabelo): cada um com as suas cores.
  ...cap(1, '#2F6FB5', '#1F4F8A'),
  ...cap(2, '#C23030', '#8F1F23'),
  ...cap(3, '#1C1C1F', '#0E0E10'),
  hatPart(4, 'brim', '#E3BE5B', ell(256, 148, 170, 34)),
  hatPart(
    4,
    'crown',
    '#EBCB74',
    'M184,142C182,90 224,62 256,62C288,62 330,90 328,142Q256,160 184,142Z',
  ),
  hatPart(4, 'band', '#C8453B', 'M184,124Q256,146 328,124L328,142Q256,162 184,142Z'),
  hatPart(
    5,
    'crown',
    '#C93030',
    'M148,174C146,100 196,68 256,68C322,68 366,108 366,172Q256,150 148,174Z',
  ),
  hatPart(5, 'panel', '#A52428', 'M300,70C340,80 366,110 366,172Q330,160 300,158Z'),
  hatPart(5, 'brim', '#A52428', 'M214,164Q320,142 432,190Q402,198 372,190Q300,170 214,186Z'),
  hatPart(5, 'button', '#A52428', ell(256, 68, 7, 6)),
  hatPart(
    6,
    'dome',
    '#2F7FC4',
    sym(
      [256, 70],
      [
        ['C', 316, 70, 366, 100, 366, 176],
        ['L', 256, 176],
      ],
    ),
  ),
  hatPart(6, 'cuff', '#2A6DAE', 'M146,136Q256,112 366,136L370,176Q256,188 142,176Z'),
  hatPart(6, 'pompom', '#2A6DAE', ell(256, 64, 23, 21)),
  hatPart(
    7,
    'dome',
    '#C32B2E',
    sym(
      [256, 74],
      [
        ['C', 318, 74, 364, 104, 364, 176],
        ['L', 256, 176],
      ],
    ),
  ),
  hatPart(7, 'cuff', '#A32024', 'M146,140Q256,116 366,140L370,178Q256,190 142,178Z'),
  hatPart(
    7,
    'ribs',
    '#8E1A1F',
    [158, 180, 202, 224, 246, 268, 290, 312, 334, 354]
      .map((x) => `M${x},146L${x + 4},146L${x + 4},182L${x},182Z`)
      .join(''),
  ),
  hatPart(8, 'brim', '#D9B36A', ell(256, 148, 156, 28)),
  hatPart(
    8,
    'crown',
    '#E4C27E',
    'M180,144C178,110 196,80 232,82Q256,98 280,82C316,80 334,110 332,144Q256,160 180,144Z',
  ),
  hatPart(8, 'band', '#1B1B1B', 'M180,126Q256,144 332,126L332,144Q256,162 180,144Z'),
  hatPart(
    9,
    'brim',
    '#5F7FA3',
    'M122,148Q256,124 390,148Q398,176 372,184Q256,198 140,184Q114,176 122,148Z',
  ),
  hatPart(
    9,
    'crown',
    '#6E8FB0',
    'M184,152C184,92 214,72 256,72C298,72 328,92 328,152Q256,168 184,152Z',
  ),
  hatPart(9, 'eyelets', '#4A6585', ell(312, 116, 5, 5) + ell(318, 130, 5, 5)),
  hatPart(
    10,
    'crown',
    '#1A1A1C',
    'M148,174C146,100 196,68 256,68C322,68 366,108 366,172Q256,150 148,174Z',
  ),
  hatPart(10, 'panel', '#2D2D31', 'M300,70C340,80 366,110 366,172Q330,160 300,158Z'),
  hatPart(10, 'brim', '#C23030', 'M214,166Q330,144 436,176L430,192Q330,180 216,186Z'),
  hatPart(10, 'button', '#C23030', ell(256, 68, 7, 6)),

  // 7. Brilhos (por cima do cabelo e dos chapéus; somem com chapéu)
  {
    name: 'shade_bald_gloss', // careca: brilho curvo no alto da testa
    layer: 7,
    fill: '#FFFFFF',
    opacity: 0.28,
    clip: 'face',
    when: is('hair', 0),
    hideWithHat: true,
    d: 'M214,134Q246,118 282,128Q250,128 220,148Q208,146 214,134Z',
  },
  {
    name: 'shade_hair_gloss', // cabelo (menos coque e careca): brilho curvo no alto, recortado pelo cabelo
    layer: 7,
    fill: '#FFFFFF',
    opacity: 0.2,
    clip: 'hair',
    hideWithHat: true,
    d: 'M188,142Q204,108 252,96Q282,92 306,100Q262,104 232,122Q210,134 200,160Q184,160 188,142Z',
  },
];

/** Peça escolhida pela config (`when`) e não escondida pelo chapéu (`hideWithHat`). */
export const isShown = (p: Part, c: Cfg): boolean =>
  (!p.when || p.when(c)) &&
  !(p.hideWithHat === true && c.hat !== 0) &&
  (p.clip !== 'hair' || clipPaths(p, c).length > 0);

/** Paths do recorte de uma peça de sombreado: o rosto escolhido ou os `hair_<n>_front` do cabelo escolhido. */
export function clipPaths(p: Part, c: Cfg): string[] {
  if (p.clip === 'face')
    return PARTS.filter((x) => x.name.startsWith('face_') && x.when?.(c)).map((x) => x.d);
  if (p.clip === 'hair')
    return PARTS.filter((x) => x.name === `hair_${c.hair}_front`).map((x) => x.d);
  return [];
}

/** Defensivo: cabelo que não combina com chapéu (dado antigo) é desenhado como `hat` 0. */
export const effectiveCfg = (c: Cfg): Cfg => (isHatAllowed(c.hair, c.hat) ? c : { ...c, hat: 0 });

/** Partes selecionadas para uma config, já na ordem de desenho. */
export function selectParts(cfg: Cfg): Part[] {
  const c = effectiveCfg(cfg);
  return PARTS.filter((p) => !p.hidden && isShown(p, c))
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.layer - b.p.layer || a.i - b.i)
    .map((x) => x.p);
}

/** Cor concreta de um preenchimento para as partes escolhidas (`c` dentro do catálogo). */
export function resolveFill(fill: Fill, c: Cfg): string {
  if (fill === 'skin') return (SKIN_COLORS[c.skin] ?? SKIN_COLORS[0]!).base;
  if (fill === 'shade') return (SKIN_COLORS[c.skin] ?? SKIN_COLORS[0]!).shade;
  const skin = SKIN_COLORS[c.skin] ?? SKIN_COLORS[0]!;
  if (fill === 'deep') return mixHex(skin.shade, '#2A1208', 0.4);
  if (fill === 'blush') return mixHex(skin.shade, '#D2475A', 0.5);
  if (fill === 'bg') return BG_COLORS[c.bg_color] ?? BG_COLORS[0]!;
  if (fill === 'hair') return HAIR_COLORS[c.hair_color] ?? HAIR_COLORS[0]!;
  if (fill === 'iris') return EYE_COLORS[c.eye_color] ?? EYE_COLORS[0]!;
  if (fill === 'outfit') {
    // outfit_color 0 = cor própria do modelo (preserva o visual de quem nunca escolheu cor).
    const i = c.outfit_color === 0 ? c.outfit : c.outfit_color;
    return OUTFIT_COLORS[i] ?? OUTFIT_COLORS[0]!;
  }
  return fill;
}

/** Vértices (âncoras) de um `d` absoluto M/L/C/Q/Z. */
export function countVertices(d: string): number {
  let total = 0;
  for (const m of d.matchAll(/([MLCQZ])([^MLCQZ]*)/g)) {
    const cmd = m[1];
    const n = (m[2] ?? '').split(/[\s,]+/).filter(Boolean).length;
    if (cmd === 'M' || cmd === 'L') total += n / 2;
    else if (cmd === 'C') total += n / 6;
    else if (cmd === 'Q') total += n / 4;
  }
  return total;
}

/** Grupos animados do fallback: cada um vira um `<Svg>` dentro de um `Animated.View`. */
export type ArtGroup =
  | 'headBack' // cabelo de trás e orelhas: acompanham a cabeça, ficam ATRÁS do pescoço e da roupa
  | 'body' // pescoço, ombros e roupa (fundo é a cor do círculo)
  | 'head' // rosto e o que vem por cima dele
  | 'nose'
  | 'eyeL'
  | 'eyeR'
  | 'browL'
  | 'browR'
  | 'mouth'
  | 'mouthOpen' // boca aberta dos sinais (lábios, interior e dentes; oculta em repouso)
  | 'tongueCenter' // língua centrada do `mouth_open` (oculta em repouso)
  | 'tongueSide' // língua de lado do `tongue` (oculta em repouso)
  | 'front'; // acessórios e cabelo da frente

export function artGroup(p: Part): ArtGroup | null {
  if (p.name === 'BG') return null;
  if (/^nose(_\d)?$/.test(p.name)) return 'nose';
  if (/^brow_(\d_)?l$/.test(p.name)) return 'browL';
  if (/^brow_(\d_)?r$/.test(p.name)) return 'browR';
  if (p.name.startsWith('eye_')) return p.mirror === true ? 'eyeR' : 'eyeL';
  if (p.name === 'tongue_center') return 'tongueCenter';
  if (p.name === 'tongue') return 'tongueSide';
  if (p.name === 'mouth_inside' || p.name.startsWith('mouth_open_')) return 'mouthOpen';
  if (p.name.startsWith('mouth_')) return 'mouth';
  if (p.layer === 1) return null;
  if (p.layer === 2) return 'headBack';
  if (p.layer === 3) return p.name === 'ears' ? 'headBack' : 'body';
  if (p.layer === 4) return 'head';
  return 'front'; // layers 6 e 7
}

/** Partes de um grupo para uma config. `hidden` entra só com `withHidden` (boca aberta e línguas). */
export function groupParts(group: ArtGroup, cfg: Cfg, withHidden = false): Part[] {
  const c = effectiveCfg(cfg);
  return PARTS.filter(
    (p) => artGroup(p) === group && (withHidden || p.hidden !== true) && isShown(p, c),
  ).sort((a, b) => a.layer - b.layer);
}
