/** Versão do protocolo cliente/servidor. Incrementar a cada mudança incompatível de mensagem. */
export const PROTOCOL_VERSION = 2;

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

export { RANKS, SUITS } from './cards';
export type { Card, Rank, Suit } from './cards';

/** Tempo para o jogador agir antes do bot jogar por ele. */
export const TURN_TIMEOUT_MS = 20000;

/** Janela de reconexão (`allowReconnection`) antes do bot assumir a cadeira. */
export const RECONNECT_SECONDS = 60;

/** Intervalo mínimo entre dois efeitos sonoros do mesmo jogador (docs/audio.md). */
export const SFX_COOLDOWN_MS = 5000;

/** Ids estáveis dos efeitos engraçados (docs/audio.md §2). Nunca renomear, só adicionar. */
export const SFX_IDS = [
  'horn',
  'sad_trombone',
  'laugh',
  'crowd_ooh',
  'rooster',
  'rimshot',
  'clap',
  'crickets',
] as const;

export type SfxId = (typeof SFX_IDS)[number];

/** Frases rápidas de chat: ids estáveis; rótulos são exemplos em pt-BR (o cliente pode traduzir). */
export const QUICK_PHRASES = [
  { id: 'good_luck', label: 'Boa sorte!' },
  { id: 'nice_play', label: 'Boa jogada!' },
  { id: 'lets_go', label: 'Vamos nessa!' },
  { id: 'trust_me', label: 'Confia em mim' },
  { id: 'wait', label: 'Calma aí' },
  { id: 'hurry', label: 'Vamos, joga!' },
  { id: 'oops', label: 'Ops!' },
  { id: 'thanks', label: 'Valeu!' },
] as const;

export type QuickPhraseId = (typeof QUICK_PHRASES)[number]['id'];

export const QUICK_PHRASE_IDS: readonly QuickPhraseId[] = QUICK_PHRASES.map((p) => p.id);

export { ERROR_CODES } from './errors';
export type { ErrorCode } from './errors';
export {
  FORMATS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  VISIBILITIES,
  isValidRoomCode,
  validateRoomOptions,
} from './room';
export type {
  Format,
  JoinOptions,
  RoomOptions,
  RoomOptionsError,
  RoomOptionsResult,
  Seat,
  Team,
  Visibility,
} from './room';
export { BET_CRY_BY_VALUE, BET_CRY_IDS, betCry } from './events';
export type { BetCryId, HandEndReason, PublicGameEvent, SpecialKind } from './events';
export { parseClientMessage } from './messages';
export type {
  ChatScope,
  ClientMessage,
  ParseResult,
  PresenceStatus,
  ServerMessage,
} from './messages';
