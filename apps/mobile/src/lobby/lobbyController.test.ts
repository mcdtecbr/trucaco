import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../net/api';
import { createLobbyStore } from '../store/lobbyStore';
import type { LobbyStore } from '../store/lobbyStore';
import { QUEUE_POLL_MS, MAX_POLL_FAILURES, createLobbyController } from './lobbyController';
import type { LobbyApi } from './lobbyController';

const reservation = { name: 'truco', sessionId: 's', roomId: 'r' };
const apiError = (status: number, code: string, retryAfterSeconds?: number) =>
  new ApiError({
    status,
    code: code as never,
    kind: 'http',
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
  });
const unavailable = () => new ApiError({ status: 0, code: 'NETWORK', kind: 'network' });

function setup(now?: () => number) {
  const store: LobbyStore = createLobbyStore();
  const api = {
    createTable: vi.fn(),
    joinTable: vi.fn(),
    joinQueue: vi.fn(),
    queueStatus: vi.fn(),
    leaveQueue: vi.fn(),
  };
  const entered: string[] = [];
  const enter = vi.fn(async () => 'ABCDEFGH');
  const abandon = vi.fn();
  const controller = createLobbyController({
    api: api as unknown as LobbyApi,
    store,
    enter,
    onEntered: (c) => entered.push(c),
    abandon,
    ...(now !== undefined ? { now } : {}),
  });
  return { store, api, entered, enter, abandon, controller };
}
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('criar mesa', () => {
  it('manda opções privadas, entra com a reserva e navega pelo código', async () => {
    const t = setup();
    t.api.createTable.mockResolvedValue({ code: 'ABCDEFGH', reservation });
    await t.controller.createTable({ variant: 'mineiro', format: 'bo3', ironHand: false });
    expect(t.api.createTable).toHaveBeenCalledWith({
      variant: 'mineiro',
      format: 'bo3',
      ironHand: false,
      visibility: 'private',
    });
    expect(t.enter).toHaveBeenCalledWith(reservation);
    expect(t.entered).toEqual(['ABCDEFGH']);
    expect(t.store.getState().busy).toBe('none');
  });

  it('duplo clique: a segunda chamada em voo é ignorada', async () => {
    const t = setup();
    let resolve!: (v: unknown) => void;
    t.api.createTable.mockReturnValue(new Promise((r) => (resolve = r)));
    const first = t.controller.createTable({
      variant: 'paulista',
      format: 'single',
      ironHand: true,
    });
    await t.controller.createTable({ variant: 'paulista', format: 'single', ironHand: true });
    expect(t.api.createTable).toHaveBeenCalledTimes(1);
    expect(t.store.getState().busy).toBe('create');
    resolve({ code: 'ABCDEFGH', reservation });
    await first;
    expect(t.entered).toEqual(['ABCDEFGH']);
  });

  it('erro do servidor vira erro de escopo create e libera os botões', async () => {
    const t = setup();
    t.api.createTable.mockRejectedValue(apiError(409, 'ALREADY_IN_TABLE'));
    await t.controller.createTable({ variant: 'paulista', format: 'single', ironHand: true });
    expect(t.store.getState().error).toEqual({ scope: 'create', code: 'ALREADY_IN_TABLE' });
    expect(t.store.getState().busy).toBe('none');
    expect(t.entered).toEqual([]);
  });

  it('resposta fora do formato vira INVALID_RESPONSE, sem tentar entrar', async () => {
    const t = setup();
    t.api.createTable.mockResolvedValue({ code: 'curto', reservation });
    await t.controller.createTable({ variant: 'paulista', format: 'single', ironHand: true });
    expect(t.store.getState().error?.code).toBe('INVALID_RESPONSE');
    expect(t.enter).not.toHaveBeenCalled();
  });

  it('sem código de sala válido NÃO navega (nunca onEntered vazio) e larga a sala', async () => {
    const t = setup();
    t.api.createTable.mockResolvedValue({ code: 'ABCDEFGH', reservation });
    t.enter.mockResolvedValue('');
    await t.controller.createTable({ variant: 'paulista', format: 'single', ironHand: true });
    expect(t.entered).toEqual([]);
    expect(t.abandon).toHaveBeenCalledTimes(1);
    expect(t.store.getState().error?.code).toBe('INVALID_RESPONSE');
  });

  it('falha ao consumir a reserva mostra o erro e não navega', async () => {
    const t = setup();
    t.api.createTable.mockResolvedValue({ code: 'ABCDEFGH', reservation });
    t.enter.mockRejectedValue(new Error('x'));
    await t.controller.createTable({ variant: 'paulista', format: 'single', ironHand: true });
    expect(t.store.getState().error?.scope).toBe('create');
    expect(t.entered).toEqual([]);
    expect(t.store.getState().busy).toBe('none');
  });
});

