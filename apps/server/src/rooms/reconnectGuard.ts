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
/** Host aceito: só host/porta/IPv6 literal. Qualquer outro caractere (`#`, `?`, `@`, `/`...) vira 400. */
const SAFE_HOST = /^[A-Za-z0-9.:[\]-]*$/;

const bad = (): Response => new Response(null, { status: 400 });

/**
 * O core monta `Request` como `http://${Host}${req.url}`, mas o transporte (`ws-transport`) lê
 * `sessionId`/`reconnectionToken`/`roomId` de `ws://server${req.url}`, IGNORANDO o Host. Um Host com
 * `#` ou `?` faria o guard enxergar outra URL que o transporte (e passar). Defesa em duas partes: o
 * Host é restrito a [A-Za-z0-9.:\[\]-] (sem delimitadores de URL, as duas leituras coincidem) e a
 * decisão usa path+query reinterpretados com base FIXA, exatamente como o transporte. Em dúvida, fecha.
 */
export const reconnectUpgradeGuard: BeforeUpgradeHandler = (request, context) => {
  const host = context.headers.get('host');
  if (host !== null && !SAFE_HOST.test(host)) return bad();
  let url: URL;
  try {
    const parsed = new URL(request.url);
    url = new URL(`ws://server${parsed.pathname}${parsed.search}`);
  } catch {
    return bad();
  }
  if (!url.searchParams.has('reconnectionToken')) return undefined;
  // Reconexão declarada: sem sessão e sala válidas não há como conferir a identidade -> recusa.
  const sessionId = url.searchParams.get('sessionId');
  const roomId = ROOM_PATH.exec(url.pathname)?.[1];
  if (sessionId === null || sessionId === '' || roomId === undefined) return bad();
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
