import { CloseCode, MatchMakeError, ServerError } from '@colyseus/sdk';
import { WS_BEARER_PROTOCOL } from '@trucaco/protocol';
import type { SeatReservation } from '@trucaco/protocol';
import { describe, expect, it, vi } from 'vitest';
import {
  BearerWebSocketTransport,
  GameClientError,
  classifyFailure,
  createGameClient,
  defaultWebSocketFactory,
  trackEvents,
} from './colyseus';
import type { WebSocketFactory, WebSocketLike } from './colyseus';
import { ApiError } from './api';
import { SessionRequiredError } from './session';
import type { Session } from './session';

const JWT = 'eyJhbGciOi.PAYLOAD-SECRETO.assinatura';

class FakeSocket implements WebSocketLike {
  binaryType = 'blob';
  readyState = 0;
  onopen: WebSocketLike['onopen'] = null;
  onmessage: WebSocketLike['onmessage'] = null;
  onclose: WebSocketLike['onclose'] = null;
  onerror: WebSocketLike['onerror'] = null;
  sent: Uint8Array[] = [];
  closedWith: [number | undefined, string | undefined] | null = null;
  constructor(
    readonly url: string,
    readonly protocols: unknown[],
  ) {}
  send(d: Uint8Array) {
    this.sent.push(d);
  }
  close(code?: number, reason?: string) {
    this.closedWith = [code, reason];
  }
}

function recordingFactory() {
  const sockets: FakeSocket[] = [];
  const factory: WebSocketFactory = (url, protocols) => {
    const s = new FakeSocket(url, protocols);
    sockets.push(s);
    return s;
  };
  return { sockets, factory };
}

function fakeSession(token: string | null = JWT) {
  const state = { token, listeners: new Set<(t: string | null) => void>() };
  const session = {
    getAccessToken: () => state.token,
    onAccessTokenChange: (l: (t: string | null) => void) => {
      state.listeners.add(l);
      return () => state.listeners.delete(l);
    },
    ensureAccessToken: vi.fn(() => Promise.resolve(state.token ?? 'x')),
    forceRefresh: vi.fn(() => Promise.resolve('novo')),
  };
  const setToken = (t: string | null) => {
    state.token = t;
    state.listeners.forEach((l) => l(t));
  };
  return { session: session as unknown as Session, raw: session, setToken, state };
}

