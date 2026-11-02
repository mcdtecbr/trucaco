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
  const service = createRoomService({ getClient: () => client, store, firstStateTimeoutMs: 20 });
  return { store, rooms, client, service };
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
