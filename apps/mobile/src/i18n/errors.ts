/**
 * Código de erro -> texto pt-BR curto. O servidor nunca manda texto: quem traduz é o cliente. Os textos
 * são genéricos de propósito (nada de detalhe interno, stack, URL ou eco da entrada).
 */
import { ERROR_CODES, HTTP_ERROR_CODES } from '@trucaco/protocol';
import { isApiError } from '../net/api';
import { GameClientError } from '../net/colyseus';
import { SessionRequiredError } from '../net/session';

/** Códigos que só o cliente produz (rede, validação local, reserva recusada). */
export const CLIENT_ERROR_CODES = [
  'NETWORK',
  'TIMEOUT',
  'INVALID_RESPONSE',
  'UNKNOWN',
  'SESSION_REQUIRED',
  'TOKEN_EXPIRED',
  'ROOM_NOT_FOUND',
  'JOIN_FAILED',
  'INVALID_NICKNAME_LOCAL',
] as const;

const GENERIC = 'Algo deu errado. Tente de novo.';
const UNAVAILABLE = 'Servidor indisponível no momento. Tente de novo em instantes.';

const MESSAGES: Readonly<Record<string, string>> = {
  // HTTP
  ALREADY_IN_TABLE: 'Você já está em uma mesa (talvez em outra aba ou aparelho).',
  ALREADY_SEATED: 'Você já está sentado nesta mesa.',
  BANNED: 'Você não pode entrar nesta mesa.',
  BO3_REQUIRES_PRIVATE: 'Melhor de 3 só vale em mesa privada.',
  CORS_FORBIDDEN: UNAVAILABLE,
  FORBIDDEN: 'Ação não permitida.',
  INTERNAL: GENERIC,
  INVALID_AVATAR: 'Avatar inválido.',
  INVALID_BODY: GENERIC,
  INVALID_CODE: 'Código inválido. Use 8 letras e números.',
  INVALID_CODES: GENERIC,
  INVALID_INPUT: GENERIC,
  INVALID_JSON: GENERIC,
  INVALID_NICKNAME: 'Apelido inválido. Use 3 a 16 letras, números, ponto, hífen ou sublinhado.',
  INVALID_OPTIONS: 'Opções de mesa inválidas.',
  INVALID_PARTNER: GENERIC,
  INVALID_REFRESH_TOKEN: 'Sua sessão expirou. Entre de novo.',
  METHOD_NOT_ALLOWED: GENERIC,
  NICKNAME_TAKEN: 'Esse apelido já está em uso. Escolha outro.',
  NOT_FOUND: GENERIC,
  NOT_IMPLEMENTED: 'Recurso ainda não disponível.',
  NOT_PARTNERS: 'Você só pode combinar sinais com quem já jogou ao seu lado.',
  PAYLOAD_TOO_LARGE: GENERIC,
  QUEUE_COOLDOWN: 'Aguarde um pouco antes de entrar na fila de novo.',
  QUEUE_FULL: 'A fila está cheia. Tente de novo em instantes.',
  RATE_LIMITED: 'Muitas tentativas. Aguarde um pouco e tente de novo.',
  ROOM_FULL: 'Mesa indisponível. Confira o código.',
  SERVICE_UNAVAILABLE: UNAVAILABLE,
  // Mesmo texto para inexistente, cheia, em partida ou fechada: não revela se a mesa existe.
  TABLE_UNAVAILABLE: 'Mesa indisponível. Confira o código.',
  UNAUTHORIZED: 'Sua sessão expirou. Entre de novo.',
  UNAVAILABLE: UNAVAILABLE,
  UNSUPPORTED_MEDIA_TYPE: GENERIC,
  USE_LOBBY: GENERIC,
  // Canal da sala (WebSocket)
  INVALID_SEAT: GENERIC,
  HAND_FINISHED: 'A mão já terminou.',
  NOT_YOUR_TURN: 'Não é a sua vez.',
  CARD_NOT_IN_HAND: 'Essa carta não está na sua mão.',
  COVERED_NOT_ALLOWED: 'Não dá para jogar carta coberta agora.',
  BLIND_ONLY: 'Na mão de ferro a carta é escolhida às cegas.',
  NOT_BLIND_HAND: GENERIC,
  BET_NOT_ALLOWED: 'Você não pode apostar agora.',
  BET_PENDING: 'Há uma aposta aguardando resposta.',
  NO_PENDING_BET: GENERIC,
  SPECIAL_DECISION_PENDING: 'Falta decidir a mão especial.',
  NO_SPECIAL_DECISION: GENERIC,
  GAME_FINISHED: 'O jogo já terminou.',
  SERIES_FINISHED: 'A série já terminou.',
  NOT_SEATED: 'Você não está sentado nesta mesa.',
  INVALID_PAYLOAD: GENERIC,
  INVALID_SIGNAL: GENERIC,
  INVALID_SFX: GENERIC,
  CHAT_BLOCKED: 'Mensagem não enviada.',
  REMATCH_NOT_AVAILABLE: 'A revanche não está disponível.',
  ROOM_NOT_FOUND: 'A mesa não existe mais.',
  TOKEN_EXPIRED: 'Sua sessão expirou. Entre de novo.',
  // Só do cliente
  NETWORK: 'Sem conexão com o servidor. Verifique a internet e tente de novo.',
  TIMEOUT: 'O servidor demorou a responder. Tente de novo.',
  INVALID_RESPONSE: GENERIC,
  UNKNOWN: GENERIC,
  SESSION_REQUIRED: 'Entre de novo para continuar.',
  JOIN_FAILED: 'Não foi possível sentar na mesa. Tente de novo.',
  INVALID_NICKNAME_LOCAL:
    'Apelido inválido. Use 3 a 16 letras, números, ponto, hífen ou sublinhado.',
};

/** O código tem mensagem própria (usado pelo teste de cobertura). */
export function hasMessage(code: string): boolean {
  return Object.hasOwn(MESSAGES, code);
}

/** Texto pt-BR para um código; código desconhecido (servidor mais novo) cai no genérico. */
export function errorMessage(code: string | undefined): string {
  if (code === undefined) return GENERIC;
  return Object.hasOwn(MESSAGES, code) ? (MESSAGES[code] as string) : GENERIC;
}

/** Código a partir de qualquer erro lançado pela camada de rede. Nunca expõe `message`/`cause`. */
export function errorCodeOf(e: unknown): string {
  if (isApiError(e)) return e.code;
  if (e instanceof GameClientError) return e.code;
  if (e instanceof SessionRequiredError) return 'SESSION_REQUIRED';
  return 'UNKNOWN';
}

export function messageForError(e: unknown): string {
  return errorMessage(errorCodeOf(e));
}

/** `QUEUE_COOLDOWN` e `RATE_LIMITED` com o `Retry-After` quando existe. */
export function withRetry(code: string, retryAfterSeconds: number | undefined): string {
  const base = errorMessage(code);
  if (retryAfterSeconds === undefined || retryAfterSeconds <= 0) return base;
  return `${base} (${Math.ceil(retryAfterSeconds)} s)`;
}

/** Todos os códigos que a UI pode receber: usado pelo teste de cobertura. */
export const ALL_KNOWN_CODES: readonly string[] = [
  ...HTTP_ERROR_CODES,
  ...ERROR_CODES,
  ...CLIENT_ERROR_CODES,
];