describe('BearerWebSocketTransport (shim)', () => {
  it("abre o socket com exatamente ['trucaco.bearer', jwt] e o JWT nunca vai na URL", () => {
    const { sockets, factory } = recordingFactory();
    const t = new BearerWebSocketTransport({}, () => JWT, factory);
    t.connect('ws://host:1/p/r?sessionId=s&reconnectionToken=tok');
    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.protocols).toEqual([WS_BEARER_PROTOCOL, JWT]);
    expect(sockets[0]?.protocols[0]).toBe('trucaco.bearer'); // a ordem importa para o servidor
    expect(sockets[0]?.url).not.toContain(JWT);
    expect(sockets[0]?.url).not.toContain('_authToken');
  });

  it('lê o JWT a cada conexão (reconexão usa o token renovado)', () => {
    const { sockets, factory } = recordingFactory();
    let jwt = 'velho';
    const t = new BearerWebSocketTransport({}, () => jwt, factory);
    t.connect('ws://h/a');
    jwt = 'novo';
    t.connect('ws://h/a');
    expect(sockets.map((s) => s.protocols[1])).toEqual(['velho', 'novo']);
  });

  it('sem sessão lança SESSION_REQUIRED e não abre socket', () => {
    const { sockets, factory } = recordingFactory();
    const t = new BearerWebSocketTransport({}, () => null, factory);
    expect(() => t.connect('ws://h/a')).toThrow('SESSION_REQUIRED');
    expect(sockets).toHaveLength(0);
  });

  it('encaminha eventos, envia dados e reporta isOpen', () => {
    const { sockets, factory } = recordingFactory();
    const log: string[] = [];
    const t = new BearerWebSocketTransport(
      {
        onopen: () => log.push('open'),
        onmessage: (e) => log.push(`msg:${String(e)}`),
        onclose: (e) => log.push(`close:${(e as { code: number }).code}`),
        onerror: () => log.push('error'),
      },
      () => JWT,
      factory,
    );
    expect(t.isOpen).toBe(false);
    t.send(new Uint8Array([1])); // sem socket: ignorado
    t.connect('ws://h/a');
    const s = sockets[0] as FakeSocket;
    expect(s.binaryType).toBe('arraybuffer');
    s.readyState = 1;
    s.onopen?.({});
    s.onmessage?.('x');
    t.send(new Uint8Array([1]));
    t.sendUnreliable(new Uint8Array([2]));
    expect(s.sent).toHaveLength(2);
    expect(t.isOpen).toBe(true);
    s.onclose?.({ code: 1000 });
    s.onclose?.({ code: 1000 }); // duplicado é descartado
    expect(log).toEqual(['open', 'msg:x', 'close:1000']);
  });

  it('socket que nunca abriu: sintetiza close anormal uma vez', async () => {
    const { sockets, factory } = recordingFactory();
    const closes: number[] = [];
    const errors: number[] = [];
    const t = new BearerWebSocketTransport(
      {
        onclose: (e) => closes.push((e as { code: number }).code),
        onerror: () => errors.push(1),
      },
      () => JWT,
      factory,
    );
    t.connect('ws://h/a');
    const s = sockets[0] as FakeSocket;
    s.onerror?.({});
    s.onerror?.({}); // segundo erro é ignorado
    await new Promise((r) => setTimeout(r, 5));
    expect(closes).toEqual([CloseCode.ABNORMAL_CLOSURE]);
    expect(errors).toHaveLength(0); // o erro cru não é repassado antes de abrir
  });

  it('erro depois de aberto não sintetiza close', async () => {
    const { sockets, factory } = recordingFactory();
    const closes: unknown[] = [];
    const t = new BearerWebSocketTransport({ onclose: (e) => closes.push(e) }, () => JWT, factory);
    t.connect('ws://h/a');
    const s = sockets[0] as FakeSocket;
    s.onopen?.({});
    s.onerror?.({});
    await new Promise((r) => setTimeout(r, 5));
    expect(closes).toHaveLength(0);
  });

  it('close(MAY_TRY_RECONNECT) avisa o SDK na hora e fecha o socket; close comum só fecha', () => {
    const { sockets, factory } = recordingFactory();
    const closes: unknown[] = [];
    const t = new BearerWebSocketTransport({ onclose: (e) => closes.push(e) }, () => JWT, factory);
    t.close(); // sem socket: não lança
    t.connect('ws://h/a');
    const s = sockets[0] as FakeSocket;
    t.close(CloseCode.MAY_TRY_RECONNECT, 'offline');
    expect(closes).toEqual([{ code: CloseCode.MAY_TRY_RECONNECT, reason: 'offline' }]);
    expect(s.onclose).toBeNull();
    expect(s.closedWith).toEqual([CloseCode.MAY_TRY_RECONNECT, 'offline']);
    t.close(1000);
    expect(closes).toHaveLength(1);
  });

  it('defaultWebSocketFactory usa o WebSocket global e falha claramente sem ele', () => {
    const seen: unknown[][] = [];
    class G {
      constructor(...a: unknown[]) {
        seen.push(a);
      }
    }
    vi.stubGlobal('WebSocket', G);
    defaultWebSocketFactory('ws://h/x', ['a', 'b']);
    expect(seen).toEqual([['ws://h/x', ['a', 'b']]]);
    vi.stubGlobal('WebSocket', undefined);
    expect(() => defaultWebSocketFactory('ws://h/x', [])).toThrow('indisponível');
    vi.unstubAllGlobals();
  });
});

const RESERVATION: SeatReservation = {
  name: 'truco',
  roomId: 'room1',
  sessionId: 'sess1',
  processId: 'proc1',
};

