/** Versão do protocolo cliente/servidor. Incrementar a cada mudança incompatível de mensagem. */
export const PROTOCOL_VERSION = 2;

/** Ids estáveis dos sinais de truco (catálogo em docs/sinais.md). Nunca renomear, só adicionar.
 * `wink` é o olho esquerdo **da tela** (zap); `wink_r` o direito; `mouth_l`/`mouth_r` torcem a boca. */
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
  'wink_r',
  'mouth_l',
  'mouth_r',
] as const;

export type SignalId = (typeof SIGNAL_IDS)[number];

/** Intervalo mínimo entre dois sinais do mesmo jogador (validado no servidor). */
export const SIGNAL_COOLDOWN_MS = 3000;

/** Intervalo mínimo entre duas mensagens de chat do mesmo jogador. */
export const CHAT_COOLDOWN_MS = 2000;

/** Tamanho máximo de uma mensagem de chat. */
export const CHAT_MAX_LENGTH = 140;

/** Tamanho máximo do significado combinado de um sinal (único teto, também no banco). */
export const PARTNER_CODE_MAX_LENGTH = 60;

/** Intervalo mínimo entre dois `setCode` do mesmo assento. */
export const CODES_COOLDOWN_MS = 1000;

/** Variantes de truco suportadas. */
export const VARIANT_IDS = ['paulista', 'mineiro'] as const;

export type VariantId = (typeof VARIANT_IDS)[number];

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

/** Teto de bytes (UTF-8) de qualquer mensagem do cliente; o servidor descarta acima disso antes de parsear. */
export const MAX_MESSAGE_BYTES = 1024;

/**
 * Intervalo mínimo entre duas ações de jogo do mesmo jogador (`play`, `playBlind`, `bet`, `accept`,
 * `run`, `special`, `ready`, `voteCancel`, `voteRematch`). 150 ms barra rajadas/automação sem atrapalhar jogo
 * humano (toque mais rápido leva ~200 ms). Aplicado pelo servidor; aqui só a constante.
 */
export const ACTION_MIN_INTERVAL_MS = 150;

/** Máximo de acentos combinantes consecutivos aceitos no chat (barra "zalgo"). */
export const CHAT_MAX_COMBINING_RUN = 3;

/** Janela padrão (ms) para a mesa votar "Jogar de novo" depois que a série termina com vencedor. */
export const DEFAULT_REMATCH_WINDOW_MS = 30_000;

/** Mínimo de humanos conectados para a revanche valer (abaixo disso o voto é recusado). */
export const REMATCH_MIN_HUMANS = 2;
