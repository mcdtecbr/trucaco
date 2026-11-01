/** Versão do protocolo cliente/servidor. Incrementar a cada mudança incompatível de mensagem. */
export const PROTOCOL_VERSION = 1;

/** Ids estáveis dos sinais de truco (catálogo em docs/sinais.md). Nunca renomear, só adicionar. */
export const SIGNAL_IDS = [
  'wink',
  'eyebrow',
  'lip_bite',
  'cheek_puff',
  'tongue',
  'nose_twitch',
  'shrug',
  'nod',
  'head_shake',
  'chin_up',
  'look_away',
  'smile',
] as const;

export type SignalId = (typeof SIGNAL_IDS)[number];

/** Intervalo mínimo entre dois sinais do mesmo jogador (validado no servidor). */
export const SIGNAL_COOLDOWN_MS = 3000;

/** Intervalo mínimo entre duas mensagens de chat do mesmo jogador. */
export const CHAT_COOLDOWN_MS = 2000;

/** Tamanho máximo de uma mensagem de chat. */
export const CHAT_MAX_LENGTH = 140;

/** Variantes de truco suportadas. */
export const VARIANT_IDS = ['paulista', 'mineiro'] as const;

export type VariantId = (typeof VARIANT_IDS)[number];
