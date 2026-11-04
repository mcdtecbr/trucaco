/** Lobby sem Colyseus: gateway falso e relógio controlado. */
import type { RoomOptions } from '@trucaco/protocol';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOBBY_CONFIG, GatewayAuthError, Lobby } from './lobby';
import type { Grant, LobbyConfig, SeatReservation, TableGateway } from './lobby';
import { setLogSink } from '../logger';
import type { BlockLookup } from './lobby';

setLogSink(() => undefined);

const Q = (variant: 'paulista' | 'mineiro' = 'paulista', ironHand = true): RoomOptions => ({
  variant,
  format: 'single',
  ironHand,
  visibility: 'public',
});

interface Fake extends TableGateway {
  created: { options: RoomOptions; token: string; roomId: string }[];
  reserved: { roomId: string; code?: string; bearer: string }[];
  failCreate: boolean;
  failReserve: false | 'generic' | 'auth';
  /** Quando definido, `reserve` espera esta promessa (reserva pendente). */
  hold: Promise<void> | null;
}

function fakeGateway(): Fake {
  const g: Fake = {
    created: [],
    reserved: [],
    failCreate: false,
    failReserve: false,
    hold: null,
    async createRoom(options, token) {
      await Promise.resolve();
      if (g.failCreate) throw new Error('boom');
      const roomId = `room-${g.created.length + 1}`;
      g.created.push({ options, token, roomId });
      return roomId;
    },
    async reserve(roomId, joinOptions, bearer): Promise<SeatReservation> {
      await Promise.resolve();
      if (g.hold !== null) await g.hold;
      if (g.failReserve === 'auth') throw new GatewayAuthError(401);
      if (g.failReserve === 'generic') throw new Error('cheia');
      g.reserved.push({ roomId, ...joinOptions, bearer });
      return { name: 'truco', sessionId: `s${g.reserved.length}`, roomId };
    },
  };
  return g;
}

function setup(
  over: Partial<LobbyConfig> = {},
  rand?: (min: number, max: number) => number,
  blocks: BlockLookup | null = null,
): { lobby: Lobby; gw: Fake; now: { t: number } } {
  const gw = fakeGateway();
  const now = { t: 1_000_000 };
  const lobby = new Lobby(gw, { ...DEFAULT_LOBBY_CONFIG, ...over }, () => now.t, rand, blocks);
  return { lobby, gw, now };
}

/** Bloqueios por pares `[a, b]` (qualquer sentido); `fail` simula o banco fora do ar. */
function pairs(list: [string, string][], fail = { on: false }): BlockLookup {
  return {
    relatedIds: (userId) => {
      if (fail.on) return Promise.reject(new Error('db'));
      const out = new Set<string>();
      for (const [a, b] of list) {
        if (a === userId) out.add(b);
        if (b === userId) out.add(a);
      }
      return Promise.resolve(out);
    },
  };
}

