/**
 * Handshake de RECONEXÃO como um cliente de navegador/RN o faz: sem cabeçalhos, só o subprotocolo
 * `['trucaco.bearer', <jwt>]`. Usa `ws` (resolvido a partir do transporte do Colyseus, sem dependência
 * nova) e o `WebSocket` global do Node 22 (semântica de navegador: nenhum cabeçalho customizado).
 * Prova: dono aceito; sem protocolo 401; JWT de outro 403; o servidor seleciona (e ecoa) exatamente
 * `trucaco.bearer`, nunca o JWT. UM `Server` por arquivo.
 */
import { createRequire } from 'node:module';
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Room } from '@colyseus/core';
import { ColyseusTestServer, boot } from '@colyseus/testing';
import { WS_BEARER_PROTOCOL } from '@trucaco/protocol';
import type { RoomOptions } from '@trucaco/protocol';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../auth/authService';
import type { AuthConfig } from '../auth/config';
import { MemoryTokenStore } from '../auth/tokenStore';
import { createMemoryRepositories } from '../db';
import { buildColyseusServer } from '../server';
import type { TrucoRoom, TrucoRoomConfig } from './TrucoRoom';

const CFG: AuthConfig = {
  secret: new TextEncoder().encode('segredo-de-teste-com-32-bytes-ou-mais!!'),
  issuer: 'trucaco',
  audience: 'trucaco-api',
  accessTtlSec: 900,
  refreshTtlSec: 3600,
  refreshReuseGraceSec: 20,
  refreshFamilyMaxSec: 7_776_000,
  clockToleranceSec: 5,
};
const ROOM: TrucoRoomConfig = {
  patchRateMs: 5,
  actionMinIntervalMs: 0,
  finishDelayMs: 60_000,
  maxMessagesPerSecond: 10_000,
  rngSeed: 5,
  reconnectSeconds: 5,
  botThinkMs: 20,
  turnTimeoutMs: 60_000,
};
const OPTS: RoomOptions = {
  variant: 'paulista',
  format: 'single',
  ironHand: true,
  visibility: 'private',
};

interface WsLike {
  protocol: string;
  close(): void;
  terminate(): void;
  on(event: string, cb: (...args: unknown[]) => void): void;
}
type WsCtor = new (url: string, protocols: string[]) => WsLike;
const WS = createRequire(createRequire(import.meta.url).resolve('@colyseus/ws-transport'))(
  'ws',
) as WsCtor;

type Outcome =
  | { kind: 'open'; selected: string; echoed: string | undefined }
  | { kind: 'rejected'; status: number };

/** Abre o WS com `ws` e devolve o desfecho do upgrade (status HTTP quando recusado). */
function connectWs(url: string, protocols: string[]): Promise<Outcome> {
  return new Promise((resolve, reject) => {
    const ws = new WS(url, protocols);
    let echoed: string | undefined;
    ws.on('upgrade', (...a) => {
      const h = (a[0] as IncomingMessage).headers['sec-websocket-protocol'];
      echoed = Array.isArray(h) ? h.join(',') : h;
    });
    ws.on('open', () => {
      resolve({ kind: 'open', selected: ws.protocol, echoed });
      ws.close();
    });
    ws.on('unexpected-response', (...a) => {
      resolve({ kind: 'rejected', status: (a[1] as IncomingMessage).statusCode ?? 0 });
      ws.terminate();
    });
    ws.on('error', (...a) => reject(a[0] as Error));
  });
}

const repos = createMemoryRepositories();
const auth = new AuthService(repos.users, new MemoryTokenStore(), CFG);
let t: ColyseusTestServer;

beforeAll(async () => {
  t = await boot(
    buildColyseusServer(ROOM, { auth, users: repos.users, directMatchmake: true }),
    2585,
  );
});
afterEach(async () => {
  await t.cleanup();
});
afterAll(async () => {
  await t.shutdown();
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, what: string, ms = 4000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return;
    await sleep(3);
  }
  throw new Error(`timeout esperando: ${what}`);
}

type Session = Awaited<ReturnType<AuthService['createGuest']>>;
type SdkRoom = Awaited<ReturnType<ColyseusTestServer['connectTo']>>;
type SdkHttp = { options: { headers?: Record<string, string> } };
const status = (server: TrucoRoom, seat: number): string =>
  (server.state.players[seat] as { status: string }).status;
const port = (): number =>
  ((t.server.transport.server as { address(): unknown }).address() as AddressInfo).port;

