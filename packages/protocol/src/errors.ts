/**
 * Códigos de erro enviados em `error { code }`.
 * Os primeiros 14 espelham LITERALMENTE `RuleErrorCode` de `packages/rules/src/types.ts`
 * (protocol não pode importar rules). Um teste no servidor garante que o conjunto cobre o motor.
 */
export const ERROR_CODES = [
  // Espelho de RuleErrorCode (motor).
  'INVALID_SEAT',
  'HAND_FINISHED',
  'NOT_YOUR_TURN',
  'CARD_NOT_IN_HAND',
  'COVERED_NOT_ALLOWED',
  'BLIND_ONLY',
  'NOT_BLIND_HAND',
  'BET_NOT_ALLOWED',
  'BET_PENDING',
  'NO_PENDING_BET',
  'SPECIAL_DECISION_PENDING',
  'NO_SPECIAL_DECISION',
  'GAME_FINISHED',
  'SERIES_FINISHED',
  // Específicos do servidor.
  'NOT_SEATED',
  'ROOM_FULL',
  // Reservado ao cliente: o servidor nunca o emite; o cliente o sintetiza (reconexão com sala morta).
  'ROOM_NOT_FOUND',
  'INVALID_CODE',
  'INVALID_PAYLOAD',
  'RATE_LIMITED',
  'INVALID_SIGNAL',
  'INVALID_SFX',
  'CHAT_BLOCKED',
  'UNAUTHORIZED',
  // Revanche indisponível: série sem vencedor, janela fechada ou humanos conectados insuficientes.
  'REMATCH_NOT_AVAILABLE',
  // Reservado ao cliente: o servidor nunca o emite; o cliente o sintetiza (401 na reconexão).
  'TOKEN_EXPIRED',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
