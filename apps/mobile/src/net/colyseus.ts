/**
 * Cliente Colyseus do Trucaco e a solução do RISCO CRÍTICO do subprotocolo.
 *
 * Problema (lido em `@colyseus/sdk@0.18.9`, `src/transport/WebSocketTransport.ts`):
 * - navegador (`typeof document !== 'undefined'`): `new WebSocket(url, this.protocols)` e `protocols`
 *   nunca é preenchido pelo SDK, então o upgrade da RECONEXÃO vai sem JWT -> 401;
 * - Node/RN (`document` ausente): `new WebSocket(url, { headers, protocols })`. O Node (undici/`ws`)
 *   entende; o WebSocket do React Native 0.88 NÃO (`protocols` não-array vira `null` e `options` fica
 *   `undefined`), então também vai sem JWT -> 401.
 *
 * Solução: `BearerWebSocketTransport` substitui o transporte do `Connection` de cada `Room`
 * (via `BearerClient.createRoom`) e abre SEMPRE `new WebSocket(url, ['trucaco.bearer', jwt])`, a forma
 * que funciona nas três plataformas e que o servidor aceita (`trucaco.bearer` primeiro). O JWT é lido
 * no momento de cada (re)conexão, então as tentativas automáticas do SDK usam o access mais novo.
 *
 * Nunca: `client.auth.token` / `_authToken` (vai para a query e vaza em log de proxy), JWT na URL, log
 * de token, de Authorization ou de payload.
 */
import {
  Client,
  CloseCode,
  ErrorCode as MatchMakeCode,
  MatchMakeError,
  Room,
  ServerError,
} from '@colyseus/sdk';
import { WS_BEARER_PROTOCOL } from '@trucaco/protocol';
import type { ErrorCode, SeatReservation } from '@trucaco/protocol';
import { getServerUrl } from './config';
import { isApiError } from './api';
import { SessionRequiredError } from './session';
import type { Session } from './session';

// ---------------------------------------------------------------------------
// Transporte WebSocket com subprotocolo bearer
// ---------------------------------------------------------------------------

/** Subconjunto do `WebSocket` usado aqui (DOM, undici e React Native o satisfazem). */
export interface WebSocketLike {
  binaryType: string;
  readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: Uint8Array): void;
  close(code?: number, reason?: string): void;
}

/** Cria o socket. O segundo argumento é SEMPRE a lista de subprotocolos (nunca o objeto `{headers}`). */
export type WebSocketFactory = (url: string, protocols: string[]) => WebSocketLike;

export const defaultWebSocketFactory: WebSocketFactory = (url, protocols) => {
  const Ctor = (
    globalThis as unknown as {
      WebSocket?: new (url: string, protocols: string[]) => WebSocketLike;
    }
  ).WebSocket;
  if (Ctor === undefined) throw new Error('WebSocket indisponível neste ambiente');
  return new Ctor(url, protocols);
};

interface TransportEvents {
  onopen?: ((ev: unknown) => unknown) | null;
  onmessage?: ((ev: unknown) => unknown) | null;
  onclose?: ((ev: unknown) => unknown) | null;
  onerror?: ((ev: unknown) => unknown) | null;
}

const WS_OPEN = 1;

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/**
 * A reserva vem do servidor, mas vira URL de WebSocket que recebe o JWT: só aceitamos ids simples e, se
 * houver `publicAddress`, o MESMO host do servidor configurado (senão o JWT iria para terceiros).
 */