/** Mesa com 4 donos e um assento derrubado; devolve a URL de reconexão (reserva feita com o JWT do dono). */
async function droppedSeat(seat = 0) {
  const server = await t.createRoom<TrucoRoom>('truco', OPTS);
  const sessions: Session[] = [];
  const rooms: SdkRoom[] = [];
  const http = t.sdk.http as unknown as SdkHttp;
  for (let i = 0; i < 4; i++) {
    const s = await auth.createGuest();
    sessions.push(s);
    http.options.headers = { authorization: `Bearer ${s.pair.accessToken}` };
    rooms.push(await t.connectTo(server as unknown as Room, {}));
  }
  http.options.headers = {};
  await until(() => server.series !== null, 'série');
  const dropped = rooms[seat] as SdkRoom;
  dropped.reconnection.enabled = false;
  dropped.connection.close();
  await until(() => status(server, seat) === 'away', 'assento away');
  const [roomId, rtoken] = dropped.reconnectionToken.split(':') as [string, string];
  const res = await fetch(`http://127.0.0.1:${port()}/matchmake/reconnect/${roomId}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${(sessions[seat] as Session).pair.accessToken}`,
    },
    body: JSON.stringify({ reconnectionToken: rtoken }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { sessionId: string; processId: string };
  const url = `ws://127.0.0.1:${port()}/${body.processId}/${server.roomId}?sessionId=${body.sessionId}&reconnectionToken=${rtoken}`;
  return { server, sessions, url, seat };
}

describe('reconexão pelo subprotocolo, como no navegador (ws)', () => {
  it('dono: aceito, e o 101 seleciona exatamente `trucaco.bearer` (o JWT nunca é ecoado)', async () => {
    const { sessions, url, seat } = await droppedSeat();
    const jwt = (sessions[seat] as Session).pair.accessToken;
    const out = await connectWs(url, [WS_BEARER_PROTOCOL, jwt]);
    expect(out).toEqual({ kind: 'open', selected: WS_BEARER_PROTOCOL, echoed: WS_BEARER_PROTOCOL });
    expect(JSON.stringify(out)).not.toContain(jwt);
  });

  it('sem subprotocolo: 401; JWT lixo: 401; JWT de outro usuário: 403; query _authToken não vale', async () => {
    const { sessions, url, seat } = await droppedSeat();
    expect(await connectWs(url, [])).toEqual({ kind: 'rejected', status: 401 });
    expect(await connectWs(url, [WS_BEARER_PROTOCOL])).toEqual({ kind: 'rejected', status: 401 });
    expect(await connectWs(url, [WS_BEARER_PROTOCOL, 'lixo'])).toEqual({
      kind: 'rejected',
      status: 401,
    });
    const other = (sessions[(seat + 1) % 4] as Session).pair.accessToken;
    expect(await connectWs(url, [WS_BEARER_PROTOCOL, other])).toEqual({
      kind: 'rejected',
      status: 403,
    });
    const own = (sessions[seat] as Session).pair.accessToken;
    expect(await connectWs(`${url}&_authToken=${own}`, [])).toEqual({
      kind: 'rejected',
      status: 401,
    });
    // As recusas não gastaram a reserva: o dono ainda entra.
    expect((await connectWs(url, [WS_BEARER_PROTOCOL, own])).kind).toBe('open');
  });

  it('ordem importa: oferecer [jwt, trucaco.bearer] é recusado (400), nunca ecoa o JWT', async () => {
    const { sessions, url, seat } = await droppedSeat();
    const jwt = (sessions[seat] as Session).pair.accessToken;
    const out = await connectWs(url, [jwt, WS_BEARER_PROTOCOL]);
    // Documenta o comportamento real para o cliente: a ordem correta é SEMPRE ['trucaco.bearer', jwt].
    // Se o JWT vier antes, o upgrade é recusado (400) ANTES do handshake: o JWT nunca é ecoado.
    expect(out).toEqual({ kind: 'rejected', status: 400 });
  });

  it('join comum (sem reconexão): [jwt, trucaco.bearer] é recusado (400) e o JWT nunca é ecoado; [trucaco.bearer, jwt] seleciona trucaco.bearer', async () => {
    const { sessions, url, seat } = await droppedSeat();
    const jwt = (sessions[seat] as Session).pair.accessToken;
    // Sem `reconnectionToken` o guard deixa passar; só `handleProtocols` protege a escolha do subprotocolo.
    const plain = url
      .replace(/&reconnectionToken=[^&]*/, '')
      .replace(/sessionId=[^&]*/, 'sessionId=x');
    expect(await connectWs(plain, [jwt, WS_BEARER_PROTOCOL])).toEqual({
      kind: 'rejected',
      status: 400,
    });
    expect(await connectWs(plain, ['outro', WS_BEARER_PROTOCOL])).toEqual({
      kind: 'rejected',
      status: 400,
    });
    const ok = await connectWs(plain, [WS_BEARER_PROTOCOL, jwt]);
    expect(ok).toEqual({ kind: 'open', selected: WS_BEARER_PROTOCOL, echoed: WS_BEARER_PROTOCOL });
    expect(JSON.stringify(ok)).not.toContain(jwt);
  });

  it('o dono realmente volta ao assento (estado connected) após o upgrade por subprotocolo', async () => {
    const { server, sessions, url, seat } = await droppedSeat(1);
    const jwt = (sessions[seat] as Session).pair.accessToken;
    const g = globalThis as unknown as {
      WebSocket: new (
        url: string,
        protocols: string[],
      ) => {
        protocol: string;
        binaryType: string;
        onopen: (() => void) | null;
        onclose: (() => void) | null;
        close(): void;
      };
    };
    // `WebSocket` do Node 22 (undici): API de navegador, sem como passar cabeçalhos.
    const ws = new g.WebSocket(url, [WS_BEARER_PROTOCOL, jwt]);
    ws.binaryType = 'arraybuffer';
    const opened = await new Promise<string>((resolve, reject) => {
      ws.onopen = () => resolve(ws.protocol);
      ws.onclose = () => reject(new Error('fechou antes de abrir'));
    });
    expect(opened).toBe(WS_BEARER_PROTOCOL);
    await until(() => status(server, seat) === 'connected', 'assento voltou');
    ws.onclose = null;
    ws.close();
  });
});