describe('Lobby: bloqueios (Fase 6)', () => {
  it('fila pública: dois usuários com bloqueio nunca caem na mesma mesa', async () => {
    const { lobby, gw } = setup({}, undefined, pairs([['a', 'b']]));
    for (const u of ['a', 'b', 'c', 'd']) await lobby.enqueue(u, `t-${u}`, Q());
    expect(gw.created).toHaveLength(0);
    await lobby.enqueue('e', 't-e', Q());
    expect(gw.created).toHaveLength(1);
    const grant = lobby.consumeGrant(gw.created[0]!.token) as Grant;
    expect(grant.allowed?.has('a') && grant.allowed.has('b')).toBe(false);
    expect(grant.allowed?.size).toBe(4);
    // quem sobrou espera outro parceiro compatível
    await lobby.enqueue('f', 't-f', Q());
    await lobby.enqueue('g', 't-g', Q());
    await lobby.enqueue('h', 't-h', Q());
    expect(gw.created).toHaveLength(2);
  });

  it('bloqueio feito com a fila andando vale já (noteBlock)', async () => {
    const { lobby, gw } = setup();
    for (const u of ['a', 'b', 'c']) await lobby.enqueue(u, `t-${u}`, Q());
    lobby.noteBlock('a', 'c');
    await lobby.enqueue('d', 't-d', Q());
    expect(gw.created).toHaveLength(0);
    await lobby.enqueue('e', 't-e', Q());
    expect(gw.created).toHaveLength(1);
  });

  it('conta apagada (forgetUser): sai da fila e perde o ticket da mesa privada', async () => {
    const { lobby, gw } = setup();
    await lobby.enqueue('a', 't', Q());
    lobby.forgetUser('a');
    expect(lobby.slotKind('a')).toBeNull();
    expect(lobby.stats().queued).toBe(0);
    for (const u of ['b', 'c', 'd']) await lobby.enqueue(u, 't', Q());
    expect(gw.created).toHaveLength(0);
    const created = await lobby.createTable('dono', 'tk', {
      variant: 'paulista',
      format: 'single',
      ironHand: true,
      visibility: 'private',
    });
    expect(created.ok).toBe(true);
    expect(lobby.slotKind('dono')).toBe('ticket');
    lobby.forgetUser('dono');
    expect(lobby.slotKind('dono')).toBeNull();
    lobby.forgetUser('ninguem');
  });

  it('falha ao consultar bloqueios: UNAVAILABLE e ninguém entra na fila', async () => {
    const fail = { on: true };
    const { lobby } = setup({}, undefined, pairs([], fail));
    expect(await lobby.enqueue('a', 't', Q())).toEqual({ ok: false, error: 'UNAVAILABLE' });
    expect(lobby.stats().queued).toBe(0);
    expect(lobby.slotKind('a')).toBeNull();
  });

  it('mesa privada: bloqueio com o criador (qualquer sentido) = TABLE_UNAVAILABLE, igual a código inexistente', async () => {
    const { lobby, gw } = setup({}, undefined, pairs([['dono', 'inimigo']]));
    const priv: RoomOptions = {
      variant: 'paulista',
      format: 'single',
      ironHand: true,
      visibility: 'private',
    };
    const created = await lobby.createTable('dono', 'tk', priv);
    if (!created.ok) throw new Error(created.error);
    const c = gw.created.at(-1)!;
    const grant = lobby.consumeGrant(c.token)!;
    lobby.registerRoom(c.roomId, grant.code, 'private', grant);
    const ghost = await lobby.joinByCode('inimigo', 'tk', 'ip', 'AAAAAAAA');
    const blocked = await lobby.joinByCode('inimigo', 'tk', 'ip', created.code);
    expect(blocked).toEqual(ghost);
    expect(blocked).toEqual({ ok: false, error: 'TABLE_UNAVAILABLE' });
    expect(lobby.slotKind('inimigo')).toBeNull();
    expect(await lobby.joinByCode('amigo', 'tk', 'ip', created.code)).toMatchObject({ ok: true });
  });

  it('mesa privada: banco fora do ar falha fechado (TABLE_UNAVAILABLE)', async () => {
    const fail = { on: false };
    const { lobby, gw } = setup({}, undefined, pairs([], fail));
    const created = await lobby.createTable('dono', 'tk', {
      variant: 'paulista',
      format: 'single',
      ironHand: true,
      visibility: 'private',
    });
    if (!created.ok) throw new Error(created.error);
    const c = gw.created.at(-1)!;
    const grant = lobby.consumeGrant(c.token)!;
    lobby.registerRoom(c.roomId, grant.code, 'private', grant);
    fail.on = true;
    expect(await lobby.joinByCode('x', 'tk', 'ip', created.code)).toEqual({
      ok: false,
      error: 'TABLE_UNAVAILABLE',
    });
  });
});