export function isSafeReservation(reservation: SeatReservation, serverUrl: string): boolean {
  const ids = [reservation.name, reservation.sessionId, reservation.roomId];
  if (reservation.processId !== undefined) ids.push(reservation.processId);
  if (!ids.every((id) => typeof id === 'string' && SAFE_ID.test(id))) return false;
  const token = reservation.reconnectionToken;
  if (token !== undefined && !/^[A-Za-z0-9_-]+(:[A-Za-z0-9_-]+)?$/.test(token)) return false;
  const addr = reservation.publicAddress;
  if (addr !== undefined) {
    if (typeof addr !== 'string' || /[/@\\?#\s]/.test(addr)) return false;
    if (hostnameOf(`http://${addr}`) !== hostnameOf(serverUrl)) return false;
  }
  return true;
}

/** Implementa a mesma interface do transporte do SDK (`ITransport`) com o JWT no subprotocolo. */
export class BearerWebSocketTransport {
  ws: WebSocketLike | undefined;

  constructor(
    private readonly events: TransportEvents,
    private readonly getAccessToken: () => string | null,
    private readonly factory: WebSocketFactory = defaultWebSocketFactory,
    /** Defesa em profundidade: se definido, o JWT só vai para um socket deste host. */
    private readonly allowedHostname?: string,
  ) {}

  send(data: Uint8Array): void {
    this.ws?.send(data);
  }

  /** O WebSocket não tem canal não confiável: o SDK usa o confiável (mesmo comportamento dele). */
  sendUnreliable(data: Uint8Array): void {
    this.send(data);
  }

  /** O 2º argumento (cabeçalhos do SDK) é ignorado de propósito: o JWT segue só pelo subprotocolo. */
  connect(url: string): void {
    if (this.allowedHostname !== undefined && hostnameOf(url) !== this.allowedHostname) {
      throw new Error('HOST_NOT_ALLOWED'); // nunca entrega o JWT a outro host
    }
    const jwt = this.getAccessToken();
    if (jwt === null) throw new Error('SESSION_REQUIRED');
    const ws = this.factory(url, [WS_BEARER_PROTOCOL, jwt]);
    this.ws = ws;
    let opened = false;
    let closed = false;

    const onclose = (event: unknown): void => {
      if (closed) return;
      closed = true;
      this.events.onclose?.(event);
    };

    ws.binaryType = 'arraybuffer';
    ws.onopen = (event) => {
      opened = true;
      this.events.onopen?.(event);
    };
    ws.onmessage = (event) => {
      this.events.onmessage?.(event);
    };
    ws.onclose = onclose;
    ws.onerror = (event) => {
      if (opened) {
        this.events.onerror?.(event);
        return;
      }
      // Socket que nunca abriu (upgrade recusado, 401, rede). NÃO repassa o evento cru: o SDK rejeita
      // a entrada no primeiro `onerror` com `ServerError(undefined)` e o `classifyFailure` nunca veria o
      // 1006. O fechamento (real, ou sintetizado como 1006 se o runtime não emitir) leva o código.
      ws.onerror = null;
      setTimeout(() => {
        if (ws.onclose === onclose) {
          onclose({ code: CloseCode.ABNORMAL_CLOSURE, reason: '' });
        }
      }, 0);
    };
  }

  close(code?: number, reason?: string): void {
    const ws = this.ws;
    if (ws === undefined) return;
    try {
      if (code === CloseCode.MAY_TRY_RECONNECT && this.events.onclose) {
        ws.onclose = null;
        this.events.onclose({ code, reason });
      }
    } finally {
      ws.close(code, reason);
    }
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WS_OPEN;
  }
}

// ---------------------------------------------------------------------------
// Client/Room do SDK com o transporte acima
// ---------------------------------------------------------------------------

interface Wiring {
  getAccessToken: () => string | null;
  factory: WebSocketFactory;
  allowedHostname?: string;
  /** Avisa uma queda (o SDK vai tentar reconectar sozinho): hora de garantir um access fresco. */
  onDrop: () => void;
}

type RootSchema<T> = ConstructorParameters<typeof Room<unknown, T>>[1];

/**
 * `Room.connection` é um campo de instância criado dentro de `Room.connect()`. Um acessor definido
 * aqui troca o transporte do `Connection` recém-criado ANTES de ele conectar.
 */
class BearerRoom<T> extends Room<unknown, T> {
  constructor(name: string, rootSchema: RootSchema<T>, wiring: Wiring) {
    super(name, rootSchema);
    let current: Room['connection'] | undefined;
    Object.defineProperty(this, 'connection', {
      configurable: true,
      enumerable: true,
      get: () => current,
      set: (conn: Room['connection']) => {
        conn.transport = new BearerWebSocketTransport(
          conn.events,
          wiring.getAccessToken,
          wiring.factory,
          wiring.allowedHostname,
        );
        current = conn;
      },
    });
    this.onDrop(() => wiring.onDrop());
  }
}

class BearerClient extends Client {
  constructor(
    url: string,
    headers: Record<string, string>,
    private readonly wiring: Wiring,
  ) {
    super(url, { headers });
    // `new Client` lê `localStorage['colyseus-auth-token']` (Auth) e `buildEndpoint` poria esse valor na
    // query (`_authToken`), vazando em log de proxy. O JWT do Trucaco vai só no subprotocolo/cabeçalho:
    // `authToken` fica fixo em `undefined`, inclusive contra a leitura assíncrona do storage.
    Object.defineProperty(this.http, 'authToken', {
      configurable: true,
      enumerable: true,
      get: () => undefined,
      set: () => undefined,
    });
  }

  protected override buildEndpoint(seatReservation: never, options: Record<string, unknown> = {}) {
    delete options['_authToken'];
    return super.buildEndpoint(seatReservation, options);
  }

  protected override createRoom<T>(roomName: string, rootSchema?: RootSchema<T>) {
    return new BearerRoom<T>(roomName, rootSchema, this.wiring) as unknown as Room<unknown, T>;
  }
}

// ---------------------------------------------------------------------------
// API do cliente de jogo
// ---------------------------------------------------------------------------

export type GameClientErrorCode =
  | Extract<ErrorCode, 'ROOM_NOT_FOUND' | 'TOKEN_EXPIRED'>
  /** Sem sessão local (nunca iniciou ou fez logout): a UI manda para o início. */
  | 'SESSION_REQUIRED'
  | 'UNAVAILABLE'
  | 'JOIN_FAILED';

/** Erro de entrada/reconexão. `cause` guarda o original do SDK (sem token). */
export class GameClientError extends Error {
  readonly code: GameClientErrorCode;
  constructor(code: GameClientErrorCode, cause?: unknown) {
    super(`GAME_CLIENT ${code}`);
    this.name = 'GameClientError';
    this.code = code;
    this.cause = cause;
  }
}

export interface GameClient {
  readonly client: Client;
  /** Consome a reserva do lobby (objeto repassado intacto). */
  joinWithReservation(reservation: SeatReservation): Promise<Room>;
  /** Reconecta com `room.reconnectionToken`. 401 -> refresh e 1 nova tentativa; 403/404 -> ROOM_NOT_FOUND. */
  reconnect(source: string | { reconnectionToken: string }): Promise<Room>;
  dispose(): void;
}

export interface GameClientOptions {
  serverUrl?: string;
  /** Injetável em testes. */
  webSocketFactory?: WebSocketFactory;
}

type FailureKind = 'unauthorized' | 'gone' | 'upgrade' | 'other';

function numericCode(e: unknown): number | undefined {
  if (e instanceof ServerError || e instanceof MatchMakeError) return e.code;
  return undefined;
}

/** Classifica falha de `reconnect` do SDK pelo código (HTTP no matchmake; 1006 no upgrade do WS). */
export function classifyFailure(e: unknown): FailureKind {
  const code = numericCode(e);
  if (code === 401) return 'unauthorized';
  // 403/404 do servidor; 522 (sala descartada) e 524 (token expirado) do matchmaker do Colyseus.
  if (
    code === 403 ||
    code === 404 ||
    code === MatchMakeCode.MATCHMAKE_INVALID_ROOM_ID ||
    code === MatchMakeCode.MATCHMAKE_EXPIRED
  ) {
    return 'gone';
  }
  if (code === CloseCode.ABNORMAL_CLOSURE) return 'upgrade';
  return 'other';
}

export function createGameClient(session: Session, options: GameClientOptions = {}): GameClient {
  const serverUrl = options.serverUrl ?? getServerUrl();
  const serverHost = hostnameOf(serverUrl);
  const headers: Record<string, string> = {};
  const syncHeaders = (token: string | null): void => {
    if (token === null) delete headers['authorization'];
    else headers['authorization'] = `Bearer ${token}`;
  };
  syncHeaders(session.getAccessToken());

  const wiring: Wiring = {
    getAccessToken: () => session.getAccessToken(),
    factory: options.webSocketFactory ?? defaultWebSocketFactory,
    ...(serverHost !== null ? { allowedHostname: serverHost } : {}),
    onDrop: () => {
      // Em segundo plano: a próxima tentativa do SDK lê o access renovado. Falha (503) não é fatal.
      session.ensureAccessToken().catch(() => undefined);
    },
  };
  const client = new BearerClient(serverUrl, headers, wiring);
  // O servidor não envia Access-Control-Allow-Credentials: o padrão do SDK ("include") quebraria o CORS.
  client.http.options.credentials = 'omit';
  const unsubscribe = session.onAccessTokenChange(syncHeaders);

  /** Traduz falhas de sessão para o vocabulário da UI; indisponibilidade (rede/503) sobe como `ApiError`. */
  async function withSession(renew: () => Promise<string>): Promise<void> {
    try {
      await renew();
    } catch (e) {
      if (e instanceof SessionRequiredError) throw new GameClientError('SESSION_REQUIRED', e);
      if (isApiError(e) && e.status === 401) throw new GameClientError('TOKEN_EXPIRED', e);
      throw e;
    }
  }

  async function joinWithReservation(reservation: SeatReservation): Promise<Room> {
    // Antes de qualquer rede ou token: reserva adulterada nunca chega ao SDK.
    if (!isSafeReservation(reservation, serverUrl)) throw new GameClientError('JOIN_FAILED');
    await withSession(() => session.ensureAccessToken());
    try {
      return await client.consumeSeatReservation(
        reservation as unknown as Parameters<Client['consumeSeatReservation']>[0],
      );
    } catch (e) {
      throw new GameClientError('JOIN_FAILED', e);
    }
  }

  async function reconnect(source: string | { reconnectionToken: string }): Promise<Room> {
    const token = typeof source === 'string' ? source : source.reconnectionToken;
    if (!/^[^:]+:[^:]+$/.test(token)) throw new GameClientError('ROOM_NOT_FOUND');
    await withSession(() => session.ensureAccessToken());
    let refreshed = false;
    for (;;) {
      try {
        return await client.reconnect(token);
      } catch (e) {
        const kind = classifyFailure(e);
        if (kind === 'gone') throw new GameClientError('ROOM_NOT_FOUND', e);
        if ((kind === 'unauthorized' || kind === 'upgrade') && !refreshed) {
          refreshed = true;
          await withSession(() => session.forceRefresh()); // 503/rede sobe como ApiError: sessão intacta
          continue;
        }
        throw new GameClientError(kind === 'unauthorized' ? 'TOKEN_EXPIRED' : 'UNAVAILABLE', e);
      }
    }
  }

  return { client, joinWithReservation, reconnect, dispose: unsubscribe };
}

// ---------------------------------------------------------------------------
// Eventos com `seq`: salto = desincronizado
// ---------------------------------------------------------------------------

export interface EventEnvelope {
  readonly seq: number;
  readonly at: number;
  readonly event: unknown;
}

export interface EventTrackerHandlers {
  onEvent(envelope: EventEnvelope): void;
  /** Chamado UMA vez por salto, até `acknowledgeResync()`. Reconstrua pelo estado; o log não vale. */
  onDesync(info: { expected: number; got: number }): void;
}

export interface EventTracker {
  lastSeq(): number | null;
  isDesynced(): boolean;
  /** Chame depois de reconstruir a projeção a partir de `room.state`. */
  acknowledgeResync(): void;
}

/**
 * Registra o único handler de `event` da sala. `afterSeq` = último `seq` visto numa sala anterior
 * (reconexão manual): o replay do servidor só reenvia `seq` maiores.
 */
export function trackEvents(
  room: { onMessage(type: string, cb: (payload: unknown) => void): unknown },
  handlers: EventTrackerHandlers,
  afterSeq: number | null = null,
): EventTracker {
  let last = afterSeq;
  let desynced = false;
  room.onMessage('event', (raw: unknown) => {
    if (typeof raw !== 'object' || raw === null) return;
    const env = raw as Record<string, unknown>;
    const seq = env['seq'];
    if (typeof seq !== 'number' || !Number.isInteger(seq)) return;
    if (last !== null && seq <= last) return; // repetido (sobreposição de replay)
    if (last !== null && seq > last + 1 && !desynced) {
      desynced = true;
      handlers.onDesync({ expected: last + 1, got: seq });
    }
    last = seq;
    handlers.onEvent({
      seq,
      at: typeof env['at'] === 'number' ? env['at'] : 0,
      event: env['event'],
    });
  });
  return {
    lastSeq: () => last,
    isDesynced: () => desynced,
    acknowledgeResync: () => {
      desynced = false;
    },
  };
}
