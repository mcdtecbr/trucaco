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
  // O combinado de sinais da dupla não foi gravado (falha ou gravação desligada nesta mesa): vale só
  // nesta mesa e some na próxima. Sem detalhe do banco.
  'CODE_NOT_SAVED',
  // Reservado ao cliente: o servidor nunca o emite; o cliente o sintetiza (401 na reconexão).
  'TOKEN_EXPIRED',
  // Bots de vaga: só o host muda bots.
  'NOT_HOST',
  // Bots de vaga: mesa da fila pública nunca tem bot; fora da espera (partida em curso) também recusa.
  'BOTS_NOT_ALLOWED',
  // Bots de vaga: o assento alvo tem um humano (não dá para pôr nem tirar bot dele).
  'SEAT_OCCUPIED',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
