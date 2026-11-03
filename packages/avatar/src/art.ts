/**
 * Arte vetorial do avatar: os mesmos 65 paths do rig `assets/rive/avatar.riv` (viewBox 512x512). É o que
 * o `AvatarFallback` desenha com react-native-svg, então fallback e Rive mostram o mesmo avatar (ADR 0003).
 * Só caminhos absolutos M/L/C/Q/Z (contagem de vértices confiável). Sem bitmaps.
 */
import { type AvatarPartKey, type AvatarParts } from '@trucaco/protocol';
import { BG_COLORS, EYE_COLORS, HAIR_COLORS, OUTFIT_COLORS, SKIN_COLORS } from './parts';

const HAIR = 'hair';
const LIP = '#B4443A';
const K = 0.5523;

export type Fill = string | 'skin' | 'shade' | 'bg' | 'hair' | 'outfit' | 'iris';
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
  tilt?: string; // transform de rotação (boné/chapéu levemente inclinados)
  hidden?: boolean; // existe no rig mas fica oculto em repouso (língua, interior da boca)
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
const rect = (x1: number, y1: number, x2: number, y2: number) =>
  `M${x1},${y1}L${x2},${y1}L${x2},${y2}L${x1},${y2}Z`;
export type Selector = ((c: Cfg) => boolean) & { key: AvatarPartKey; value: number };
const is = (k: AvatarPartKey, v: number): Selector =>
  Object.assign((c: Cfg) => c[k] === v, { key: k, value: v });

const TILT_CAP = 'rotate(-5 256 150)';
const TILT_HAT = 'rotate(-4 256 150)';