describe('Lobby: fila pública', () => {
  it('4 compatíveis formam UMA mesa pública single e cada um recebe reserva ao consultar', async () => {
    const { lobby, gw } = setup();
    for (const u of ['a', 'b', 'c']) {
      const r = await lobby.enqueue(u, `tk-${u}`, Q());
      expect(r).toMatchObject({ ok: true, status: { status: 'queued' } });
    }
    expect(gw.created).toHaveLength(0);
    const last = await lobby.enqueue('d', 'tk-d', Q());
    expect(gw.created).toHaveLength(1);
    expect(gw.created[0]?.options).toEqual(Q());
    expect(last).toMatchObject({ ok: true, status: { status: 'matched' } });
    for (const u of ['a', 'b', 'c']) {
      const s = await lobby.statusOf(u, `tk-${u}`);
      expect(s).toMatchObject({ status: 'matched', reservation: { roomId: 'room-1' } });
    }
    expect(gw.reserved.map((r) => r.bearer).sort()).toEqual(['tk-a', 'tk-b', 'tk-c', 'tk-d']);
  });

  it('variantes diferentes não casam; sair da fila cancela', async () => {
    const { lobby, gw } = setup();
    await lobby.enqueue('a', 't', Q('paulista'));
    await lobby.enqueue('b', 't', Q('mineiro'));
    await lobby.enqueue('c', 't', Q('paulista'));
    await lobby.enqueue('d', 't', Q('paulista', false));
    await lobby.enqueue('e', 't', Q('paulista'));
    expect(gw.created).toHaveLength(0);
    await lobby.leaveQueue('e');
    expect(await lobby.statusOf('e', 't')).toEqual({ status: 'idle' });
    await lobby.enqueue('f', 't', Q('paulista'));
    expect(gw.created).toHaveLength(0); // a, c, f: 3
    await lobby.enqueue('g', 't', Q('paulista'));
    expect(gw.created).toHaveLength(1);
  });

  it('um userId, uma fila: segunda chamada (até com outra variante) não cria segunda entrada', async () => {
    const { lobby, gw } = setup();
    await lobby.enqueue('u', 't', Q('paulista'));
    const again = await lobby.enqueue('u', 't', Q('mineiro'));
    expect(again).toMatchObject({ ok: true, status: { status: 'queued' } });
    expect(lobby.stats().queued).toBe(1);
    // Se a segunda valesse, 3 mineiros + ele formariam mesa.
    for (const u of ['m1', 'm2', 'm3']) await lobby.enqueue(u, 't', Q('mineiro'));
    expect(gw.created).toHaveLength(0);
  });

  it('concorrência: 12 entradas simultâneas formam exatamente 3 mesas, ninguém em duas', async () => {
    const { lobby, gw } = setup();
    const users = Array.from({ length: 12 }, (_, i) => `u${i}`);
    await Promise.all(users.map((u) => lobby.enqueue(u, `t-${u}`, Q())));
    expect(gw.created).toHaveLength(3);
    const rooms = new Map<string, string>();
    for (const u of users) {
      const s = await lobby.statusOf(u, `t-${u}`);
      expect(s.status).toBe('matched');
      if (s.status === 'matched') rooms.set(u, s.reservation.roomId);
    }
    const perRoom = new Map<string, number>();
    for (const r of rooms.values()) perRoom.set(r, (perRoom.get(r) ?? 0) + 1);
    expect([...perRoom.values()]).toEqual([4, 4, 4]);
    expect(lobby.stats().queued).toBe(0);
  });

  it('o mesmo usuário em chamadas simultâneas continua com uma entrada só', async () => {
    const { lobby } = setup();
    await Promise.all([1, 2, 3, 4, 5].map(() => lobby.enqueue('u', 't', Q())));
    expect(lobby.stats().queued).toBe(1);
  });

  it('quem tem mesa/ticket não entra em outra fila nem cria mesa privada', async () => {
    const { lobby } = setup();
    for (const u of ['a', 'b', 'c', 'd']) await lobby.enqueue(u, 't', Q());
    // a ainda é ticket (não sentou): idempotente, devolve a reserva, sem segunda mesa.
    const again = await lobby.enqueue('a', 't', Q('mineiro'));
    expect(again).toMatchObject({ ok: true, status: { status: 'matched' } });
    const priv = await lobby.createTable('a', 't', { ...Q(), visibility: 'private' });
    expect(priv).toMatchObject({ ok: false, error: 'ALREADY_IN_TABLE' });
    // sentado
    expect(lobby.seat('b', 'room-1')).toBe(true);
    expect(await lobby.enqueue('b', 't', Q())).toMatchObject({
      ok: false,
      error: 'ALREADY_IN_TABLE',
    });
    expect(lobby.seat('b', 'room-9')).toBe(false);
  });

  it('entrada expira após o TTL e o usuário fica livre', async () => {
    const { lobby, now } = setup({ queueTtlMs: 5000 });
    await lobby.enqueue('a', 't', Q());
    now.t += 4000;
    expect(await lobby.statusOf('a', 't')).toMatchObject({ status: 'queued' });
    now.t += 1500;
    expect(await lobby.statusOf('a', 't')).toEqual({ status: 'idle' });
    expect(lobby.stats().queued).toBe(0);
    expect(await lobby.enqueue('a', 't', Q())).toMatchObject({ ok: true });
  });

  it('mesa que não encheu: quem sentou volta à fila na posição original, ausente é solto', async () => {
    const { lobby, gw } = setup();
    await lobby.enqueue('early', 't', Q());
    for (const u of ['b', 'c', 'd']) await lobby.enqueue(u, 't', Q());
    expect(gw.created).toHaveLength(1);
    // Mais dois entram depois (fila): ficam atrás.
    await lobby.enqueue('late1', 't', Q());
    expect(lobby.seat('early', 'room-1')).toBe(true);
    expect(lobby.seat('b', 'room-1')).toBe(true);
    // c e d não aparecem.
    lobby.failFill('room-1');
    expect(lobby.slotKind('early')).toBe('queued');
    expect(lobby.slotKind('b')).toBe('queued');
    expect(lobby.slotKind('c')).toBeNull();
    expect(lobby.slotKind('d')).toBeNull();
    // Dois novos completam o grupo: early e b (mais antigos) vêm primeiro, depois late1 e o novo.
    await lobby.enqueue('new', 't', Q());
    await lobby.drain();
    expect(gw.created).toHaveLength(2);
    expect(lobby.slotKind('late1')).toBe('ticket');
    expect(lobby.slotKind('early')).toBe('ticket');
  });

  it('falha ao criar a sala: ninguém perde a vez', async () => {
    const { lobby, gw } = setup();
    gw.failCreate = true;
    for (const u of ['a', 'b', 'c', 'd']) await lobby.enqueue(u, 't', Q());
    expect(lobby.stats().queued).toBe(4);
    gw.failCreate = false;
    await lobby.drain();
    expect(gw.created).toHaveLength(1);
  });

  it('ticket sem sentar expira e libera o usuário; reserva é reaproveitada só dentro da janela', async () => {
    const { lobby, gw, now } = setup({ fillMs: 30_000, reservationReuseMs: 16_000 });
    for (const u of ['a', 'b', 'c', 'd']) await lobby.enqueue(u, 't', Q());
    await lobby.statusOf('a', 't');
    const reservedAfterFirst = gw.reserved.length;
    await lobby.statusOf('a', 't');
    expect(gw.reserved.length).toBe(reservedAfterFirst); // reaproveitada
    now.t += 17_000;
    await lobby.statusOf('a', 't');
    expect(gw.reserved.length).toBe(reservedAfterFirst + 1); // a anterior já expirou no core
    now.t += 31_000;
    expect(await lobby.statusOf('a', 't')).toEqual({ status: 'idle' });
  });

  it('reserva que falha (mesa fechada) devolve idle e solta o usuário; falha de auth propaga', async () => {
    const { lobby, gw } = setup();
    for (const u of ['a', 'b', 'c', 'd']) await lobby.enqueue(u, 't', Q());
    gw.failReserve = 'generic';
    expect(await lobby.statusOf('b', 't')).toEqual({ status: 'idle' });
    expect(lobby.slotKind('b')).toBeNull();
    gw.failReserve = 'auth';
    await expect(lobby.statusOf('c', 't')).rejects.toBeInstanceOf(GatewayAuthError);
  });
});

