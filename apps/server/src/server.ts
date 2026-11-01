import type { AddressInfo } from 'node:net';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { MAX_MESSAGE_BYTES } from '@trucaco/protocol';
import { buildHealth } from './index';
import { defineTrucoRoom } from './rooms/TrucoRoom';
import type { TrucoRoomConfig } from './rooms/TrucoRoom';

export interface CreateServerOptions {
  /** Porta TCP. 0 pede uma porta efêmera ao sistema (útil em testes). */
  port: number;
  /** Parâmetros do SERVIDOR para a sala `truco` (semente, prazos). Nunca vêm do cliente. */
  room?: TrucoRoomConfig;
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
    transport: new WebSocketTransport({ maxPayload: MAX_MESSAGE_BYTES }),
    express: (app) => {
      app.get('/health', (_req, res) => {
        res.json(buildHealth());
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
export async function createServer({ port, room }: CreateServerOptions): Promise<RunningServer> {
  const colyseus = buildColyseusServer(room);
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