describe('entrar por código', () => {
  it('formato inválido NUNCA chama a rede', async () => {
    const t = setup();
    for (const bad of ['', 'ABC', 'ABCDEFG0', 'abcd efg', '<b>']) {
      await t.controller.joinByCode(bad);
      expect(t.store.getState().error).toEqual({ scope: 'join', code: 'INVALID_CODE' });
    }
    expect(t.api.joinTable).not.toHaveBeenCalled();
  });

  it('normaliza (minúsculas, hífen) e entra', async () => {
    const t = setup();
    t.api.joinTable.mockResolvedValue({ reservation });
    await t.controller.joinByCode('abcd-efgh');
    expect(t.api.joinTable).toHaveBeenCalledWith('ABCDEFGH');
    expect(t.entered).toEqual(['ABCDEFGH']);
  });

  it('TABLE_UNAVAILABLE é repassado como está (a UI mostra uma só mensagem)', async () => {
    const t = setup();
    t.api.joinTable.mockRejectedValue(apiError(404, 'TABLE_UNAVAILABLE'));
    await t.controller.joinByCode('ABCDEFGH');
    expect(t.store.getState().error).toEqual({ scope: 'join', code: 'TABLE_UNAVAILABLE' });
  });

  it('429 guarda o Retry-After e o instante em que ele vence (relógio injetado)', async () => {
    const t = setup(() => 1_000_000);
    t.api.joinTable.mockRejectedValue(apiError(429, 'RATE_LIMITED', 30));
    await t.controller.joinByCode('ABCDEFGH');
    expect(t.store.getState().error).toEqual({
      scope: 'join',
      code: 'RATE_LIMITED',
      retryAfterSeconds: 30,
      retryUntil: 1_030_000,
    });
  });
});

