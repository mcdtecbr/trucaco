import type { AddressInfo } from 'node:net';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { buildHealth } from './index';

export interface CreateServerOptions {
  /** Porta TCP. 0 pede uma porta efêmera ao sistema (útil em testes). */
  port: number;
}

export interface RunningServer {
  /** Porta efetivamente em uso (resolvida quando `port` é 0). */
  port: number;
  /** Instância Colyseus, para registrar salas (`define`) nos próximos blocos. */
  colyseus: Server;
  /** Desligamento limpo: encerra matchmaker, WebSocket e HTTP. Idempotente. */
  close: () => Promise<void>;
}

/** Sobe Colyseus (WebSocketTransport + express) com `GET /health`. Sem salas ainda. */
export async function createServer({ port }: CreateServerOptions): Promise<RunningServer> {
  const colyseus = new Server({
    transport: new WebSocketTransport(),
    express: (app) => {
      app.get('/health', (_req, res) => {
        res.json(buildHealth());
      });
    },
    // Os sinais são tratados por quem chama (main.ts), não pelo Colyseus.
    gracefullyShutdown: false,
    greet: false,
  });

  await colyseus.listen(port);

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
