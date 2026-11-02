/**
 * `beforeUpgrade` do transporte WebSocket: exige identidade na RECONEXÃO.
 *
 * Por que existe: no `@colyseus/core` 0.18 o `onAuth` NÃO roda ao reconectar (`matchMaker.reconnect` e
 * o ramo de reconexão de `Room._onJoin` ignoram credencial). A única prova seria o token de
 * reconexão, e quem o tivesse assumiria o assento. Aqui, antes de completar o upgrade, o JWT de acesso
 * (cabeçalho `Authorization` ou subprotocolo `trucaco.bearer`, NUNCA a query `_authToken`) tem de ser
 * válido (401 se não for) e do dono do assento da sessão (403 se for de outro). O core ainda valida o
 * token de reconexão por sessão (`hasReservedSeat`), então token de um assento não abre outro.
 *
 * Também recusa (400) qualquer upgrade que ofereça subprotocolo cujo 1º item não seja `trucaco.bearer`.
 *
 * Entradas normais (sem `reconnectionToken` na URL) passam direto. Sala que não é `TrucoRoom` ou não
 * é local também passa: o core decide (e recusa se a reserva não existe).
 */
import { matchMaker } from '@colyseus/core';
import { WS_BEARER_PROTOCOL } from '@trucaco/protocol';
import type { BeforeUpgradeHandler } from '@colyseus/core';
import { log } from '../logger';
import { bearerFromSubprotocol } from '../auth/authService';
import { devReconnectUserId, getRoomAuth, identityFromToken, tokenFromHeaders } from './roomAuth';
import { TrucoRoom } from './TrucoRoom';

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
export const reconnectUpgradeGuard: BeforeUpgradeHandler = async (request, context) => {
  const host = context.headers.get('host');
  if (host !== null && !SAFE_HOST.test(host)) return bad();
  // Subprotocolo: se oferecido, o 1º item TEM de ser `trucaco.bearer` (`['trucaco.bearer', jwt]`). Com o JWT
  // primeiro, o `ws` o selecionaria e o ecoaria no 101. Vale para TODO upgrade, não só reconexão.
  const offered = context.headers.get('sec-websocket-protocol');
  if (offered !== null && offered.split(',')[0]?.trim() !== WS_BEARER_PROTOCOL) return bad();
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
  // JWT SÓ por cabeçalho `Authorization` ou subprotocolo. `context.token` do core vem da QUERY
  // (`_authToken`) e nunca vale como JWT (URL vaza em log de proxy e histórico).
  const bearer =
    tokenFromHeaders(context.headers) ??
    bearerFromSubprotocol(context.headers.get('sec-websocket-protocol'));
  let identity = await identityFromToken(bearer);
  if (!identity.ok && bearer === undefined && getRoomAuth()?.allowDevAuth === true) {
    // Dev/test (flag explícita): token `dev:<userId>` na query, como os testes de sala legados.
    const dev = devReconnectUserId(context.token, process.env.NODE_ENV);
    if (dev !== undefined) identity = { ok: true, userId: dev };
  }
  if (!identity.ok && identity.reason === 'unavailable') {
    return new Response(null, { status: 503 });
  }
  if (!identity.ok) {
    // 401: o cliente deve renovar o access (`/auth/refresh`) e reconectar. Nunca registrar o token.
    log.warn('truco: reconexão recusada (sem identidade válida)', { room: roomId });
    return new Response(null, { status: 401 });
  }
  if (room.authorizeReconnect(sessionId, identity.userId)) return undefined;
  log.warn('truco: reconexão recusada (identidade não confere)', { room: roomId });
  return new Response(null, { status: 403 });
};