describe('Lobby: mesa privada e entrada por código', () => {
  const priv: RoomOptions = {
    variant: 'paulista',
    format: 'bo3',
    ironHand: false,
    visibility: 'private',
  };

  async function table(lobby: Lobby, gw: Fake, user = 'dono'): Promise<string> {
    const r = await lobby.createTable(user, 'tk', priv);
    if (!r.ok) throw new Error(r.error);
    // Simula o que a sala faz em onCreate: consumir a concessão e registrar.
    const created = gw.created.at(-1)!;
    const grant = lobby.consumeGrant(created.token)!;
    expect(grant.code).toBe(r.code);
    lobby.registerRoom(created.roomId, grant.code, 'private', grant);
    return r.code;
  }

  it('criar gera código de 8 caracteres e reserva o primeiro assento ao criador', async () => {
    const { lobby, gw } = setup();
    const code = await table(lobby, gw);
    expect(code).toMatch(/^[A-HJ-KM-NP-Z2-9]{8}$/);
    expect(gw.reserved[0]).toMatchObject({ roomId: 'room-1', bearer: 'tk' });
    expect(lobby.slotKind('dono')).toBe('ticket');
  });

  it('erro IDÊNTICO para código inexistente, sala fechada e mesa de fila (sem oráculo)', async () => {
    const { lobby, gw } = setup();
    const code = await table(lobby, gw);
    for (const u of ['a', 'b', 'c', 'd']) await lobby.enqueue(u, 't', Q());
    const queueRoom = gw.created.at(-1)!;
    // mesa da fila registrada
    lobby.registerRoom(
      queueRoom.roomId,
      'QQQQQQQQ',
      'public',
      lobby.consumeGrant(queueRoom.token)!,
    );
    const results = [] as unknown[];
    for (const probe of ['AAAAAAAA', 'QQQQQQQQ']) {
      results.push(await lobby.joinByCode('intruso', 'tk', '1.1.1.1', probe));
    }
    lobby.releaseRoom('room-1'); // a privada fecha
    results.push(await lobby.joinByCode('intruso', 'tk', '1.1.1.1', code));
    for (const r of results) expect(r).toEqual({ ok: false, error: 'TABLE_UNAVAILABLE' });
  });

  it('mesa cheia/em partida (a sala recusa a reserva) tem o mesmo erro; formato inválido não consulta nada', async () => {
    const { lobby, gw } = setup();
    const code = await table(lobby, gw);
    gw.reserved.length = 0;
    gw.failReserve = 'generic';
    expect(await lobby.joinByCode('x', 'tk', 'ip', code)).toEqual({
      ok: false,
      error: 'TABLE_UNAVAILABLE',
    });
    gw.failReserve = false;
    expect(await lobby.joinByCode('x', 'tk', 'ip', 'abc')).toEqual({
      ok: false,
      error: 'INVALID_CODE',
    });
    expect(await lobby.joinByCode('x', 'tk', 'ip', 12345)).toEqual({
      ok: false,
      error: 'INVALID_CODE',
    });
    expect(gw.reserved).toHaveLength(0);
  });

  it('entrada válida devolve reserva com o código; quem está em outra mesa leva ALREADY_IN_TABLE', async () => {
    const { lobby, gw } = setup();
    const code = await table(lobby, gw);
    const ok = await lobby.joinByCode('amigo', 'tk2', 'ip', code);
    expect(ok).toMatchObject({ ok: true, reservation: { roomId: 'room-1' } });
    expect(gw.reserved.at(-1)).toMatchObject({ code, bearer: 'tk2' });
    // o dono (ticket desta mesa) volta pelo próprio código; outra mesa, não
    expect(await lobby.joinByCode('dono', 'tk', 'ip', code)).toMatchObject({ ok: true });
    expect(await lobby.joinByCode('dono', 'tk', 'ip', 'AAAAAAAA')).toMatchObject({
      ok: false,
      error: 'ALREADY_IN_TABLE',
    });
  });

  it('admissão: criador primeiro; estranho precisa do código; fila só os sorteados; vínculo único', async () => {
    const { lobby, gw } = setup();
    const code = await table(lobby, gw);
    const room = 'room-1';
    expect(lobby.admit('amigo', room, { code })).toBe(false); // criador ainda não sentou
    expect(lobby.admit('dono', room, {})).toBe(true);
    expect(lobby.seat('dono', room)).toBe(true);
    expect(lobby.admit('amigo', room, { code })).toBe(true);
    expect(lobby.admit('amigo', room, { code: 'ZZZZZZZZ' })).toBe(false);
    expect(lobby.admit('amigo', room, {})).toBe(false);
    // quem já está sentado em outra mesa não entra nesta
    lobby.registerRoom('outra', 'BBBBBBBB', 'private', null);
    expect(lobby.admit('dono', 'outra', {})).toBe(false);
    // unseat libera o vínculo
    lobby.unseat('dono', room);
    expect(lobby.admit('dono', 'outra', {})).toBe(true);
    // sala fora do lobby (sem concessão) não impõe regra de código
    expect(lobby.admit('qualquer', 'outra', {})).toBe(true);
    // gw usado
    expect(gw.created).toHaveLength(1);
  });

  it('falha ao criar a sala libera o código e o usuário', async () => {
    const { lobby, gw } = setup();
    gw.failCreate = true;
    expect(await lobby.createTable('dono', 'tk', priv)).toMatchObject({
      ok: false,
      error: 'UNAVAILABLE',
    });
    expect(lobby.slotKind('dono')).toBeNull();
    gw.failCreate = false;
    expect(await lobby.createTable('dono', 'tk', priv)).toMatchObject({ ok: true });
  });

  it('bloqueio temporário após N falhas, inclusive com código certo; passa depois do prazo', async () => {
    const { lobby, gw, now } = setup({
      guard: { ...DEFAULT_LOBBY_CONFIG.guard, failLockThreshold: 3, lockMs: 60_000 },
    });
    const code = await table(lobby, gw);
    for (let i = 0; i < 3; i++) {
      expect(await lobby.joinByCode('chutador', 't', 'ip', 'AAAAAAA' + 'ABCDEFGH'[i])).toEqual({
        ok: false,
        error: 'TABLE_UNAVAILABLE',
      });
    }
    const blocked = await lobby.joinByCode('chutador', 't', 'ip', code);
    expect(blocked).toMatchObject({ ok: false, error: 'RATE_LIMITED' });
    now.t += 61_000;
    expect(await lobby.joinByCode('chutador', 't', 'ip', code)).toMatchObject({ ok: true });
  });
});