describe('createGameClient com o SDK real (WebSocket falso)', () => {
  it('joinWithReservation conecta com o JWT só no subprotocolo, sem _authToken na URL', async () => {
    const { sockets, factory } = recordingFactory();
    const { session } = fakeSession();
    const gc = createGameClient(session, {
      serverUrl: 'http://localhost:2567',
      webSocketFactory: factory,
    });
    void gc.joinWithReservation(RESERVATION).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 5));
    expect(sockets).toHaveLength(1);
    const s = sockets[0] as FakeSocket;
    expect(s.protocols).toEqual([WS_BEARER_PROTOCOL, JWT]);
    expect(s.url).toMatch(/^ws:\/\/localhost:2567\/proc1\/room1\?/);
    expect(s.url).toContain('sessionId=sess1');
    expect(s.url).not.toContain(JWT);
    expect(s.url).not.toContain('_authToken');
    expect(gc.client.auth.token).toBeUndefined();
    gc.dispose();
  });

  it('a RECONEXÃO do SDK abre novo socket com o JWT atual no subprotocolo', async () => {
    const { sockets, factory } = recordingFactory();
    const { session, setToken } = fakeSession('jwt-1');
    const gc = createGameClient(session, {
      serverUrl: 'http://localhost:2567',
      webSocketFactory: factory,
    });
    captureRooms(gc);
    void gc.joinWithReservation(RESERVATION).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 5));
    setToken('jwt-2');
    // Reproduz o que Room.retryReconnection faz: connection.reconnect({ reconnectionToken, skipHandshake }).
    const connection = findRoom(gc).connection;
    connection.reconnect({ reconnectionToken: 'tok-xyz', skipHandshake: true });
    expect(sockets).toHaveLength(2);
    const second = sockets[1] as FakeSocket;
    expect(second.protocols).toEqual([WS_BEARER_PROTOCOL, 'jwt-2']);
    expect(second.url).toContain('reconnectionToken=tok-xyz');
    expect(second.url).not.toContain('jwt-2');
    gc.dispose();
  });

  it('mantém o cabeçalho authorization do SDK em dia e sem credentials include', () => {
    const { session, setToken } = fakeSession('a');
    const gc = createGameClient(session, { webSocketFactory: recordingFactory().factory });
    const h = gc.client.http.options.headers as Record<string, string>;
    expect(h['authorization']).toBe('Bearer a');
    expect(gc.client.http.options.credentials).toBe('omit');
    setToken('b');
    expect(h['authorization']).toBe('Bearer b');
    setToken(null);
    expect(h['authorization']).toBeUndefined();
    gc.dispose();
    setToken('c');
    expect(h['authorization']).toBeUndefined();
  });

  it('queda (onDrop) pede um access fresco em segundo plano', async () => {
    const { sockets, factory } = recordingFactory();
    const { session, raw } = fakeSession();
    const gc = createGameClient(session, { webSocketFactory: factory });
    captureRooms(gc);
    void gc.joinWithReservation(RESERVATION).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 5));
    const before = raw.ensureAccessToken.mock.calls.length;
    findRoom(gc).onDrop.invoke(1006, '');
    expect(raw.ensureAccessToken.mock.calls.length).toBe(before + 1);
    expect(sockets).toHaveLength(1);
    gc.dispose();
  });
});

// Acesso ao Room criado pelo SDK: o cliente guarda a promessa, então capturamos via createRoom.
function findRoom(gc: ReturnType<typeof createGameClient>) {
  return captured.get(gc) as unknown as {
    onDrop: { invoke(code: number, reason: string): void };
    connection: { reconnect(q: { reconnectionToken: string; skipHandshake?: boolean }): void };
  };
}
const captured = new WeakMap<object, unknown>();

/** Intercepta `createRoom` (protegido) para o teste alcançar a sala criada dentro do SDK. */
function captureRooms(gc: ReturnType<typeof createGameClient>) {
  const c = gc.client as unknown as { createRoom(...a: unknown[]): unknown };
  const orig = c.createRoom.bind(c);
  c.createRoom = (...a: unknown[]) => {
    const r = orig(...a);
    captured.set(gc, r);
    return r;
  };
}

