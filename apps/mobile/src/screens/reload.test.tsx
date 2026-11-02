// @vitest-environment jsdom
/**
 * Reload simulado: dois "ciclos de vida" do app sobre o MESMO sessionStorage do jsdom. O primeiro entra na
 * mesa e deixa o registro; o segundo (objetos novos, memória zerada) decide na splash e volta ao assento.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameClientError } from '../net/colyseus';
import { RESUME_KEY } from '../net/resumeStorageCore';
import { createResumeStorage } from '../net/resumeStorage.web';
import { createRoomService } from '../room/roomService';
import type { RoomClientLike, RoomLike } from '../room/roomService';
import { createResumeRecorder, createTableResume } from '../room/tableResume';
import { createRoomStore } from '../store/roomStore';
import { BootView, RESUMING_TEXT } from './BootView';
import { decideBoot } from './bootResume';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const reservation = { name: 'truco', sessionId: 's', roomId: 'room1' };
const PLAYING = {
  roomCode: 'ABCDEFGH',
  phase: 'playing',
  players: Array.from({ length: 4 }, (_, i) => ({
    seat: i,
    nickname: `J${i}`,
    status: 'connected',
    isBot: false,
  })),
  privates: { '2': { seat: 2, hand: ['3-paus', 'A-copas', '7-ouros'] } },
};

class FakeRoom implements RoomLike {
  readonly state = { toJSON: () => PLAYING };
  constructor(readonly reconnectionToken: string) {}
  send(): void {}
  leave = vi.fn(() => Promise.resolve());
  onStateChange(): void {}
  onDrop(): void {}
  onReconnect(): void {}
  onLeave(): void {}
  onMessage(): void {}
}

/** Um ciclo de vida do app: stores, serviço de sala e retomada novos, mesmo armazenamento. */
function boot(client: RoomClientLike, userId = 'u1') {
  const roomStore = createRoomStore();
  const storage = createResumeStorage();
  const recorder = createResumeRecorder({ storage, getUserId: () => userId });
  const rooms = createRoomService({
    getClient: () => client,
    store: roomStore,
    persist: recorder,
    firstStateTimeoutMs: 20,
  });
  const resume = createTableResume({
    storage,
    clear: () => recorder.clear(),
    getUserId: () => userId,
    resumeRoom: (token) => rooms.resume(token),
    reserveByCode: () => Promise.resolve(reservation),
    enter: (r) => rooms.enter(r),
    sleep: () => Promise.resolve(),
  });
  return { roomStore, rooms, resume, recorder };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => globalThis.sessionStorage.clear());
afterEach(() => globalThis.sessionStorage.clear());

describe('reload da página da mesa', () => {
  it('volta ao mesmo assento pelo token guardado, sem passar pelo início', async () => {
    const first = boot({
      joinWithReservation: () => Promise.resolve(new FakeRoom('room1:tokA')),
      reconnect: () => Promise.reject(new Error('não usado')),
    });
    await first.rooms.enter(reservation);
    await flush();
    expect(JSON.parse(globalThis.sessionStorage.getItem(RESUME_KEY) ?? 'null')).toEqual({
      reconnectionToken: 'room1:tokA',
      code: 'ABCDEFGH',
      userId: 'u1',
    });
    expect(globalThis.localStorage.getItem(RESUME_KEY)).toBeNull();

    // --- reload: tudo em memória some; só o sessionStorage fica ---
    const reconnect = vi.fn(
      (src: { reconnectionToken: string }): Promise<RoomLike> =>
        src.reconnectionToken === 'room1:tokA'
          ? Promise.resolve(new FakeRoom('room1:tokB'))
          : Promise.reject(new GameClientError('ROOM_NOT_FOUND')),
    );
    const second = boot({ joinWithReservation: vi.fn(), reconnect });
    const onResuming = vi.fn();
    const decision = await decideBoot(second.resume, { onResuming });
    await flush();

    expect(onResuming).toHaveBeenCalledTimes(1);
    expect(decision).toEqual({ kind: 'table', code: 'ABCDEFGH' });
    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(second.roomStore.getState().mySeat).toBe(2); // mesmo assento
    expect(second.roomStore.getState().connection).toBe('connected');
    // O token novo (o antigo foi consumido) fica guardado para o próximo reload.
    expect(JSON.parse(globalThis.sessionStorage.getItem(RESUME_KEY) ?? 'null')).toMatchObject({
      reconnectionToken: 'room1:tokB',
    });
  });

  it('mesa que não existe mais: apaga o registro e manda ao início com aviso', async () => {
    const first = boot({
      joinWithReservation: () => Promise.resolve(new FakeRoom('room1:tokA')),
      reconnect: vi.fn(),
    });
    await first.rooms.enter(reservation);
    await flush();

    const second = boot({
      joinWithReservation: vi.fn(() => Promise.reject(new GameClientError('JOIN_FAILED'))),
      reconnect: vi.fn(() => Promise.reject(new GameClientError('ROOM_NOT_FOUND'))),
    });
    const decision = await decideBoot(second.resume, { onResuming: vi.fn() });
    await flush();
    expect(decision).toEqual({ kind: 'home', notice: 'tableLost', code: 'ABCDEFGH' });
    expect(globalThis.sessionStorage.getItem(RESUME_KEY)).toBeNull();
  });

  it('outro usuário no mesmo navegador nunca herda a mesa guardada', async () => {
    const first = boot(
      {
        joinWithReservation: () => Promise.resolve(new FakeRoom('room1:tokA')),
        reconnect: vi.fn(),
      },
      'u1',
    );
    await first.rooms.enter(reservation);
    await flush();
    const reconnect = vi.fn();
    const other = boot({ joinWithReservation: vi.fn(), reconnect }, 'u2');
    expect(await decideBoot(other.resume, { onResuming: vi.fn() })).toEqual({
      kind: 'home',
      notice: null,
    });
    await flush();
    expect(reconnect).not.toHaveBeenCalled();
    expect(globalThis.sessionStorage.getItem(RESUME_KEY)).toBeNull();
  });

  it('sair da mesa de propósito apaga: o reload seguinte não retoma', async () => {
    const first = boot({
      joinWithReservation: () => Promise.resolve(new FakeRoom('room1:tokA')),
      reconnect: vi.fn(),
    });
    await first.rooms.enter(reservation);
    await flush();
    expect(globalThis.sessionStorage.getItem(RESUME_KEY)).not.toBeNull();
    await first.rooms.leave();
    await flush();
    expect(globalThis.sessionStorage.getItem(RESUME_KEY)).toBeNull();
    const second = boot({ joinWithReservation: vi.fn(), reconnect: vi.fn() });
    expect(await decideBoot(second.resume, { onResuming: vi.fn() })).toEqual({
      kind: 'home',
      notice: null,
    });
  });
});

describe('BootView: "Reconectando à mesa…"', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('fica visível e é anunciado ao leitor de tela (região viva)', async () => {
    await act(async () => {
      root.render(<BootView phase="resuming" onRetry={() => undefined} />);
    });
    expect(host.querySelector('[data-testid="boot-resuming"]')?.textContent).toBe(RESUMING_TEXT);
    const live = host.querySelector('[role="status"][aria-live="polite"]');
    expect(live?.textContent).toContain(RESUMING_TEXT);
  });

  it('fora da retomada nada é anunciado', async () => {
    await act(async () => {
      root.render(<BootView phase="loading" onRetry={() => undefined} />);
    });
    expect(host.querySelector('[data-testid="boot-resuming"]')).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent ?? '').toBe('');
  });
});