describe('fila pública', () => {
  const choices = { variant: 'paulista', ironHand: true } as const;

  it('manda single/public, vira queued e faz polling a cada ~2 s até casar', async () => {
    const t = setup();
    t.api.joinQueue.mockResolvedValue({ status: 'queued', expiresAt: 99_000 });
    t.api.queueStatus
      .mockResolvedValueOnce({ status: 'queued', expiresAt: 99_000 })
      .mockResolvedValueOnce({ status: 'matched', reservation });
    await t.controller.startQueue(choices);
    expect(t.api.joinQueue).toHaveBeenCalledWith({
      variant: 'paulista',
      format: 'single',
      ironHand: true,
      visibility: 'public',
    });
    expect(t.store.getState().queue).toEqual({ status: 'queued', expiresAt: 99_000 });
    expect(t.api.queueStatus).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(QUEUE_POLL_MS);
    expect(t.api.queueStatus).toHaveBeenCalledTimes(1);
    expect(t.entered).toEqual([]);
    await vi.advanceTimersByTimeAsync(QUEUE_POLL_MS);
    expect(t.api.queueStatus).toHaveBeenCalledTimes(2);
    expect(t.enter).toHaveBeenCalledWith(reservation);
    expect(t.entered).toEqual(['ABCDEFGH']);
    expect(t.store.getState().queue).toEqual({ status: 'idle' });
    // não há mais polling depois de casar
    await vi.advanceTimersByTimeAsync(QUEUE_POLL_MS * 5);
    expect(t.api.queueStatus).toHaveBeenCalledTimes(2);
  });

  it('matched já na resposta do POST entra direto', async () => {
    const t = setup();
    t.api.joinQueue.mockResolvedValue({ status: 'matched', reservation });
    await t.controller.startQueue(choices);
    expect(t.entered).toEqual(['ABCDEFGH']);
    expect(t.api.queueStatus).not.toHaveBeenCalled();
  });

  it('idle depois de queued = expirou: avisa e para o polling', async () => {
    const t = setup();
    t.api.joinQueue.mockResolvedValue({ status: 'queued', expiresAt: 99_000 });
    t.api.queueStatus.mockResolvedValue({ status: 'idle' });
    await t.controller.startQueue(choices);
    await vi.advanceTimersByTimeAsync(QUEUE_POLL_MS);
    expect(t.store.getState().notice).toBe('queueExpired');
    expect(t.store.getState().queue).toEqual({ status: 'idle' });
    await vi.advanceTimersByTimeAsync(QUEUE_POLL_MS * 3);
    expect(t.api.queueStatus).toHaveBeenCalledTimes(1);
  });

  it('seated para o polling e mostra o estado', async () => {
    const t = setup();
    t.api.joinQueue.mockResolvedValue({ status: 'queued', expiresAt: 99_000 });
    t.api.queueStatus.mockResolvedValue({ status: 'seated' });
    await t.controller.startQueue(choices);
    await vi.advanceTimersByTimeAsync(QUEUE_POLL_MS);
    expect(t.store.getState().queue).toEqual({ status: 'seated' });
    await vi.advanceTimersByTimeAsync(QUEUE_POLL_MS * 3);
    expect(t.api.queueStatus).toHaveBeenCalledTimes(1);
  });

  it('QUEUE_COOLDOWN guarda o Retry-After e não entra na fila', async () => {
    const t = setup();
    t.api.joinQueue.mockRejectedValue(apiError(429, 'QUEUE_COOLDOWN', 42));
    await t.controller.startQueue(choices);
    expect(t.store.getState().error).toMatchObject({
      scope: 'queue',
      code: 'QUEUE_COOLDOWN',
      retryAfterSeconds: 42,
    });
    expect(t.store.getState().error?.retryUntil).toBeGreaterThan(Date.now());
    expect(t.store.getState().queue).toEqual({ status: 'idle' });
    await vi.advanceTimersByTimeAsync(QUEUE_POLL_MS * 3);
    expect(t.api.queueStatus).not.toHaveBeenCalled();
  });

  it('ALREADY_IN_TABLE na fila vira erro de escopo queue', async () => {
    const t = setup();
    t.api.joinQueue.mockRejectedValue(apiError(409, 'ALREADY_IN_TABLE'));
    await t.controller.startQueue(choices);
    expect(t.store.getState().error).toEqual({ scope: 'queue', code: 'ALREADY_IN_TABLE' });
  });

  it('indisponibilidade no polling é tolerada e depois de várias falhas desiste', async () => {
    const t = setup();
    t.api.joinQueue.mockResolvedValue({ status: 'queued', expiresAt: 99_000 });
    t.api.queueStatus.mockRejectedValue(unavailable());
    await t.controller.startQueue(choices);
    await vi.advanceTimersByTimeAsync(QUEUE_POLL_MS * (MAX_POLL_FAILURES - 1));
    expect(t.store.getState().queue.status).toBe('queued');
    await vi.advanceTimersByTimeAsync(QUEUE_POLL_MS);
    expect(t.api.queueStatus).toHaveBeenCalledTimes(MAX_POLL_FAILURES);
    expect(t.store.getState().queue).toEqual({ status: 'idle' });
    expect(t.store.getState().error?.code).toBe('NETWORK');
    await vi.advanceTimersByTimeAsync(QUEUE_POLL_MS * 3);
    expect(t.api.queueStatus).toHaveBeenCalledTimes(MAX_POLL_FAILURES);
  });

  it('erro de autorização no polling para na hora', async () => {
    const t = setup();
    t.api.joinQueue.mockResolvedValue({ status: 'queued', expiresAt: 99_000 });
    t.api.queueStatus.mockRejectedValue(apiError(401, 'UNAUTHORIZED'));
    await t.controller.startQueue(choices);
    await vi.advanceTimersByTimeAsync(QUEUE_POLL_MS * 4);
    expect(t.api.queueStatus).toHaveBeenCalledTimes(1);
    expect(t.store.getState().error?.code).toBe('UNAUTHORIZED');
  });

  it('cancelar: para o polling, chama /queue/leave e volta a idle', async () => {
    const t = setup();
    t.api.joinQueue.mockResolvedValue({ status: 'queued', expiresAt: 99_000 });
    t.api.queueStatus.mockResolvedValue({ status: 'queued', expiresAt: 99_000 });
    t.api.leaveQueue.mockResolvedValue({ status: 'idle' });
    await t.controller.startQueue(choices);
    await vi.advanceTimersByTimeAsync(QUEUE_POLL_MS);
    await t.controller.cancelQueue();
    expect(t.api.leaveQueue).toHaveBeenCalledTimes(1);
    expect(t.store.getState().queue).toEqual({ status: 'idle' });
    await vi.advanceTimersByTimeAsync(QUEUE_POLL_MS * 5);
    expect(t.api.queueStatus).toHaveBeenCalledTimes(1);
  });

  it('resposta de polling em voo quando cancela é descartada', async () => {
    const t = setup();
    t.api.joinQueue.mockResolvedValue({ status: 'queued', expiresAt: 99_000 });
    let resolvePoll!: (v: unknown) => void;
    t.api.queueStatus.mockReturnValue(new Promise((r) => (resolvePoll = r)));
    t.api.leaveQueue.mockResolvedValue({ status: 'idle' });
    await t.controller.startQueue(choices);
    await vi.advanceTimersByTimeAsync(QUEUE_POLL_MS); // polling em voo
    await t.controller.cancelQueue();
    resolvePoll({ status: 'matched', reservation });
    await flush();
    expect(t.enter).not.toHaveBeenCalled();
    expect(t.entered).toEqual([]);
  });

  it('sair da tela (dispose) cancela o polling e sai da fila', async () => {
    const t = setup();
    t.api.joinQueue.mockResolvedValue({ status: 'queued', expiresAt: 99_000 });
    t.api.queueStatus.mockResolvedValue({ status: 'queued', expiresAt: 99_000 });
    t.api.leaveQueue.mockResolvedValue({ status: 'idle' });
    await t.controller.startQueue(choices);
    t.controller.dispose();
    expect(t.api.leaveQueue).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(QUEUE_POLL_MS * 5);
    expect(t.api.queueStatus).not.toHaveBeenCalled();
  });

  it('dispose com o POST /queue em voo: a resposta tardia `queued` é seguida de /queue/leave', async () => {
    const t = setup();
    let resolveJoin!: (v: unknown) => void;
    t.api.joinQueue.mockReturnValue(new Promise((r) => (resolveJoin = r)));
    t.api.leaveQueue.mockResolvedValue({ status: 'idle' });
    const run = t.controller.startQueue(choices);
    await flush();
    t.controller.dispose(); // sai da tela com a requisição ainda em voo
    expect(t.api.leaveQueue).not.toHaveBeenCalled(); // ainda não sabemos que entrou
    resolveJoin({ status: 'queued', expiresAt: 99_000 });
    await run;
    expect(t.api.leaveQueue).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(QUEUE_POLL_MS * 3);
    expect(t.api.queueStatus).not.toHaveBeenCalled(); // e nada de polling
  });

  it('dispose com o POST em voo e resposta `matched` também sai da fila', async () => {
    const t = setup();
    let resolveJoin!: (v: unknown) => void;
    t.api.joinQueue.mockReturnValue(new Promise((r) => (resolveJoin = r)));
    t.api.leaveQueue.mockResolvedValue({ status: 'idle' });
    const run = t.controller.startQueue(choices);
    await flush();
    t.controller.dispose();
    resolveJoin({ status: 'matched', reservation });
    await run;
    expect(t.api.leaveQueue).toHaveBeenCalledTimes(1);
    expect(t.enter).not.toHaveBeenCalled();
  });

  it('dispose sem estar na fila não chama /queue/leave', () => {
    const t = setup();
    t.controller.dispose();
    expect(t.api.leaveQueue).not.toHaveBeenCalled();
  });

  it('dispose durante a entrada larga a sala aberta e não navega', async () => {
    const t = setup();
    let finish!: (c: string) => void;
    t.enter.mockReturnValue(new Promise((r) => (finish = r)));
    t.api.joinQueue.mockResolvedValue({ status: 'matched', reservation });
    const run = t.controller.startQueue(choices);
    await flush();
    t.controller.dispose();
    finish('ABCDEFGH');
    await run;
    expect(t.entered).toEqual([]);
    expect(t.abandon).toHaveBeenCalledTimes(1);
  });

  it('fila e demais ações são exclusivas: não cria mesa nem entra por código enquanto queued', async () => {
    const t = setup();
    t.api.joinQueue.mockResolvedValue({ status: 'queued', expiresAt: 99_000 });
    await t.controller.startQueue(choices);
    await t.controller.createTable({ variant: 'paulista', format: 'single', ironHand: true });
    await t.controller.joinByCode('ABCDEFGH');
    await t.controller.startQueue(choices);
    expect(t.api.createTable).not.toHaveBeenCalled();
    expect(t.api.joinTable).not.toHaveBeenCalled();
    expect(t.api.joinQueue).toHaveBeenCalledTimes(1);
  });
});