describe('classifyFailure', () => {
  it('classifica por código HTTP/WS', () => {
    expect(classifyFailure(new MatchMakeError('x', 401))).toBe('unauthorized');
    expect(classifyFailure(new ServerError(401, 'x'))).toBe('unauthorized');
    expect(classifyFailure(new ServerError(403, 'x'))).toBe('gone');
    expect(classifyFailure(new MatchMakeError('x', 404))).toBe('gone');
    expect(classifyFailure(new MatchMakeError('disposed', 522))).toBe('gone');
    expect(classifyFailure(new MatchMakeError('expired', 524))).toBe('gone');
    expect(classifyFailure(new ServerError(CloseCode.ABNORMAL_CLOSURE, 'x'))).toBe('upgrade');
    expect(classifyFailure(new ServerError(500, 'x'))).toBe('other');
    expect(classifyFailure(new Error('x'))).toBe('other');
  });
});

describe('reconnect', () => {
  function setup(results: Array<'ok' | Error>) {
    const f = fakeSession();
    const gc = createGameClient(f.session, { webSocketFactory: recordingFactory().factory });
    const calls: string[] = [];
    const room = { sessionId: 's' };
    vi.spyOn(gc.client, 'reconnect').mockImplementation((token: string) => {
      calls.push(token);
      const next = results.shift();
      return next === 'ok' ? Promise.resolve(room as never) : Promise.reject(next);
    });
    return { gc, calls, room, ...f };
  }

  it('sucesso direto usa o token da sala', async () => {
    const { gc, calls, room, raw } = setup(['ok']);
    await expect(gc.reconnect({ reconnectionToken: 'r:t' })).resolves.toBe(room);
    expect(calls).toEqual(['r:t']);
    expect(raw.ensureAccessToken).toHaveBeenCalledTimes(1);
    expect(raw.forceRefresh).not.toHaveBeenCalled();
  });

  it('401 -> refresh forçado -> nova tentativa (uma vez)', async () => {
    const { gc, calls, raw } = setup([new MatchMakeError('x', 401), 'ok']);
    await gc.reconnect('r:t');
    expect(calls).toEqual(['r:t', 'r:t']);
    expect(raw.forceRefresh).toHaveBeenCalledTimes(1);
  });

  it('401 duas vezes vira TOKEN_EXPIRED, sem laço', async () => {
    const { gc, calls, raw } = setup([new MatchMakeError('x', 401), new MatchMakeError('x', 401)]);
    await expect(gc.reconnect('r:t')).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
    expect(calls).toHaveLength(2);
    expect(raw.forceRefresh).toHaveBeenCalledTimes(1);
  });

  it.each([403, 404])('%i vira ROOM_NOT_FOUND sem refresh', async (code) => {
    const { gc, raw } = setup([new ServerError(code, 'x')]);
    const e = await gc.reconnect('r:t').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(GameClientError);
    expect(e).toMatchObject({ code: 'ROOM_NOT_FOUND' });
    expect(raw.forceRefresh).not.toHaveBeenCalled();
  });

  it('token malformado vira ROOM_NOT_FOUND sem tocar a rede', async () => {
    const { gc, calls } = setup([]);
    for (const bad of ['', 'semformato', ':x', 'x:', 'a:b:c']) {
      await expect(gc.reconnect(bad)).rejects.toMatchObject({ code: 'ROOM_NOT_FOUND' });
    }
    expect(calls).toHaveLength(0);
  });

  it('outros erros viram UNAVAILABLE', async () => {
    const { gc } = setup([new ServerError(500, 'x')]);
    await expect(gc.reconnect('r:t')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });

  it('falha do refresh (rede) propaga sem descartar sessão', async () => {
    const { gc, raw } = setup([new MatchMakeError('x', 401)]);
    raw.forceRefresh.mockRejectedValueOnce(new Error('503'));
    await expect(gc.reconnect('r:t')).rejects.toThrow('503');
  });
});

describe('reconnect com o SDK real e upgrade recusado (1006)', () => {
  /** Socket que nunca abre: o erro chega ANTES do close, sem código (como no navegador e no undici). */
  function failingFactory() {
    const sockets: FakeSocket[] = [];
    const factory: WebSocketFactory = (url, protocols) => {
      const s = new FakeSocket(url, protocols);
      sockets.push(s);
      setTimeout(() => s.onerror?.({ type: 'error' }), 0);
      setTimeout(() => s.onclose?.({ code: CloseCode.ABNORMAL_CLOSURE, reason: '' }), 3);
      return s;
    };
    return { sockets, factory };
  }

  function arrange() {
    const { sockets, factory } = failingFactory();
    const f = fakeSession();
    const gc = createGameClient(f.session, {
      serverUrl: 'http://localhost:2567',
      webSocketFactory: factory,
    });
    const post = vi
      .spyOn(gc.client.http, 'post')
      .mockResolvedValue({ data: { ...RESERVATION } } as never);
    return { gc, sockets, post, ...f };
  }

  it('erro cru antes do close não vira "other": 1 refresh e 1 nova tentativa', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { gc, sockets, post, raw } = arrange();
    const err = await gc.reconnect('room1:tok').catch((e: unknown) => e);
    expect(raw.forceRefresh).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(2);
    expect(sockets).toHaveLength(2);
    // A 2a falha não gera laço: vira UNAVAILABLE.
    expect(err).toMatchObject({ code: 'UNAVAILABLE' });
    expect(((err as GameClientError).cause as { code?: number }).code).toBe(
      CloseCode.ABNORMAL_CLOSURE,
    );
    gc.dispose();
    vi.restoreAllMocks();
  });
});

