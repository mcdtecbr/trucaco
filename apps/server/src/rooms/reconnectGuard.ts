/**
 * `beforeUpgrade` do transporte WebSocket: exige identidade na RECONEXÃO.
 *
 * Por que existe: no `@colyseus/core` 0.18 o `onAuth` NÃO roda ao reconectar (`matchMaker.reconnect` e
 * o ramo de reconexão de `Room._onJoin` ignoram credencial). A única prova seria o token de
 * reconexão, e quem o tivesse assumiria o assento. Aqui, antes de completar o upgrade, a identidade
 * apresentada (`context.token`) tem de ser a do dono do assento da sessão. O core ainda valida o
 * token de reconexão por sessão (`hasReservedSeat`), então token de um assento não abre outro.
 *
 * Entradas normais (sem `reconnectionToken` na URL) passam direto. Sala que não é `TrucoRoom` ou não
 * é local também passa: o core decide (e recusa se a reserva não existe).
 */
import { matchMaker } from '@colyseus/core';
import type { BeforeUpgradeHandler } from '@colyseus/core';
import { log } from '../logger';
import { TrucoRoom, devReconnectUserId } from './TrucoRoom';

const ROOM_PATH = /\/[a-zA-Z0-9_-]+\/([a-zA-Z0-9_-]+)$/;

export const reconnectUpgradeGuard: BeforeUpgradeHandler = (request, context) => {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return new Response(null, { status: 400 });
  }
  if (!url.searchParams.has('reconnectionToken')) return undefined;
  const sessionId = url.searchParams.get('sessionId');
  const roomId = ROOM_PATH.exec(url.pathname)?.[1];
  if (sessionId === null || roomId === undefined) return undefined;
  let room: unknown;
  try {
    room = matchMaker.getLocalRoomById(roomId);
  } catch {
    return undefined;
  }
  if (!(room instanceof TrucoRoom)) return undefined;
  const userId = devReconnectUserId(context.token, process.env.NODE_ENV);
  if (room.authorizeReconnect(sessionId, userId)) return undefined;
  // Nunca registrar o token nem a sessão.
  log.warn('truco: reconexão recusada (identidade não confere)', { room: roomId });
  return new Response(null, { status: 403 });
};
