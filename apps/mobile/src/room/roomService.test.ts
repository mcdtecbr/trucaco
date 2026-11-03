import { DEFAULT_AVATAR_PARTS } from '@trucaco/protocol';
import { describe, expect, it, vi } from 'vitest';
import { GameClientError } from '../net/colyseus';
import { createRoomStore } from '../store/roomStore';
import { CLOSE_CONSENTED, createRoomService } from './roomService';
import type { RoomClientLike, RoomLike } from './roomService';

const reservation = { name: 'truco', sessionId: 's', roomId: 'r' };

function stateJson(players: number, phase = 'waiting') {
  return {
    roomCode: 'ABCDEFGH',
    phase,
    players: Array.from({ length: 4 }, (_, i) => ({
      seat: i,
      nickname: i < players ? `J${i}` : '',
      status: i < players ? 'connected' : 'empty',
      isBot: false,
    })),
    privates: { '0': { seat: 0 } },
  };
}

class FakeRoom implements RoomLike {
  json: unknown = stateJson(1);
  reconnectionToken = 'r:tok';
  handlers: Record<string, Array<(...a: never[]) => void>> = {};
  sent: Array<{ type: string; payload: unknown }> = [];
  send(type: string, payload: unknown) {
    this.sent.push({ type, payload });
  }
  leave = vi.fn((consented?: boolean) => Promise.resolve(consented));
  get state() {
    return { toJSON: () => this.json };
  }
  private on(name: string, cb: (...a: never[]) => void) {
    (this.handlers[name] ??= []).push(cb);
  }
  onStateChange(cb: () => void) {
    this.on('state', cb);
  }
  onDrop(cb: () => void) {
    this.on('drop', cb);
  }
  onReconnect(cb: () => void) {
    this.on('reconnect', cb);
  }
  onLeave(cb: (code: number) => void) {
    this.on('leave', cb as never);
  }
  onMessage(type: string, cb: (p: unknown) => void) {
    this.on(`msg:${type}`, cb as never);
  }
  emit(name: string, ...args: unknown[]) {
    for (const h of this.handlers[name] ?? []) (h as (...a: unknown[]) => void)(...args);
  }
  setState(json: unknown) {
    this.json = json;
    this.emit('state');
  }
}

const READY_TEST_MS = 15;
const afterReadyDelay = (): Promise<void> => new Promise((r) => setTimeout(r, READY_TEST_MS * 3));

function setup() {
  const store = createRoomStore();
  const rooms: FakeRoom[] = [];
  const client = {
    joinWithReservation: vi.fn(async (): Promise<RoomLike> => {
      const r = new FakeRoom();
      rooms.push(r);
      return r;
    }),
    reconnect: vi.fn(
      async (source: RoomLike | { reconnectionToken: string }): Promise<RoomLike> => {
        void source;
        const r = new FakeRoom();
        rooms.push(r);
        return r;
      },
    ),
  } satisfies RoomClientLike;
  const table = {
    applyState: vi.fn(),
    onEvent: vi.fn(),
    onDesync: vi.fn(),
    onChat: vi.fn(),
    onCodes: vi.fn(),
    onSignal: vi.fn(),
    onPresence: vi.fn(),
    onTurnTimer: vi.fn(),
    onServerError: vi.fn(),
    onReconnected: vi.fn(),
    reset: vi.fn(),
  };
  const service = createRoomService({
    getClient: () => client,
    store,
    table,
    firstStateTimeoutMs: 20,
    readyDelayMs: READY_TEST_MS,
  });
  return { store, rooms, client, service, table };
}

