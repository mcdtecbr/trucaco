import { randomInt } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server, ServerError, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { MAX_MESSAGE_BYTES, WS_BEARER_PROTOCOL } from '@trucaco/protocol';
import type { AuthService } from './auth/authService';
import { DEFAULT_LIMITS, type RestLimits } from './auth/config';
import type { AuthContext } from '@colyseus/core';
import type { MatchRepository, ProgressionRepository, UserRepository } from './db/types';
import { installBaseMiddleware, mountFallbacks, mountRest } from './http/rest';
import { mountLobbyRoutes } from './http/lobbyRoutes';
import {
  DEFAULT_LOBBY_CONFIG,
  GRANT_KEY,
  GatewayAuthError,
  Lobby,
  configureLobby,
  getLobby,
} from './lobby/lobby';
import type { LobbyConfig, TableGateway } from './lobby/lobby';
import { buildHealth } from './index';
import { SlidingWindowLimiter, clientKey, normalizeIp } from './rateLimit';
import { reconnectUpgradeGuard } from './rooms/reconnectGuard';
import { configureRoomAuth, identityFromToken, tokenFromHeaders } from './rooms/roomAuth';
import { TRUCO_ROOM_NAME, TrucoRoom, defineTrucoRoom } from './rooms/TrucoRoom';
import type { TrucoRoomConfig } from './rooms/TrucoRoom';

export { SlidingWindowLimiter };

/** Dependências de auth/REST. Sem `auth`+`users` não há rotas `/auth` nem `/me` e nenhuma entrada em sala. */
export interface ServerDeps {
  readonly auth?: AuthService;
  readonly users?: UserRepository;
  /** Origens CORS permitidas (lista exata). Vazio = nenhuma. */
  readonly corsOrigins?: readonly string[];
  readonly limits?: Partial<RestLimits>;
  readonly trustProxy?: boolean;
  /**
   * Aceita `devAuth` (userId/apelido do payload e token `dev:<id>`). SÓ com `NODE_ENV`
   * development/test, senão lança. Nunca ligado por padrão.
   */
  readonly allowDevAuth?: boolean;
  /** Onde gravar partidas terminadas/canceladas (2H). Ausente: nada é gravado. */
  readonly matches?: MatchRepository;
  /** Progressão (conquistas, missões, estatísticas): aplicada pela sala após gravar a partida e lida pelas rotas de perfil. */
  readonly progression?: ProgressionRepository;
  /** Ajustes do lobby (prazos da fila, limites). Só o servidor define. */
  readonly lobby?: Partial<Omit<LobbyConfig, 'guard'>> & { guard?: Partial<LobbyConfig['guard']> };
  /**
   * Libera `create`/`join`/`joinOrCreate` da sala `truco` direto pelo matchmaking HTTP. Padrão `false`:
   * mesas nascem só por `POST /tables` e pela fila (`/queue`), que aplicam código, limites e vínculo.
   * Só para testes/ferramentas internas.
   */
  readonly directMatchmake?: boolean;
}

export interface CreateServerOptions {
  /** Porta TCP. 0 pede uma porta efêmera ao sistema (útil em testes). */
  port: number;
  /** Parâmetros do SERVIDOR para a sala `truco` (semente, prazos). Nunca vêm do cliente. */
  room?: TrucoRoomConfig;
  /** Limite por IP em `POST /matchmake/*` (criar/entrar). Só o servidor configura. */
  matchmakeLimit?: Partial<MatchmakeLimitConfig>;
  /** Auth e REST (JWT, refresh, `/me`). */
  deps?: ServerDeps;
}

export interface MatchmakeLimitConfig {
  /** Requisições `POST /matchmake/*` por IP dentro da janela. */
  readonly max: number;
  /** Janela deslizante em ms. */
  readonly windowMs: number;
  /**
   * Atrás de proxy reverso o IP do socket é o do proxy. Com `true`, usa o ÚLTIMO item de
   * `X-Forwarded-For` (o que o proxy confiável acrescentou; os anteriores o cliente forja). Ligue só
   * se TODO tráfego passa por um proxy que define esse cabeçalho. Padrão: `false`.
   */
  readonly trustProxy: boolean;
}

export const DEFAULT_MATCHMAKE_LIMIT: MatchmakeLimitConfig = {
  max: 20,
  windowMs: 60_000,
  trustProxy: false,
};

const LIMITED_PATH = '/__matchmake_rate_limited';
const limited = new WeakSet<IncomingMessage>();

/**
 * Limite por IP no matchmaking. O `POST /matchmake/*` é atendido pelo roteador do Colyseus, ANTES do
 * express, então um middleware express não o enxerga. Por isso é um listener `request` PREPENDIDO
 * (roda antes do do Colyseus): se estourou, reescreve a URL para uma rota nossa, que responde 429
 * (o Colyseus então encaminha ao express, sem criar sala nem reservar assento).
 */
