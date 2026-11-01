/** Lobby sem Colyseus: gateway falso e relógio controlado. */
import type { RoomOptions } from '@trucaco/protocol';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOBBY_CONFIG, GatewayAuthError, Lobby } from './lobby';
import type { LobbyConfig, SeatReservation, TableGateway } from './lobby';
import { setLogSink } from '../logger';

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
}

function fakeGateway(): Fake {
  const g: Fake = {
    created: [],
    reserved: [],
    failCreate: false,
    failReserve: false,
    async createRoom(options, token) {
      await Promise.resolve();
      if (g.failCreate) throw new Error('boom');
      const roomId = `room-${g.created.length + 1}`;
      g.created.push({ options, token, roomId });
      return roomId;
    },
    async reserve(roomId, joinOptions, bearer): Promise<SeatReservation> {
      await Promise.resolve();
      if (g.failReserve === 'auth') throw new GatewayAuthError(401);
      if (g.failReserve === 'generic') throw new Error('cheia');
      g.reserved.push({ roomId, ...joinOptions, bearer });
      return { name: 'truco', sessionId: `s${g.reserved.length}`, roomId };
    },
  };
  return g;
}

function setup(over: Partial<LobbyConfig> = {}): { lobby: Lobby; gw: Fake; now: { t: number } } {
  const gw = fakeGateway();
  const now = { t: 1_000_000 };
  const lobby = new Lobby(gw, { ...DEFAULT_LOBBY_CONFIG, ...over }, () => now.t);
  return { lobby, gw, now };
}

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
    // dono já tem slot
    expect(await lobby.joinByCode('dono', 'tk', 'ip', code)).toMatchObject({
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