describe('Lobby: assentos sorteados da fila (2)', () => {
  const four = ['a', 'b', 'c', 'd'];
  async function formed(lobby: Lobby, gw: Fake, users = four): Promise<Grant> {
    for (const u of users) await lobby.enqueue(u, 't', Q());
    return lobby.consumeGrant(gw.created.at(-1)!.token)!;
  }

  it('o Grant traz um assento distinto 0..3 para cada sorteado', async () => {
    const { lobby, gw } = setup();
    const grant = await formed(lobby, gw);
    expect([...grant.seats!.keys()].sort()).toEqual(four);
    expect([...grant.seats!.values()].sort()).toEqual([0, 1, 2, 3]);
    expect(grant.allowed).toEqual(new Set(four));
  });

  it('mesa privada não tem assentos sorteados', async () => {
    const { lobby, gw } = setup();
    await lobby.createTable('dono', 't', { ...Q(), visibility: 'private' });
    expect(lobby.consumeGrant(gw.created[0]!.token)!.seats).toBeNull();
  });

  it('distribuição não degenerada (semente injetável): ninguém fica preso ao assento de chegada', async () => {
    let state = 12345;
    const next = (): number => {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      return state / 2 ** 32;
    };
    const rand = (min: number, max: number): number => min + Math.floor(next() * (max - min));
    const { lobby, gw } = setup({}, rand);
    const N = 400;
    const bySlot = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
    let partnersOfFirst = 0;
    for (let i = 0; i < N; i++) {
      const users = four.map((u) => `${u}${i}`);
      for (const u of users) await lobby.enqueue(u, 't', Q());
      const grant = lobby.consumeGrant(gw.created[i]!.token)!;
      users.forEach((u, p) => {
        bySlot[p]![grant.seats!.get(u)!]!++;
      });
      if (grant.seats!.get(users[0]!)! % 2 === grant.seats!.get(users[1]!)! % 2) partnersOfFirst++;
    }
    for (const row of bySlot) for (const n of row) expect(n).toBeGreaterThan(60); // esperado: 100
    // 1º e 2º a chegar: parceiros em ~1/3 das mesas (FIFO puro daria 0)
    expect(partnersOfFirst / N).toBeGreaterThan(0.25);
    expect(partnersOfFirst / N).toBeLessThan(0.42);
  });
});