function attachMatchmakeLimit(colyseus: Server, cfg: MatchmakeLimitConfig): void {
  const server = colyseus.transport.server;
  if (server === undefined) return;
  const limiter = new SlidingWindowLimiter(cfg.max, cfg.windowMs);
  server.prependListener('request', (req: IncomingMessage) => {
    if (req.method !== 'POST' || req.url?.startsWith('/matchmake/') !== true) return;
    if (limiter.allow(clientKey(req, cfg.trustProxy))) return;
    limited.add(req);
    req.url = LIMITED_PATH;
  });
}

export interface RunningServer {
  /** Porta efetivamente em uso (resolvida quando `port` é 0). */
  port: number;
  /** Instância Colyseus, para registrar salas (`define`) nos próximos blocos. */
  colyseus: Server;
  /** Desligamento limpo: encerra matchmaker, WebSocket e HTTP. Idempotente. */
  close: () => Promise<void>;
}

/**
 * Monta (sem escutar) o Colyseus com `GET /health` e a sala `truco`. Separado de `createServer`
 * para os testes de sala (`@colyseus/testing` faz o `listen`).
 */
export function buildColyseusServer(room: TrucoRoomConfig = {}, deps: ServerDeps = {}): Server {
  // Auth das salas: registrada ANTES de qualquer entrada. Sem `auth`+`users` nada entra (fail-closed).
  configureRoomAuth({
    auth: deps.auth ?? null,
    users: deps.users ?? null,
    allowDevAuth: deps.allowDevAuth === true,
  });
  directMatchmake = deps.directMatchmake === true;
  trustProxyForJoin = deps.trustProxy === true;
  const users = deps.users;
  const lobby = new Lobby(
    tableGateway(),
    {
      ...DEFAULT_LOBBY_CONFIG,
      ...deps.lobby,
      guard: { ...DEFAULT_LOBBY_CONFIG.guard, ...deps.lobby?.guard },
    },
    Date.now,
    randomInt,
    users === undefined
      ? null
      : {
          relatedIds: async (userId) =>
            new Set([
              ...(await users.listBlockedIds(userId)),
              ...(await users.listBlockerIds(userId)),
            ]),
        },
  );
  configureLobby(lobby);
  restrictMatchmakeCors(deps.corsOrigins ?? []);
  guardMatchmakeReconnect();
  const colyseus = new Server({
    // Teto de tamanho por mensagem do cliente (o `ws` fecha a conexão acima disso).
    // `beforeUpgrade`: o core 0.18 não reautentica na reconexão; o guard valida o JWT e exige que o
    // `userId` seja o dono do assento. Subprotocolo `trucaco.bearer` (browsers não põem cabeçalhos).
    transport: new WebSocketTransport({
      maxPayload: MAX_MESSAGE_BYTES,
      beforeUpgrade: reconnectUpgradeGuard,
      handleProtocols: selectBearerProtocol,
    }),
    express: (app) => {
      installBaseMiddleware(app, {
        corsOrigins: deps.corsOrigins ?? [],
        hsts: process.env.NODE_ENV === 'production',
      });
      app.get('/health', (_req, res) => {
        res.json(buildHealth(deps.auth?.socialProviders() ?? []));
      });
      app.post(LIMITED_PATH, (req, res, next) => {
        if (!limited.has(req)) {
          next();
          return;
        }
        res.setHeader('Retry-After', '60');
        res.status(429).json({ error: { code: 'RATE_LIMITED' } });
      });
      if (deps.auth !== undefined && deps.users !== undefined) {
        mountRest(app, {
          auth: deps.auth,
          users: deps.users,
          ...(deps.matches !== undefined ? { matches: deps.matches } : {}),
          ...(deps.progression !== undefined ? { progression: deps.progression } : {}),
          limits: { ...DEFAULT_LIMITS, ...deps.limits },
          corsOrigins: deps.corsOrigins ?? [],
          trustProxy: deps.trustProxy === true,
        });
      }
      if (deps.auth !== undefined && deps.users !== undefined) {
        mountLobbyRoutes(app, {
          auth: deps.auth,
          users: deps.users,
          lobby,
          trustProxy: deps.trustProxy === true,
        });
      }
      mountFallbacks(app);
    },
    // Os sinais são tratados por quem chama (main.ts), não pelo Colyseus.
    gracefullyShutdown: false,
    greet: false,
  });
  defineTrucoRoom(colyseus, {
    ...room,
    ...(deps.matches !== undefined ? { matches: deps.matches } : {}),
    ...(deps.progression !== undefined ? { progression: deps.progression } : {}),
    ...(deps.users !== undefined ? { users: deps.users } : {}),
  });
  // O roteador do core só é registrado em `listen`; o nosso listener entra à frente dele depois disso.
  const listen = colyseus.listen.bind(colyseus);
  colyseus.listen = (port, hostname, backlog, listeningListener) =>
    listen(port, hostname, backlog, (err?: Error) => {
      attachPreflightGuard(colyseus, deps.corsOrigins ?? []);
      listeningListener?.(err as never);
    });
  return colyseus;
}