describe('roomService', () => {
  it('entra, projeta o estado e devolve o código', async () => {
    const t = setup();
    const code = await t.service.enter(reservation);
    expect(code).toBe('ABCDEFGH');
    expect(t.client.joinWithReservation).toHaveBeenCalledWith(reservation);
    expect(t.store.getState().connection).toBe('connected');
    expect(t.store.getState().seats).toHaveLength(4);
    expect(t.store.getState().mySeat).toBe(0);
  });

  it('atualiza o store a cada mudança de estado', async () => {
    const t = setup();
    await t.service.enter(reservation);
    t.rooms[0]!.setState(stateJson(4, 'playing'));
    expect(t.store.getState().tablePhase).toBe('playing');
    expect(t.store.getState().seats.filter((s) => s.status === 'connected')).toHaveLength(4);
  });

  it('falha ao entrar fecha com o código do erro e propaga', async () => {
    const t = setup();
    t.client.joinWithReservation.mockRejectedValueOnce(new GameClientError('JOIN_FAILED'));
    await expect(t.service.enter(reservation)).rejects.toBeInstanceOf(GameClientError);
    expect(t.store.getState().connection).toBe('closed');
    expect(t.store.getState().errorCode).toBe('JOIN_FAILED');
  });

  it('leave() é consentido, zera o store e é idempotente', async () => {
    const t = setup();
    await t.service.enter(reservation);
    await t.service.leave();
    await t.service.leave();
    expect(t.rooms[0]!.leave).toHaveBeenCalledTimes(1);
    expect(t.rooms[0]!.leave).toHaveBeenCalledWith(true);
    expect(t.store.getState().connection).toBe('none');
    expect(t.store.getState().seats).toEqual([]);
    expect(t.service.current()).toBeNull();
  });

  it('entrar numa segunda sala sai da primeira (uma sala por vez, nada vaza)', async () => {
    const t = setup();
    await t.service.enter(reservation);
    await t.service.enter(reservation);
    expect(t.rooms[0]!.leave).toHaveBeenCalledWith(true);
    expect(t.service.current()).toBe(t.rooms[1]);
  });

  it('eventos de uma sala antiga depois do leave são ignorados', async () => {
    const t = setup();
    await t.service.enter(reservation);
    const old = t.rooms[0]!;
    await t.service.leave();
    old.setState(stateJson(4, 'playing'));
    old.emit('drop');
    expect(t.store.getState().tablePhase).toBe('');
    expect(t.store.getState().connection).toBe('none');
  });

  it('onDrop marca reconectando e onReconnect volta a conectado', async () => {
    const t = setup();
    await t.service.enter(reservation);
    t.rooms[0]!.emit('drop');
    expect(t.store.getState().connection).toBe('reconnecting');
    t.rooms[0]!.emit('reconnect');
    expect(t.store.getState().connection).toBe('connected');
  });

  it('queda sem consentimento: reconexão manual com o token da sala', async () => {
    const t = setup();
    await t.service.enter(reservation);
    t.rooms[0]!.emit('leave', 1006);
    await vi.waitFor(() => expect(t.client.reconnect).toHaveBeenCalledTimes(1));
    expect(t.client.reconnect.mock.calls[0]![0]).toBe(t.rooms[0]);
    await vi.waitFor(() => expect(t.store.getState().connection).toBe('connected'));
    expect(t.service.current()).toBe(t.rooms[1]);
  });

  it('reconexão manual que falha fecha com o código (sala sumiu)', async () => {
    const t = setup();
    await t.service.enter(reservation);
    t.client.reconnect.mockRejectedValueOnce(new GameClientError('ROOM_NOT_FOUND'));
    t.rooms[0]!.emit('leave', 1006);
    await vi.waitFor(() => expect(t.store.getState().connection).toBe('closed'));
    expect(t.store.getState().errorCode).toBe('ROOM_NOT_FOUND');
    expect(t.service.current()).toBeNull();
  });

  it('saída consentida pelo servidor/cliente não tenta reconectar', async () => {
    const t = setup();
    await t.service.enter(reservation);
    t.rooms[0]!.emit('leave', CLOSE_CONSENTED);
    expect(t.client.reconnect).not.toHaveBeenCalled();
    expect(t.store.getState().connection).toBe('closed');
  });

  it('usuário sai durante a entrada: a sala recém-aberta é largada', async () => {
    const t = setup();
    let release!: (r: RoomLike) => void;
    t.client.joinWithReservation.mockReturnValueOnce(new Promise<RoomLike>((r) => (release = r)));
    const entering = t.service.enter(reservation);
    await t.service.leave();
    const late = new FakeRoom();
    release(late);
    expect(await entering).toBe('');
    expect(late.leave).toHaveBeenCalledWith(true);
    expect(t.service.current()).toBeNull();
  });
});

