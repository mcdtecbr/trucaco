/**
 * Arte vetorial do avatar: os mesmos 104 paths do rig `assets/rive/avatar.riv` (viewBox 512x512). É o que
 * o `AvatarFallback` desenha com react-native-svg, então fallback e Rive mostram o mesmo avatar (ADR 0003).
 * Só caminhos absolutos M/L/C/Q/Z (contagem de vértices confiável). Sem bitmaps.
 */
import { type AvatarPartKey, type AvatarParts } from '@trucaco/protocol';
import { BG_COLORS, EYE_COLORS, HAIR_COLORS, OUTFIT_COLORS, SKIN_COLORS } from './parts';

const HAIR = 'hair';
const LIP = '#B4443A';
const LIP_DARK = '#9A3430';
const TONGUE = '#E36B7C';
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
const rect = (x1: number, y1: number, x2: number, y2: number) =>
  `M${x1},${y1}L${x2},${y1}L${x2},${y2}L${x1},${y2}Z`;
export type Selector = ((c: Cfg) => boolean) & { key: AvatarPartKey; value: number };
const is = (k: AvatarPartKey, v: number): Selector =>
  Object.assign((c: Cfg) => c[k] === v, { key: k, value: v });

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

const TILT_CAP = 'rotate(-5 256 150)';
const TILT_HAT = 'rotate(-4 256 150)';

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
export function groupParts(group: ArtGroup, c: Cfg, withHidden = false): Part[] {
  return PARTS.filter(
    (p) => artGroup(p) === group && (withHidden || p.hidden !== true) && (!p.when || p.when(c)),
  ).sort((a, b) => a.layer - b.layer);
}