/**
 * CORS. O roteador do `@colyseus/core` é um listener `request` PREPENDIDO que responde a QUALQUER `OPTIONS`
 * (de qualquer caminho, inclusive `/me`) com 204 e `DEFAULT_CORS_HEADERS + getCorsHeaders()`, e põe esses
 * mesmos cabeçalhos em toda resposta, antes do express. Logo é essa camada que decide, não o middleware
 * express. Aqui: lista exata de origens; para origem da lista, os cabeçalhos completos (a API usa
 * `Authorization: Bearer`, sem cookies, então sem `Allow-Credentials`); para qualquer outra, NENHUM
 * cabeçalho `Access-Control-*` (só `Vary: Origin`). Nunca `*`, `null` nem origem refletida sem lista.
 * Estado do core, global ao processo (um servidor por processo).
 */
export const CORS_ALLOW_METHODS = 'GET, POST, PUT, DELETE, OPTIONS';
export const CORS_ALLOW_HEADERS = 'Authorization, Content-Type';

function restrictMatchmakeCors(origins: readonly string[]): void {
  const allowed = new Set(origins);
  const controller = matchMaker.controller as unknown as {
    DEFAULT_CORS_HEADERS: Record<string, string>;
    getCorsHeaders: (headers: Headers) => Record<string, string>;
  };
  // Nada por padrão: o core aplicaria isto também a origens fora da lista.
  controller.DEFAULT_CORS_HEADERS = {};
  controller.getCorsHeaders = (headers): Record<string, string> => {
    const origin = headers.get('origin');
    if (origin === null) return {};
    if (!allowed.has(origin)) return { Vary: 'Origin' };
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': CORS_ALLOW_METHODS,
      'Access-Control-Allow-Headers': CORS_ALLOW_HEADERS,
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    };
  };
}

/**
 * Preflight de origem fora da lista: o core responderia 204 (sem `Access-Control-*`, o navegador já
 * bloqueia). Pedimos 403 trocando o `writeHead` do core nessa resposta; o `end()` dele segue normal.
 * Listener prepended depois do `listen` (à frente do roteador do core).
 */
function attachPreflightGuard(colyseus: Server, origins: readonly string[]): void {
  const server = colyseus.transport.server;
  if (server === undefined) return;
  const allowed = new Set(origins);
  server.prependListener('request', (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'OPTIONS') return;
    const origin = req.headers.origin;
    if (typeof origin !== 'string' || allowed.has(origin)) return;
    const raw = res as unknown as { writeHead: (status: number, headers?: object) => unknown };
    const original = raw.writeHead.bind(res) as typeof raw.writeHead;
    raw.writeHead = (): unknown => original(403, { Vary: 'Origin' });
  });
}

/**
 * `POST /matchmake/reconnect/<roomId>` não passa identidade ao `checkReconnectionToken` da sala (só o
 * token). Aqui, antes do core, o JWT de acesso é validado (401 se ausente/expirado/inválido: o cliente
 * renova e tenta de novo) e, se a sala for local, o token de reconexão tem de ser de um assento do
 * mesmo `userId` (403). O upgrade do WebSocket repete a checagem (`reconnectUpgradeGuard`).
 */