describe('roomService alimentando a mesa', () => {
  const ev = (seq: number) => ({
    seq,
    at: 1000 + seq,
    event: { type: 'gameStarted', gameNumber: 1 },
  });

  it('cada patch de estado projeta a mesa uma vez, inclusive waiting -> playing SEM sair da sala', async () => {
    const t = setup();
    await t.service.enter(reservation);
    const before = t.table.applyState.mock.calls.length;
    t.rooms[0]!.setState(stateJson(4, 'playing'));
    expect(t.table.applyState.mock.calls.length).toBe(before + 1);
    expect(t.table.applyState).toHaveBeenLastCalledWith(stateJson(4, 'playing'));
    expect(t.store.getState().tablePhase).toBe('playing');
    expect(t.rooms[0]!.leave).not.toHaveBeenCalled();
    expect(t.service.current()).toBe(t.rooms[0]);
  });

  it('encaminha event, presence, turnTimer e error', async () => {
    const t = setup();
    await t.service.enter(reservation);
    const r = t.rooms[0]!;
    r.emit('msg:event', ev(1));
    r.emit('msg:presence', { seat: 1, status: 'away' });
    r.emit('msg:turnTimer', { seat: 0, deadlineAt: 5 });
    r.emit('msg:error', { code: 'NOT_YOUR_TURN' });
    expect(t.table.onEvent).toHaveBeenCalledWith(ev(1));
    expect(t.table.onPresence).toHaveBeenCalledWith({ seat: 1, status: 'away' });
    expect(t.table.onTurnTimer).toHaveBeenCalledWith({ seat: 0, deadlineAt: 5 });
    expect(t.table.onServerError).toHaveBeenCalledWith({ code: 'NOT_YOUR_TURN' });
  });

  it('mensagens de chat chegam ao controlador da mesa', async () => {
    const t = setup();
    await t.service.enter(reservation);
    t.rooms[0]!.emit('msg:chat', { scope: 'table', seat: 1, text: 'oi' });
    expect(t.table.onChat).toHaveBeenCalledWith({ scope: 'table', seat: 1, text: 'oi' });
  });

  it('salto de seq: avisa o desync, reprojeta pelo estado e reconhece a ressincronização', async () => {
    const t = setup();
    await t.service.enter(reservation);
    const r = t.rooms[0]!;
    r.emit('msg:event', ev(1));
    const before = t.table.applyState.mock.calls.length;
    r.emit('msg:event', ev(5));
    expect(t.table.onDesync).toHaveBeenCalledWith({ expected: 2, got: 5 });
    expect(t.table.applyState.mock.calls.length).toBe(before + 1);
    expect(t.table.onEvent).toHaveBeenCalledTimes(2);
    // Contínuo depois do salto: sem novo desync.
    r.emit('msg:event', ev(6));
    expect(t.table.onDesync).toHaveBeenCalledTimes(1);
  });

  it('evento repetido (replay sobreposto) é ignorado', async () => {
    const t = setup();
    await t.service.enter(reservation);
    t.rooms[0]!.emit('msg:event', ev(1));
    t.rooms[0]!.emit('msg:event', ev(1));
    expect(t.table.onEvent).toHaveBeenCalledTimes(1);
  });

  it('mensagens de uma sala antiga depois do leave são ignoradas', async () => {
    const t = setup();
    await t.service.enter(reservation);
    const old = t.rooms[0]!;
    await t.service.leave();
    old.emit('msg:event', ev(1));
    old.emit('msg:error', { code: 'X' });
    expect(t.table.onEvent).not.toHaveBeenCalled();
    expect(t.table.onServerError).not.toHaveBeenCalled();
    expect(t.table.reset).toHaveBeenCalled();
  });

  it('onReconnect do SDK reprojeta e avisa a mesa', async () => {
    const t = setup();
    await t.service.enter(reservation);
    t.rooms[0]!.emit('drop');
    t.rooms[0]!.emit('reconnect');
    expect(t.table.onReconnected).toHaveBeenCalledTimes(1);
  });

  it('reconexão manual continua o seq da sala anterior (replay só do que falta)', async () => {
    const t = setup();
    await t.service.enter(reservation);
    t.rooms[0]!.emit('msg:event', ev(1));
    t.rooms[0]!.emit('msg:event', ev(2));
    t.rooms[0]!.emit('leave', 1006);
    await vi.waitFor(() => expect(t.service.current()).toBe(t.rooms[1]));
    expect(t.table.onReconnected).toHaveBeenCalledTimes(1);
    t.rooms[1]!.emit('msg:event', ev(2)); // sobreposição
    t.rooms[1]!.emit('msg:event', ev(3));
    expect(t.table.onEvent).toHaveBeenCalledTimes(3);
    expect(t.table.onDesync).not.toHaveBeenCalled();
  });

  it('send: sem payload de tipo/assento, só com sala conectada', async () => {
    const t = setup();
    expect(t.service.send({ type: 'bet' })).toBe(false);
    await t.service.enter(reservation);
    expect(t.service.send({ type: 'play', card: { rank: '3', suit: 'paus' } })).toBe(true);
    expect(t.rooms[0]!.sent).toEqual([
      { type: 'play', payload: { card: { rank: '3', suit: 'paus' } } },
    ]);
    t.rooms[0]!.emit('drop');
    expect(t.service.send({ type: 'bet' })).toBe(false);
    expect(t.rooms[0]!.sent).toHaveLength(1);
  });
});

