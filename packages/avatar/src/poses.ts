import type { SignalId } from '@trucaco/protocol';

/**
 * Canais animados do avatar vetorial. Cada sinal descreve, por canal, uma lista de valores
 * distribuídos igualmente de 0 a 1 do progresso (primeiro e último valor = pose neutra).
 * Unidades: canais de posição em unidades de 100 (caixa do avatar), `*Rot` em graus,
 * escalas e opacidades em 0..1.
 */
export type PoseChannel =
  | 'headX'
  | 'headY'
  | 'headRot'
  | 'shoulderY'
  | 'browY'
  | 'browScale'
  | 'winkScaleY'
  | 'pupilX'
  | 'noseX'
  | 'noseScale'
  | 'tongueOpacity'
  | 'tongueY'
  | 'biteOpacity'
  | 'puffOpacity'
  | 'puffScale'
  | 'smileOpacity';

export type Pose = Readonly<Partial<Record<PoseChannel, readonly number[]>>>;

/** Valor neutro (ocioso) de cada canal. */
export const NEUTRAL: Readonly<Record<PoseChannel, number>> = {
  headX: 0,
  headY: 0,
  headRot: 0,
  shoulderY: 0,
  browY: 0,
  browScale: 1,
  winkScaleY: 1,
  pupilX: 0,
  noseX: 0,
  noseScale: 1,
  tongueOpacity: 0,
  tongueY: -3,
  biteOpacity: 0,
  puffOpacity: 0,
  puffScale: 0.6,
  smileOpacity: 0,
};

export const POSES: Readonly<Record<SignalId, Pose>> = {
  wink: {
    winkScaleY: [1, 0.08, 0.08, 0.08, 0.08, 1],
    headRot: [0, -4, -4, -4, -4, 0],
    smileOpacity: [0, 0.6, 0.6, 0.6, 0.6, 0],
  },
  eyebrow: {
    browY: [0, -6, -6, -6, -6, -6, 0],
    browScale: [1, 1.12, 1.12, 1.12, 1.12, 1.12, 1],
  },
  lip_bite: {
    biteOpacity: [0, 1, 1, 1, 1, 1, 0],
    headY: [0, 1, 1, 1, 1, 1, 0],
  },
  cheek_puff: {
    puffOpacity: [0, 1, 1, 1, 1, 1, 0],
    puffScale: [0.6, 1, 1.1, 1, 1.1, 1, 0.6],
  },
  tongue: {
    tongueOpacity: [0, 1, 1, 1, 1, 1, 0],
    tongueY: [-3, 2, 3, 2, 3, 2, -3],
    headRot: [0, 5, 5, 5, 5, 5, 0],
  },
  nose_twitch: {
    noseX: [0, 1.6, -1.6, 1.6, -1.6, 1.6, -1.6, 0],
    noseScale: [1, 1.25, 1, 1.25, 1, 1.25, 1, 1],
  },
  shrug: {
    shoulderY: [0, -7, -7, -7, -7, -7, 0],
    headY: [0, 4, 4, 4, 4, 4, 0],
  },
  nod: {
    headY: [0, 6, 0, 6, 0, 6, 0],
    headRot: [0, 3, 0, 3, 0, 3, 0],
  },
  head_shake: {
    headX: [0, -3, 3, -3, 3, -3, 0],
    headRot: [0, -9, 9, -9, 9, -9, 0],
  },
  chin_up: {
    headY: [0, -4, -4, -4, -4, 0],
    headRot: [0, -9, -9, -9, -9, 0],
  },
  look_away: {
    pupilX: [0, 5, 5, 5, 5, 5, 0],
    headX: [0, 4, 4, 4, 4, 4, 0],
    headRot: [0, 7, 7, 7, 7, 7, 0],
  },
  smile: {
    smileOpacity: [0, 1, 1, 1, 1, 1, 0],
    browY: [0, -2, -2, -2, -2, -2, 0],
  },
};
