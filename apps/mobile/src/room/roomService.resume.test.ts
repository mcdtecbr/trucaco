import { describe, expect, it, vi } from 'vitest';
import { GameClientError } from '../net/colyseus';
import { createRoomStore } from '../store/roomStore';
import { CLOSE_CONSENTED, createRoomService } from './roomService';
import type { RoomClientLike, RoomLike } from './roomService';

const reservation = { name: 'truco', sessionId: 's', roomId: 'r' };

function stateJson(phase = 'waiting') {
  return {
    roomCode: 'ABCDEFGH',
    phase,
    players: Array.from({ length: 4 }, (_, i) => ({
      seat: i,
      nickname: `J${i}`,
      status: 'connected',
      isBot: false,
    })),
    privates: { '0': { seat: 0 } },
  };
}

class FakeRoom implements RoomLike {
  json: unknown = stateJson();
  reconnectionToken: string;
  handlers: Record<string, Array<(...a: never[]) => void>> = {};
  constructor(token: string) {
    this.reconnectionToken = token;
  }
  send = vi.fn();
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

function setup(over: { over?: () => boolean; joinFails?: boolean } = {}) {
  const store = createRoomStore();
  const rooms: FakeRoom[] = [];
  let n = 0;
  const make = (): FakeRoom => {
    const r = new FakeRoom(`room1:tok${++n}`);
    rooms.push(r);
    return r;
  };
  const client = {
    joinWithReservation: vi.fn((): Promise<RoomLike> => Promise.resolve(make())),
    reconnect: vi.fn((src: { reconnectionToken: string }): Promise<RoomLike> => {
      void src;
      return over.joinFails === true
        ? Promise.reject(new GameClientError('ROOM_NOT_FOUND'))
        : Promise.resolve(make());
    }),
  } satisfies RoomClientLike;
  const persist = { save: vi.fn(), clear: vi.fn() };
  const service = createRoomService({
    getClient: () => client,
    store,
    persist,
    ...(over.over !== undefined ? { isTableOver: over.over } : {}),
    firstStateTimeoutMs: 20,
  });
  return { store, rooms, client, persist, service };
}

describe('roomService: token de reconexão para retomar depois de recarregar', () => {
  it('ao entrar, grava o token da sala com o código', async () => {
    const t = setup();
    await t.service.enter(reservation);
    expect(t.persist.save).toHaveBeenCalledWith('room1:tok1', 'ABCDEFGH');
  });

  it('grava o tipo da mesa (options.visibility) quando o estado o traz', async () => {
    const t = setup();
    await t.service.enter(reservation);
    t.persist.save.mockClear();
    const room = t.rooms[0]!;
    room.setState({ ...stateJson('playing'), options: { visibility: 'public' } });
    expect(t.persist.save).toHaveBeenLastCalledWith('room1:tok1', 'ABCDEFGH', 'public');
    room.setState({ ...stateJson('playing'), options: { visibility: 'private' } });
    expect(t.persist.save).toHaveBeenLastCalledWith('room1:tok1', 'ABCDEFGH', 'private');
  });

  it('grava só com código de sala válido (estado ainda vazio não grava)', async () => {
    const t = setup();
    const pending = t.service.enter(reservation);
    await pending;
    t.persist.save.mockClear();
    t.rooms[0]!.setState({ phase: 'playing' }); // sem roomCode válido
    expect(t.persist.save).not.toHaveBeenCalled();
  });

  it('o SDK renova o token a cada reconexão: o novo é regravado', async () => {
    const t = setup();
    await t.service.enter(reservation);
    t.persist.save.mockClear();
    const room = t.rooms[0]!;
    room.emit('drop');
    room.emit('reconnect'); // o SDK ainda não trocou o token dentro do callback
    room.reconnectionToken = 'room1:novo'; // ...troca logo depois
    await Promise.resolve();
    await Promise.resolve();
    expect(t.persist.save).toHaveBeenLastCalledWith('room1:novo', 'ABCDEFGH');
  });

  it('reconexão manual (recover) grava o token da sala nova', async () => {
    const t = setup();
    await t.service.enter(reservation);
    t.rooms[0]!.emit('leave', 1006);
    await vi.waitFor(() => expect(t.service.current()).toBe(t.rooms[1]));
    expect(t.persist.save).toHaveBeenLastCalledWith('room1:tok2', 'ABCDEFGH');
    expect(t.persist.clear).not.toHaveBeenCalled();
  });

  it('falha da reconexão manual NÃO apaga (o reload ainda pode retomar pelo código)', async () => {
    const t = setup({ joinFails: true });
    await t.service.enter(reservation);
    t.rooms[0]!.emit('leave', 1006);
    await vi.waitFor(() => expect(t.store.getState().connection).toBe('closed'));
    expect(t.persist.clear).not.toHaveBeenCalled();
  });

  it('sair de propósito apaga', async () => {
    const t = setup();
    await t.service.enter(reservation);
    await t.service.leave();
    expect(t.persist.clear).toHaveBeenCalledTimes(1);
  });

  it('saída consentida vinda do servidor apaga', async () => {
    const t = setup();
    await t.service.enter(reservation);
    t.rooms[0]!.emit('leave', CLOSE_CONSENTED);
    expect(t.persist.clear).toHaveBeenCalledTimes(1);
  });

  it('mesa encerrada sem revanche aberta apaga e não regrava; com revanche aberta mantém', async () => {
    let over = false;
    const t = setup({ over: () => over });
    await t.service.enter(reservation);
    t.persist.save.mockClear();
    over = true;
    t.rooms[0]!.setState(stateJson('finished'));
    expect(t.persist.clear).toHaveBeenCalledTimes(1);
    expect(t.persist.save).not.toHaveBeenCalled();
    over = false; // nova partida/revanche reabre a mesa
    t.rooms[0]!.setState(stateJson('playing'));
    expect(t.persist.save).toHaveBeenCalledWith('room1:tok1', 'ABCDEFGH');
  });

  it('resume: reconecta pelo token (sem reserva), projeta o estado e grava o token novo', async () => {
    const t = setup();
    const code = await t.service.resume('room1:velho');
    expect(code).toBe('ABCDEFGH');
    expect(t.client.reconnect).toHaveBeenCalledWith({ reconnectionToken: 'room1:velho' });
    expect(t.client.joinWithReservation).not.toHaveBeenCalled();
    expect(t.store.getState().connection).toBe('connected');
    expect(t.store.getState().mySeat).toBe(0);
    expect(t.persist.save).toHaveBeenCalledWith('room1:tok1', 'ABCDEFGH');
  });

  it('resume recusado: fecha com o código do erro, propaga e NÃO apaga sozinho', async () => {
    const t = setup({ joinFails: true });
    await expect(t.service.resume('room1:velho')).rejects.toBeInstanceOf(GameClientError);
    expect(t.store.getState().connection).toBe('closed');
    expect(t.store.getState().errorCode).toBe('ROOM_NOT_FOUND');
    expect(t.persist.clear).not.toHaveBeenCalled(); // quem decide é o fluxo de retomada
  });

  it('sair durante o resume não grava o token da sala que chegou depois', async () => {
    const t = setup();
    const pending = t.service.resume('room1:velho');
    const left = t.service.leave();
    await Promise.all([pending, left]);
    t.persist.save.mockClear();
    t.rooms[0]!.setState(stateJson('playing')); // sala velha já fora de uso
    expect(t.persist.save).not.toHaveBeenCalled();
  });

  it('entrar em outra sala largando a anterior apaga o registro da anterior', async () => {
    const t = setup();
    await t.service.enter(reservation);
    t.persist.clear.mockClear();
    await t.service.enter(reservation);
    expect(t.persist.clear).toHaveBeenCalledTimes(1);
    expect(t.persist.save).toHaveBeenLastCalledWith('room1:tok2', 'ABCDEFGH');
  });
});