describe('jogar contra bots', () => {
  it('depois de sentar na mesa nova pede fillBots uma única vez', async () => {
    const store: LobbyStore = createLobbyStore();
    const api = {
      createTable: vi.fn(),
      joinTable: vi.fn(),
      joinQueue: vi.fn(),
      queueStatus: vi.fn(),
      leaveQueue: vi.fn(),
    };
    api.createTable.mockResolvedValue({ code: 'ABCDEFGH', reservation });
    const order: string[] = [];
    const fillBots = vi.fn(() => {
      order.push('fill');
      return false; // recusado: sem laço
    });
    const controller = createLobbyController({
      api: api as unknown as LobbyApi,
      store,
      enter: async () => 'ABCDEFGH',
      onEntered: () => order.push('entered'),
      fillBots,
    });
    await controller.createTable(
      { variant: 'paulista', format: 'single', ironHand: true },
      { fillBots: true },
    );
    expect(api.createTable).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: 'private' }),
    );
    expect(fillBots).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['entered', 'fill']);
    expect(store.getState().busy).toBe('none');
  });

  it('sem a opção (criar mesa comum) não preenche', async () => {
    const store: LobbyStore = createLobbyStore();
    const api = {
      createTable: vi.fn(),
      joinTable: vi.fn(),
      joinQueue: vi.fn(),
      queueStatus: vi.fn(),
      leaveQueue: vi.fn(),
    };
    api.createTable.mockResolvedValue({ code: 'ABCDEFGH', reservation });
    const fillBots = vi.fn(() => true);
    const controller = createLobbyController({
      api: api as unknown as LobbyApi,
      store,
      enter: async () => 'ABCDEFGH',
      onEntered: () => undefined,
      fillBots,
    });
    await controller.createTable({ variant: 'paulista', format: 'single', ironHand: true });
    expect(fillBots).not.toHaveBeenCalled();
  });
});
