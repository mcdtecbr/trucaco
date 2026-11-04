import { AVATAR_PART_COUNTS, AVATAR_PART_KEYS, type AvatarPartKey } from '@trucaco/protocol';
import { SIGNAL_TRIGGERS } from './signals';

/** Estados ociosos da state machine (não são sinais; não passam pelo servidor). */
export const RIVE_IDLE_STATES = ['idle_breathe', 'idle_blink', 'idle_look'] as const;

/** Limite do arquivo `.riv` exportado (docs/avatar-rig.md). */
export const RIVE_MAX_BYTES = 500 * 1024;

/**
 * Contrato do rig `assets/rive/avatar.riv`. Nomes são contrato: mudar exige atualizar este arquivo,
 * `docs/avatar-rig.md` e `docs/sinais.md` juntos.
 */
export const RIVE_CONTRACT = {
  artboard: 'Avatar',
  stateMachine: 'Main',
  /** Inputs Number da state machine, um por parte; valor = índice da variante (`0..n-1`). */
  inputs: AVATAR_PART_KEYS,
  /** Quantidade de variantes por input (limite superior exclusivo do índice). */
  inputCounts: AVATAR_PART_COUNTS,
  /** Inputs Trigger, um por sinal. */
  triggers: SIGNAL_TRIGGERS,
  idleStates: RIVE_IDLE_STATES,
  maxBytes: RIVE_MAX_BYTES,
} as const;

/** Descrição curta de cada input, usada para conferir que nenhuma parte ficou sem documentação. */
export const RIVE_INPUT_DOCS: Readonly<Record<AvatarPartKey, string>> = {
  face_shape: 'Number: formato do rosto (0..5)',
  skin: 'Number: cor da pele',
  hair: 'Number: cabelo (estilo e cor)',
  eyes: 'Number: estilo dos olhos (0..5)',
  mouth: 'Number: estilo da boca',
  outfit: 'Number: roupa',
  accessory: 'Number: acessório (0 = nenhum, 1 = bigode, 2 = brinco)',
  bg_color: 'Number: cor do fundo',
  hair_color: 'Number: cor do cabelo, sobrancelhas e bigode',
  eye_color: 'Number: cor da íris',
  outfit_color: 'Number: cor principal da roupa (0 = padrão do modelo)',
  brows: 'Number: estilo das sobrancelhas (0..3; cor = hair_color)',
  nose: 'Number: estilo do nariz (0..7; cor = sombra da pele)',
};