describe('erros de sessão no reconnect e no join', () => {
  const RECON = { reconnectionToken: 'r:t' };

  it('sem sessão local: SESSION_REQUIRED (reconnect e join), sem tocar a rede', async () => {
    const f = fakeSession();
    f.raw.ensureAccessToken.mockRejectedValue(new SessionRequiredError());
    const gc = createGameClient(f.session, { webSocketFactory: recordingFactory().factory });
    const spy = vi.spyOn(gc.client, 'reconnect');
    await expect(gc.reconnect(RECON)).rejects.toMatchObject({ code: 'SESSION_REQUIRED' });
    await expect(gc.joinWithReservation(RESERVATION)).rejects.toMatchObject({
      code: 'SESSION_REQUIRED',
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('refresh recusado (401) antes de reconectar: TOKEN_EXPIRED', async () => {
    const f = fakeSession();
    f.raw.ensureAccessToken.mockRejectedValue(
      new ApiError({ status: 401, code: 'INVALID_REFRESH_TOKEN', kind: 'http' }),
    );
    const gc = createGameClient(f.session, { webSocketFactory: recordingFactory().factory });
    await expect(gc.reconnect(RECON)).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
  });

  it('refresh recusado (401) no meio do reconnect: TOKEN_EXPIRED; 503 segue como ApiError', async () => {
    const f = fakeSession();
    const gc = createGameClient(f.session, { webSocketFactory: recordingFactory().factory });
    vi.spyOn(gc.client, 'reconnect').mockRejectedValue(new MatchMakeError('x', 401));
    f.raw.forceRefresh.mockRejectedValueOnce(
      new ApiError({ status: 401, code: 'INVALID_REFRESH_TOKEN', kind: 'http' }),
    );
    await expect(gc.reconnect(RECON)).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
    f.raw.forceRefresh.mockRejectedValueOnce(
      new ApiError({ status: 503, code: 'SERVICE_UNAVAILABLE', kind: 'unavailable' }),
    );
    await expect(gc.reconnect(RECON)).rejects.toBeInstanceOf(ApiError);
  });
});

describe('joinWithReservation', () => {
  it('repassa a reserva INTACTA ao SDK e converte falha em JOIN_FAILED', async () => {
    const { session } = fakeSession();
    const gc = createGameClient(session, { webSocketFactory: recordingFactory().factory });
    const spy = vi.spyOn(gc.client, 'consumeSeatReservation').mockRejectedValue(new Error('x'));
    const full = { ...RESERVATION, devMode: true, publicAddress: 'localhost:2567' };
    await expect(gc.joinWithReservation(full)).rejects.toMatchObject({ code: 'JOIN_FAILED' });
    expect(spy.mock.calls[0]?.[0]).toBe(full);
  });
});

describe('reserva adulterada (Vitor-1)', () => {
  const bad: Array<[string, Partial<SeatReservation>]> = [
    ['publicAddress de outro host', { publicAddress: 'evil.com' }],
    ['publicAddress com userinfo', { publicAddress: 'localhost:2567@evil.com' }],
    ['publicAddress com caminho', { publicAddress: 'evil.com/localhost' }],
    ['processId com caracteres perigosos', { processId: 'p/../x' }],
    ['roomId com query', { roomId: 'r?x=1' }],
    ['sessionId vazio', { sessionId: '' }],
  ];
  it.each(bad)('%s: erro tipado, sem socket e sem JWT', async (_label, patch) => {
    const { sockets, factory } = recordingFactory();
    const { session, raw } = fakeSession();
    const gc = createGameClient(session, {
      serverUrl: 'http://localhost:2567',
      webSocketFactory: factory,
    });
    const spy = vi.spyOn(gc.client, 'consumeSeatReservation');
    await expect(gc.joinWithReservation({ ...RESERVATION, ...patch })).rejects.toMatchObject({
      code: 'JOIN_FAILED',
    });
    expect(spy).not.toHaveBeenCalled();
    expect(sockets).toHaveLength(0);
    expect(raw.ensureAccessToken).not.toHaveBeenCalled();
  });

  it('o transporte recusa host diferente do servidor, sem abrir socket', () => {
    const { sockets, factory } = recordingFactory();
    const t = new BearerWebSocketTransport({}, () => JWT, factory, 'localhost');
    expect(() => t.connect('wss://evil.com/p/r')).toThrow('HOST_NOT_ALLOWED');
    expect(sockets).toHaveLength(0);
    t.connect('ws://localhost:2567/p/r');
    expect(sockets).toHaveLength(1);
  });
});

describe('trackEvents', () => {
  function fakeRoom() {
    let cb: ((m: unknown) => void) | undefined;
    return {
      room: {
        onMessage: ((_t: string, c: (m: unknown) => void) => {
          cb = c;
          return () => undefined;
        }) as never,
      },
      emit: (m: unknown) => cb?.(m),
    };
  }

  it('sequência contínua não desincroniza; salto marca uma vez; ack reabre', () => {
    const { room, emit } = fakeRoom();
    const got: number[] = [];
    const desync: Array<{ expected: number; got: number }> = [];
    const tr = trackEvents(room, {
      onEvent: (e) => got.push(e.seq),
      onDesync: (i) => desync.push(i),
    });
    emit({ seq: 7, at: 1, event: {} }); // primeiro evento: sem referência
    emit({ seq: 8, at: 2, event: {} });
    expect(tr.isDesynced()).toBe(false);
    emit({ seq: 11, at: 3, event: {} });
    emit({ seq: 14, at: 4, event: {} });
    expect(desync).toEqual([{ expected: 9, got: 11 }]);
    expect(tr.isDesynced()).toBe(true);
    expect(tr.lastSeq()).toBe(14);
    tr.acknowledgeResync();
    emit({ seq: 15, at: 5, event: {} });
    expect(tr.isDesynced()).toBe(false);
    emit({ seq: 20, at: 6, event: {} });
    expect(desync).toHaveLength(2);
    expect(got).toEqual([7, 8, 11, 14, 15, 20]);
  });

  it('ignora repetidos, mensagens malformadas e usa afterSeq da sala anterior', () => {
    const { room, emit } = fakeRoom();
    const got: number[] = [];
    let desyncs = 0;
    trackEvents(room, { onEvent: (e) => got.push(e.seq), onDesync: () => desyncs++ }, 5);
    emit({ seq: 5 });
    emit({ seq: 4 });
    emit(null);
    emit('x');
    emit({ seq: 'a' });
    emit({ seq: 1.5 });
    emit({ seq: 6, event: {} }); // sem `at`
    expect(got).toEqual([6]);
    expect(desyncs).toBe(0);
    emit({ seq: 9 });
    expect(desyncs).toBe(1);
  });
});