export const PARTS: readonly Part[] = [
  // 1. Fundo
  { name: 'BG', layer: 1, d: rect(0, 0, 512, 512), fill: 'bg' },

  // 2. Cabelo posterior
  { name: 'hair_afro_back', layer: 2, d: ell(256, 170, 152, 132), fill: HAIR, when: is('hair', 2) },
  {
    name: 'hair_long_back',
    layer: 2,
    fill: HAIR,
    when: is('hair', 3),
    d: 'M142,230C120,120 190,84 256,84C322,84 392,120 370,230L390,430L122,430Z',
  },

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

  // 4. Formato da cabeça e sombra do pescoço
  {
    name: 'face_oval',
    layer: 4,
    fill: 'skin',
    when: is('face_shape', 0),
    d: 'M256,100C330,100 366,170 366,240C366,310 320,372 256,372C192,372 146,310 146,240C146,170 182,100 256,100Z',
  },
  {
    name: 'face_square',
    layer: 4,
    fill: 'skin',
    when: is('face_shape', 1),
    d: 'M150,130Q150,108 175,108L337,108Q362,108 362,130L368,290L332,362L180,362L144,290Z',
  },
  {
    name: 'face_triangle',
    layer: 4,
    fill: 'skin',
    when: is('face_shape', 2),
    d: 'M256,104C350,104 378,170 370,230C362,280 300,330 256,380C212,330 150,280 142,230C134,170 162,104 256,104Z',
  },
  {
    name: 'face_round',
    layer: 4,
    fill: 'skin',
    when: is('face_shape', 3),
    d: ell(256, 240, 128, 138),
  },
  { name: 'neck_shadow', layer: 4, d: 'M224,366Q256,402 288,366L292,396L220,396Z', fill: 'shade' },

  // 5. Olhos, sobrancelhas, nariz e boca
  {
    name: 'eye_white_0',
    layer: 5,
    fill: '#FFFFFF',
    when: is('eyes', 0),
    d: 'M180,228Q210,204 240,228Q210,250 180,228Z',
  },
  {
    name: 'eye_white_0_r',
    layer: 5,
    fill: '#FFFFFF',
    when: is('eyes', 0),
    mirror: true,
    d: 'M180,228Q210,204 240,228Q210,250 180,228Z',
  },
  { name: 'eye_pupil_0', layer: 5, fill: 'iris', when: is('eyes', 0), d: ell(212, 228, 11, 11) },
  {
    name: 'eye_pupil_0_r',
    layer: 5,
    fill: 'iris',
    when: is('eyes', 0),
    mirror: true,
    d: ell(212, 228, 11, 11),
  },
  {
    name: 'eye_white_1',
    layer: 5,
    fill: '#FFFFFF',
    when: is('eyes', 1),
    d: 'M180,234Q210,218 240,228Q214,250 180,234Z',
  },
  {
    name: 'eye_white_1_r',
    layer: 5,
    fill: '#FFFFFF',
    when: is('eyes', 1),
    mirror: true,
    d: 'M180,234Q210,218 240,228Q214,250 180,234Z',
  },
  {
    name: 'eye_pupil_1',
    layer: 5,
    fill: 'iris',
    when: is('eyes', 1),
    d: ell(212, 236, 9, 8) + 'M176,232L244,222L244,230Q210,232 176,242Z',
  },
  {
    name: 'eye_pupil_1_r',
    layer: 5,
    fill: 'iris',
    when: is('eyes', 1),
    mirror: true,
    d: ell(212, 236, 9, 8) + 'M176,232L244,222L244,230Q210,232 176,242Z',
  },
  { name: 'eye_white_2', layer: 5, fill: '#FFFFFF', when: is('eyes', 2), d: ell(208, 236, 36, 38) },
  {
    name: 'eye_white_2_r',
    layer: 5,
    fill: '#FFFFFF',
    when: is('eyes', 2),
    mirror: true,
    d: ell(208, 236, 36, 38),
  },
  { name: 'eye_pupil_2', layer: 5, fill: 'iris', when: is('eyes', 2), d: ell(212, 240, 20, 22) },
  {
    name: 'eye_pupil_2_r',
    layer: 5,
    fill: 'iris',
    when: is('eyes', 2),
    mirror: true,
    d: ell(212, 240, 20, 22),
  },
  {
    name: 'eye_white_3',
    layer: 5,
    fill: '#FFFFFF',
    when: is('eyes', 3),
    d: 'M176,230Q210,214 246,230Q210,242 176,230Z',
  },
  {
    name: 'eye_white_3_r',
    layer: 5,
    fill: '#FFFFFF',
    when: is('eyes', 3),
    mirror: true,
    d: 'M176,230Q210,214 246,230Q210,242 176,230Z',
  },
  { name: 'eye_pupil_3', layer: 5, fill: 'iris', when: is('eyes', 3), d: ell(212, 230, 10, 7) },
  {
    name: 'eye_pupil_3_r',
    layer: 5,
    fill: 'iris',
    when: is('eyes', 3),
    mirror: true,
    d: ell(212, 230, 10, 7),
  },
  { name: 'brow_l', layer: 5, fill: HAIR, d: 'M178,204Q210,186 244,200L242,211Q210,202 180,218Z' },
  {
    name: 'brow_r',
    layer: 5,
    fill: HAIR,
    mirror: true,
    d: 'M178,204Q210,186 244,200L242,211Q210,202 180,218Z',
  },
  {
    name: 'nose',
    layer: 5,
    fill: 'shade',
    d: 'M256,238Q244,270 236,278Q256,288 276,278Q268,270 256,238Z',
  },
  {
    name: 'mouth_0_upper',
    layer: 5,
    fill: LIP,
    when: is('mouth', 0),
    d: 'M216,314Q224,320 236,320L276,320Q288,320 296,314L298,318Q290,326 276,326L236,326Q222,326 214,318Z',
  },
  {
    name: 'mouth_0_lower',
    layer: 5,
    fill: LIP,
    when: is('mouth', 0),
    d: 'M232,332Q256,338 280,332Q256,346 232,332Z',
  },
  {
    name: 'mouth_1_upper',
    layer: 5,
    fill: LIP,
    when: is('mouth', 1),
    d: 'M210,312Q256,338 302,312L304,319Q256,346 208,319Z',
  },
  {
    name: 'mouth_1_lower',
    layer: 5,
    fill: LIP,
    when: is('mouth', 1),
    d: 'M228,332Q256,346 284,332Q256,352 228,332Z',
  },
  {
    name: 'mouth_2_upper',
    layer: 5,
    fill: LIP,
    when: is('mouth', 2),
    d: 'M220,318Q240,304 256,312Q272,304 292,318Q256,328 220,318Z',
  },
  {
    name: 'mouth_2_lower',
    layer: 5,
    fill: LIP,
    when: is('mouth', 2),
    d: 'M222,320Q256,332 292,320Q282,358 256,360Q232,358 222,320Z',
  },
  {
    name: 'mouth_3_upper',
    layer: 5,
    fill: LIP,
    when: is('mouth', 3),
    d: 'M232,318Q256,314 282,318L282,321Q256,319 232,321Z',
  },
  {
    name: 'mouth_3_lower',
    layer: 5,
    fill: LIP,
    when: is('mouth', 3),
    d: 'M234,322Q256,328 280,322Q256,333 234,322Z',
  },
  { name: 'mouth_inside', layer: 5, fill: '#3B0D0D', hidden: true, d: ell(256, 328, 16, 12) },
  { name: 'tongue', layer: 5, fill: '#E36B7C', hidden: true, d: 'M242,330Q256,352 272,330Z' },

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

  // 7. Cabelo frontal, bonés e chapéus
  {
    name: 'hair_bald_shade',
    layer: 7,
    fill: 'shade',
    opacity: 0.55,
    when: is('hair', 0),
    d: 'M190,134Q256,98 322,134Q256,114 190,134Z',
  },
  {
    name: 'hair_short',
    layer: 7,
    fill: HAIR,
    when: is('hair', 1),
    d: 'M148,215C140,120 190,84 256,84C322,84 372,120 364,215C350,170 330,150 256,148C182,150 162,170 148,215Z',
  },
  {
    name: 'hair_afro_front',
    layer: 7,
    fill: HAIR,
    when: is('hair', 2),
    d: 'M150,215C140,110 190,70 256,70C322,70 372,110 362,215C350,168 322,150 256,150C190,150 162,168 150,215Z',
  },
  {
    name: 'hair_long_front',
    layer: 7,
    fill: HAIR,
    when: is('hair', 3),
    d: 'M146,232C140,130 190,90 256,90C322,90 372,130 366,232C350,170 300,150 256,150C210,150 160,170 146,232Z',
  },
  {
    name: 'hair_bun_cap',
    layer: 7,
    fill: HAIR,
    when: is('hair', 4),
    d: 'M148,215C140,120 190,88 256,88C322,88 372,120 364,215C350,170 330,150 256,148C182,150 162,170 148,215Z',
  },
  { name: 'hair_bun', layer: 7, fill: HAIR, when: is('hair', 4), d: ell(256, 76, 40, 33) },
  {
    name: 'cap_crown',
    layer: 7,
    fill: '#1E2836',
    tilt: TILT_CAP,
    when: is('hair', 5),
    d: 'M150,170C150,100 200,76 256,76C312,76 362,100 362,170Z',
  },
  {
    name: 'cap_brim',
    layer: 7,
    fill: '#111827',
    tilt: TILT_CAP,
    when: is('hair', 5),
    d: 'M148,168Q256,154 362,168Q432,174 452,200Q396,188 322,190L148,188Z',
  },
  {
    name: 'hat_crown',
    layer: 7,
    fill: '#D6B982',
    tilt: TILT_HAT,
    when: is('hair', 6),
    d: 'M150,154C150,84 206,60 256,60C306,60 362,84 362,154Z',
  },
  {
    name: 'hat_brim',
    layer: 7,
    fill: '#BE9B5F',
    tilt: TILT_HAT,
    when: is('hair', 6),
    d: ell(256, 150, 152, 26),
  },
  {
    name: 'hair_pompadour',
    layer: 7,
    fill: HAIR,
    when: is('hair', 7),
    d: 'M150,212C130,120 190,66 270,74C340,78 384,112 362,212C350,160 320,140 260,140C200,140 170,150 150,212Z',
  },
];