describe('Lobby: cooldown de reentrada na fila (3)', () => {
  async function matched(lobby: Lobby, users = ['a', 'b', 'c', 'd']): Promise<void> {
    for (const u of users) await lobby.enqueue(u, 't', Q());
  }

  it('não sentou até o fim do prazo: o ausente paga, quem sentou volta sem pena', async () => {
    const { lobby, now } = setup({ queueReentryCooldownMs: 60_000 });
    await matched(lobby);
    expect(lobby.seat('a', 'room-1')).toBe(true);
    lobby.failFill('room-1');
    expect(lobby.slotKind('a')).toBe('queued');
    const blocked = await lobby.enqueue('d', 't', Q());
    expect(blocked).toEqual({ ok: false, error: 'QUEUE_COOLDOWN', retryAfterSec: 60 });
    expect(lobby.slotKind('d')).toBeNull();
    now.t += 30_000;
    expect(await lobby.enqueue('d', 't', Q())).toMatchObject({
      ok: false,
      error: 'QUEUE_COOLDOWN',
      retryAfterSec: 30,
    });
    now.t += 30_001;
    expect(await lobby.enqueue('d', 't', Q())).toMatchObject({ ok: true });
  });

  it('desistir depois de casar (leaveQueue com ticket) paga; sair ANTES de casar não', async () => {
    const { lobby } = setup();
    await lobby.enqueue('cedo', 't', Q());
    await lobby.leaveQueue('cedo');
    expect(await lobby.enqueue('cedo', 't', Q())).toMatchObject({ ok: true });
    await lobby.leaveQueue('cedo');

    await matched(lobby);
    await lobby.leaveQueue('b'); // casou e desistiu
    expect(await lobby.enqueue('b', 't', Q())).toMatchObject({
      ok: false,
      error: 'QUEUE_COOLDOWN',
    });
    // quem ficou no ticket não é afetado
    expect(lobby.slotKind('a')).toBe('ticket');
  });

  it('ticket vencido sem sentar paga (sweep); ticket de mesa em criação (sem roomId) não', async () => {
    const { lobby, now } = setup({ fillMs: 10_000 });
    await matched(lobby);
    now.t += 11_000;
    lobby.sweep();
    expect(await lobby.enqueue('a', 't', Q())).toMatchObject({
      ok: false,
      error: 'QUEUE_COOLDOWN',
    });
  });

  it('sentou e saiu da mesa da fila em espera paga; a saída "sem pena" (bot) não', async () => {
    const { lobby } = setup();
    await matched(lobby);
    lobby.seat('a', 'room-1');
    lobby.seat('b', 'room-1');
    lobby.unseat('a', 'room-1', true);
    lobby.unseat('b', 'room-1'); // partida em curso (bot assumiu): sem cooldown
    expect(await lobby.enqueue('a', 't', Q())).toMatchObject({
      ok: false,
      error: 'QUEUE_COOLDOWN',
    });
    expect(await lobby.enqueue('b', 't', Q())).toMatchObject({ ok: true });
  });

  it('0 desliga; mesa privada nunca penaliza; teto de chaves descarta o mais antigo', async () => {
    const off = setup({ queueReentryCooldownMs: 0 });
    await matched(off.lobby);
    await off.lobby.leaveQueue('b');
    expect(await off.lobby.enqueue('b', 't', Q())).toMatchObject({ ok: true });

    const priv = setup();
    await priv.lobby.createTable('dono', 't', { ...Q(), visibility: 'private' });
    await priv.lobby.leaveQueue('dono');
    priv.lobby.releaseRoom('room-1');
    expect(await priv.lobby.enqueue('dono', 't', Q())).toMatchObject({ ok: true });

    const cap = setup({ maxCooldownKeys: 2 });
    await matched(cap.lobby, ['a', 'b', 'c', 'd']);
    for (const u of ['a', 'b', 'c']) await cap.lobby.leaveQueue(u);
    expect(await cap.lobby.enqueue('a', 't', Q())).toMatchObject({ ok: true }); // evictado
    expect(await cap.lobby.enqueue('c', 't', Q())).toMatchObject({ error: 'QUEUE_COOLDOWN' });
  });
});