describe('5C: combinado da dupla', () => {
  it('a mensagem codes chega ao controlador', async () => {
    const t = setup();
    await t.service.enter(reservation);
    const p = { codes: { wink: 'tenho zap' }, by: -1, at: 1 };
    t.rooms[0]!.emit('msg:codes', p);
    expect(t.table.onCodes).toHaveBeenCalledWith(p);
  });

  it('o handler de codes é ligado ANTES de enviar ready (e ready sai uma vez por sala)', async () => {
    const t = setup();
    const order: string[] = [];
    t.client.joinWithReservation.mockImplementationOnce(async () => {
      const r = new FakeRoom();
      const onMessage = r.onMessage.bind(r);
      r.onMessage = (type, cb) => {
        order.push(`on:${type}`);
        onMessage(type, cb);
      };
      const send = r.send.bind(r);
      r.send = (type, payload) => {
        order.push(`send:${type}`);
        send(type, payload);
      };
      t.rooms.push(r);
      return r;
    });
    await t.service.enter(reservation);
    await afterReadyDelay();
    expect(order.indexOf('on:codes')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('on:codes')).toBeLessThan(order.indexOf('send:ready'));
    expect(order.filter((x) => x === 'send:ready')).toHaveLength(1);
  });

  it('não envia ready com a partida em andamento ou com os 4 sentados (roubaria a 1ª jogada)', async () => {
    for (const json of [stateJson(4, 'waiting'), stateJson(4, 'playing')]) {
      const t = setup();
      t.client.joinWithReservation.mockImplementationOnce(async () => {
        const r = new FakeRoom();
        r.json = json;
        t.rooms.push(r);
        return r;
      });
      await t.service.enter(reservation);
      await afterReadyDelay();
      expect(t.rooms[0]!.sent).toEqual([]);
    }
  });

  it('ready sai com a mesa esperando e vaga; sala largada antes do prazo não envia', async () => {
    const t = setup();
    await t.service.enter(reservation);
    expect(t.rooms[0]!.sent).toEqual([]); // não sai na hora da entrada
    await afterReadyDelay();
    expect(t.rooms[0]!.sent).toEqual([{ type: 'ready', payload: {} }]);
    const t2 = setup();
    await t2.service.enter(reservation);
    await t2.service.leave();
    await afterReadyDelay();
    expect(t2.rooms[0]!.sent).toEqual([]);
  });

  it('sala antiga (já largada) não alimenta a mesa', async () => {
    const t = setup();
    await t.service.enter(reservation);
    const old = t.rooms[0]!;
    await t.service.leave();
    old.emit('msg:codes', { codes: {}, by: -1, at: 1 });
    expect(t.table.onCodes).not.toHaveBeenCalled();
  });
});

describe('4E: sinais', () => {
  it('a mensagem signal chega ao controlador da mesa', async () => {
    const t = setup();
    await t.service.enter(reservation);
    t.rooms[0]!.emit('msg:signal', { seat: 2, signalId: 'wink', at: 1 });
    expect(t.table.onSignal).toHaveBeenCalledWith({ seat: 2, signalId: 'wink', at: 1 });
  });

  it('o estado da sala projeta o avatar (JSON) com fallback para o padrão', async () => {
    const t = setup();
    await t.service.enter(reservation);
    const players = [
      {
        seat: 0,
        nickname: 'Ana',
        status: 'connected',
        isBot: false,
        avatar: JSON.stringify({ ...DEFAULT_AVATAR_PARTS, hair: 3 }),
      },
      { seat: 1, nickname: 'Bia', status: 'connected', isBot: false, avatar: '{lixo' },
    ];
    t.rooms[0]!.setState({ roomCode: 'ABCDEFGH', phase: 'waiting', players, privates: {} });
    const seats = t.store.getState().seats;
    expect(seats[0]?.avatar.hair).toBe(3);
    expect(seats[1]?.avatar).toEqual(DEFAULT_AVATAR_PARTS);
  });
});