/** Partes selecionadas para uma config, já na ordem de desenho. */
export function selectParts(c: Cfg): Part[] {
  return PARTS.filter((p) => !p.hidden && (!p.when || p.when(c)))
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.layer - b.p.layer || a.i - b.i)
    .map((x) => x.p);
}

/** Cor concreta de um preenchimento para as partes escolhidas (`c` dentro do catálogo). */
export function resolveFill(fill: Fill, c: Cfg): string {
  if (fill === 'skin') return (SKIN_COLORS[c.skin] ?? SKIN_COLORS[0]!).base;
  if (fill === 'shade') return (SKIN_COLORS[c.skin] ?? SKIN_COLORS[0]!).shade;
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
  | 'tongue' // interior da boca e língua (ocultos em repouso)
  | 'front'; // acessórios e cabelo da frente

export function artGroup(p: Part): ArtGroup | null {
  if (p.name === 'BG') return null;
  if (p.name === 'nose') return 'nose';
  if (p.name === 'brow_l') return 'browL';
  if (p.name === 'brow_r') return 'browR';
  if (p.name.startsWith('eye_')) return p.mirror === true ? 'eyeR' : 'eyeL';
  if (p.name === 'mouth_inside' || p.name === 'tongue') return 'tongue';
  if (p.name.startsWith('mouth_')) return 'mouth';
  if (p.layer === 1) return null;
  if (p.layer === 2) return 'headBack';
  if (p.layer === 3) return p.name === 'ears' ? 'headBack' : 'body';
  if (p.layer === 4) return 'head';
  return 'front'; // layers 6 e 7
}

/** Partes de um grupo para uma config. `hidden` entra só com `withHidden` (língua, interior da boca). */
export function groupParts(group: ArtGroup, c: Cfg, withHidden = false): Part[] {
  return PARTS.filter(
    (p) => artGroup(p) === group && (withHidden || p.hidden !== true) && (!p.when || p.when(c)),
  ).sort((a, b) => a.layer - b.layer);
}