function guardMatchmakeReconnect(): void {
  const controller = matchMaker.controller as unknown as {
    invokeMethod: (
      method: string,
      roomName: string,
      clientOptions: Record<string, unknown> | undefined,
      authOptions: { headers?: Headers } | undefined,
    ) => Promise<unknown>;
    [WRAPPED]?: boolean;
  };
  if (controller[WRAPPED] === true) return;
  controller[WRAPPED] = true;
  const original = controller.invokeMethod.bind(controller);
  controller.invokeMethod = async (method, roomName, clientOptions, authOptions) => {
    if (
      !directMatchmake &&
      roomName === TRUCO_ROOM_NAME &&
      (method === 'create' || method === 'join' || method === 'joinOrCreate')
    ) {
      // Identidade primeiro (sem credencial continua 401/503, como antes); depois, mesa só pelo lobby.
      const identity = await identityFromToken(tokenFromHeaders(authOptions?.headers));
      if (!identity.ok) {
        if (identity.reason === 'unavailable') throw new ServerError(503, 'SERVICE_UNAVAILABLE');
        throw new ServerError(401, 'UNAUTHORIZED');
      }
      throw new ServerError(403, 'USE_LOBBY');
    }
    if (method === 'joinById' && !directMatchmake) {
      // Entrar por roomId fora do lobby também conta falhas no freio de força bruta (usuário e, atrás de
      // proxy confiável, IP). Quem não se autentica segue para o `onAuth` do core (401/503).
      const identity = await identityFromToken(tokenFromHeaders(authOptions?.headers));
      const lobby = getLobby();
      if (identity.ok && lobby !== null) {
        const ip = trustedIp(authOptions?.headers);
        if (!lobby.allowDirectJoin(identity.userId, ip)) throw new ServerError(429, 'RATE_LIMITED');
        try {
          return await original(method, roomName, clientOptions, authOptions);
        } catch (err) {
          lobby.noteDirectJoinFailure(identity.userId, ip);
          throw err;
        }
      }
    }
    if (method === 'reconnect') {
      const identity = await identityFromToken(tokenFromHeaders(authOptions?.headers));
      if (!identity.ok) {
        if (identity.reason === 'unavailable') throw new ServerError(503, 'SERVICE_UNAVAILABLE');
        throw new ServerError(401, 'UNAUTHORIZED');
      }
      let target: unknown;
      try {
        target = matchMaker.getLocalRoomById(roomName);
      } catch {
        target = undefined;
      }
      const token = clientOptions?.['reconnectionToken'];
      if (
        target instanceof TrucoRoom &&
        (typeof token !== 'string' || !target.authorizeReconnectionToken(token, identity.userId))
      ) {
        throw new ServerError(403, 'FORBIDDEN');
      }
    }
    return original(method, roomName, clientOptions, authOptions);
  };
}

const WRAPPED = Symbol.for('trucaco.matchmakeReconnectGuard');

/** Estado do processo (um servidor por processo): lido pelo wrapper, que é instalado uma única vez. */
let directMatchmake = false;
let trustProxyForJoin = false;

/** IP do cliente só quando há proxy confiável (último item de `X-Forwarded-For`); senão `null`. */
function trustedIp(headers: Headers | undefined): string | null {
  if (!trustProxyForJoin) return null;
  const last = headers?.get('x-forwarded-for')?.split(',').at(-1)?.trim();
  return last === undefined || last === '' ? null : normalizeIp(last);
}

/** Costura do lobby com o matchmaker do Colyseus. */
function tableGateway(): TableGateway {
  return {
    async createRoom(options, grantToken) {
      const listing = await matchMaker.createRoom(TRUCO_ROOM_NAME, {
        ...options,
        [GRANT_KEY]: grantToken,
      });
      return listing.roomId;
    },
    async reserve(roomId, joinOptions, bearer) {
      const context = {
        headers: new Headers({ authorization: `Bearer ${bearer}` }),
      } as unknown as AuthContext;
      try {
        return await matchMaker.joinById(roomId, joinOptions, context);
      } catch (err) {
        const code = err instanceof ServerError ? err.code : undefined;
        if (code === 401) throw new GatewayAuthError(401);
        if (code === 503) throw new GatewayAuthError(503);
        throw err;
      }
    },
  };
}

/**
 * Escolha do subprotocolo WebSocket (defesa em profundidade). O `ws` seleciona por padrão o PRIMEIRO
 * oferecido e o ecoa no 101; com `[jwt, 'trucaco.bearer']` o JWT voltaria no cabeçalho de resposta (logs
 * de proxy). A recusa real (400) é do `reconnectUpgradeGuard`, ANTES do handshake (`handleProtocols`
 * devolvendo `false` só omite o cabeçalho, o `ws` ainda completa o 101). Aqui: só `trucaco.bearer` pode
 * ser selecionado, e só quando é o 1º item; o valor ofertado nunca é ecoado.
 */
export function selectBearerProtocol(protocols: Set<string>): string | false {
  const first = protocols.values().next().value;
  return first === WS_BEARER_PROTOCOL ? WS_BEARER_PROTOCOL : false;
}

/** Sobe Colyseus (WebSocketTransport + express) com `GET /health` e a sala `truco`. */
export async function createServer({
  port,
  room,
  matchmakeLimit,
  deps,
}: CreateServerOptions): Promise<RunningServer> {
  const colyseus = buildColyseusServer(room, deps);
  getLobby()?.start();
  const limit = { ...DEFAULT_MATCHMAKE_LIMIT, ...matchmakeLimit };
  // O callback roda logo após o Colyseus registrar o listener dele; o nosso entra à frente.
  await colyseus.listen(port, undefined, undefined, () => attachMatchmakeLimit(colyseus, limit));

  const address = colyseus.transport.server?.address();
  const boundPort =
    address !== null && typeof address === 'object' ? (address as AddressInfo).port : port;

  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    getLobby()?.stop();
    closing ??= colyseus.gracefullyShutdown(false);
    return closing;
  };

  return { port: boundPort, colyseus, close };
}