describe('Lobby: ticket do criador e reservas pendentes (4, 5, 6)', () => {
  const priv: RoomOptions = {
    variant: 'paulista',
    format: 'single',
    ironHand: false,
    visibility: 'private',
  };
  async function table(lobby: Lobby, gw: Fake, user = 'dono'): Promise<string> {
    const r = await lobby.createTable(user, 'tk', priv);
    if (!r.ok) throw new Error(r.error);
    const created = gw.created.at(-1)!;
    const grant = lobby.consumeGrant(created.token)!;
    lobby.registerRoom(created.roomId, grant.code, 'private', grant);
    return r.code;
  }

  it('4: leaveQueue não apaga o ticket do criador de mesa privada', async () => {
    const { lobby, gw } = setup();
    await table(lobby, gw);
    await lobby.leaveQueue('dono');
    expect(lobby.slotKind('dono')).toBe('ticket');
    expect(await lobby.statusOf('dono', 'tk')).toEqual({ status: 'idle' });
  });

  it('5: o criador sem a reserva reentra pelo código (reaproveita a viva, reemite a vencida)', async () => {
    const { lobby, gw, now } = setup();
    const code = await table(lobby, gw);
    expect(gw.reserved).toHaveLength(1);
    const reuse = await lobby.joinByCode('dono', 'tk', 'ip', code);
    expect(reuse).toMatchObject({ ok: true, reservation: { roomId: 'room-1', sessionId: 's1' } });
    expect(gw.reserved).toHaveLength(1); // viva: nada novo segurado
    now.t += 20_000; // reserva do core (15 s) vencida; ticket (30 s) ainda de pé
    const fresh = await lobby.joinByCode('dono', 'tk', 'ip', code);
    expect(fresh).toMatchObject({ ok: true, reservation: { sessionId: 's2' } });
    expect(gw.reserved).toHaveLength(2);
    expect(lobby.slotKind('dono')).toBe('ticket');
    // outra mesa continua recusada
    expect(await lobby.joinByCode('dono', 'tk', 'ip', 'AAAAAAAA')).toMatchObject({
      error: 'ALREADY_IN_TABLE',
    });
  });

  it('5: o ticket vale o prazo do criador (nem mais, nem menos) e some com a mesa fechada', async () => {
    const { lobby, gw, now } = setup({ creatorMs: 30_000 });
    await table(lobby, gw);
    now.t += 29_000;
    lobby.sweep();
    expect(lobby.slotKind('dono')).toBe('ticket');
    now.t += 2_000;
    lobby.sweep();
    expect(lobby.slotKind('dono')).toBeNull();

    await table(lobby, gw, 'outro');
    lobby.releaseRoom('room-2');
    expect(lobby.slotKind('outro')).toBeNull();
  });

  it('6: reserva pendente ocupa o slot: não dá para segurar vagas em duas mesas', async () => {
    const { lobby, gw } = setup();
    const c1 = await table(lobby, gw, 'd1');
    const c2 = await table(lobby, gw, 'd2');
    // os donos sentam (liberam a entrada de convidados)
    lobby.seat('d1', 'room-1');
    lobby.seat('d2', 'room-2');
    let release: () => void = () => undefined;
    gw.hold = new Promise<void>((r) => {
      release = r;
    });
    const first = lobby.joinByCode('x', 'tk', 'ip', c1);
    await Promise.resolve();
    expect(lobby.slotKind('x')).toBe('ticket');
    expect(await lobby.joinByCode('x', 'tk', 'ip', c2)).toMatchObject({
      ok: false,
      error: 'ALREADY_IN_TABLE',
    });
    release();
    expect(await first).toMatchObject({ ok: true, reservation: { roomId: 'room-1' } });
    expect(lobby.slotKind('x')).toBe('ticket');
    // chamadas simultâneas à MESMA mesa dividem uma reserva só
    gw.reserved.length = 0;
    const [r1, r2] = await Promise.all([
      lobby.joinByCode('y', 'tk', 'ip', c1),
      lobby.joinByCode('y', 'tk', 'ip', c1),
    ]);
    expect(r1).toMatchObject({ ok: true });
    expect(r2).toMatchObject({ ok: true });
    expect(gw.reserved).toHaveLength(1);
  });

  it('6: reserva recusada solta o slot; o ticket do convidado expira se ele não sentar', async () => {
    const { lobby, gw, now } = setup();
    const code = await table(lobby, gw);
    lobby.seat('dono', 'room-1');
    gw.failReserve = 'generic';
    expect(await lobby.joinByCode('x', 'tk', 'ip', code)).toMatchObject({
      error: 'TABLE_UNAVAILABLE',
    });
    expect(lobby.slotKind('x')).toBeNull();
    gw.failReserve = false;
    await lobby.joinByCode('x', 'tk', 'ip', code);
    expect(lobby.slotKind('x')).toBe('ticket');
    now.t += 17_000;
    lobby.sweep();
    expect(lobby.slotKind('x')).toBeNull();
  });

  it('7: entrada direta por roomId conta falhas no mesmo freio (usuário; IP quando confiável)', () => {
    const { lobby } = setup({
      guard: { ...DEFAULT_LOBBY_CONFIG.guard, failLockThreshold: 3, lockMs: 60_000 },
    });
    for (let i = 0; i < 3; i++) {
      expect(lobby.allowDirectJoin('u', null)).toBe(true);
      lobby.noteDirectJoinFailure('u', null);
    }
    expect(lobby.allowDirectJoin('u', null)).toBe(false);
    expect(lobby.allowDirectJoin('outro', null)).toBe(true);
  });
});
