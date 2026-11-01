import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { MAX_MESSAGE_BYTES } from '@trucaco/protocol';
import { buildHealth } from './index';
import { reconnectUpgradeGuard } from './rooms/reconnectGuard';
import { defineTrucoRoom } from './rooms/TrucoRoom';
import type { TrucoRoomConfig } from './rooms/TrucoRoom';

export interface CreateServerOptions {
  /** Porta TCP. 0 pede uma porta efêmera ao sistema (útil em testes). */
  port: number;
  /** Parâmetros do SERVIDOR para a sala `truco` (semente, prazos). Nunca vêm do cliente. */
  room?: TrucoRoomConfig;
  /** Limite por IP em `POST /matchmake/*` (criar/entrar). Só o servidor configura. */
  matchmakeLimit?: Partial<MatchmakeLimitConfig>;
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

/** Janela deslizante em memória: IP -> instantes das requisições recentes. */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Registra uma requisição; `false` se estourou o limite (a requisição NÃO é contada). */
  allow(key: string, now: number = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.sweep(now);
    return true;
  }

  private sweep(now: number): void {
    for (const [key, times] of this.hits) {
      if (times.every((t) => now - t >= this.windowMs)) this.hits.delete(key);
    }
  }
}

const LIMITED_PATH = '/__matchmake_rate_limited';
const limited = new WeakSet<IncomingMessage>();

function clientKey(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    const raw = Array.isArray(xff) ? xff.join(',') : xff;
    const last = raw?.split(',').at(-1)?.trim();
    if (last !== undefined && last !== '') return last;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

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
export function buildColyseusServer(room: TrucoRoomConfig = {}): Server {
  const colyseus = new Server({
    // Teto de tamanho por mensagem do cliente (o `ws` fecha a conexão acima disso).
    // `beforeUpgrade`: o core 0.18 não reautentica na reconexão; o guard exige o `userId` do assento.
    transport: new WebSocketTransport({
      maxPayload: MAX_MESSAGE_BYTES,
      beforeUpgrade: reconnectUpgradeGuard,
    }),
    express: (app) => {
      app.get('/health', (_req, res) => {
        res.json(buildHealth());
      });
      app.post(LIMITED_PATH, (req, res, next) => {
        if (!limited.has(req)) {
          next();
          return;
        }
        res.setHeader('Retry-After', '60');
        res.status(429).json({ error: 'RATE_LIMITED' });
      });
    },
    // Os sinais são tratados por quem chama (main.ts), não pelo Colyseus.
    gracefullyShutdown: false,
    greet: false,
  });
  defineTrucoRoom(colyseus, room);
  return colyseus;
}

/** Sobe Colyseus (WebSocketTransport + express) com `GET /health` e a sala `truco`. */
export async function createServer({
  port,
  room,
  matchmakeLimit,
}: CreateServerOptions): Promise<RunningServer> {
  const colyseus = buildColyseusServer(room);
  const limit = { ...DEFAULT_MATCHMAKE_LIMIT, ...matchmakeLimit };
  // O callback roda logo após o Colyseus registrar o listener dele; o nosso entra à frente.
  await colyseus.listen(port, undefined, undefined, () => attachMatchmakeLimit(colyseus, limit));

  const address = colyseus.transport.server?.address();
  const boundPort =
    address !== null && typeof address === 'object' ? (address as AddressInfo).port : port;

  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closing ??= colyseus.gracefullyShutdown(false);
    return closing;
  };

  return { port: boundPort, colyseus, close };
}
