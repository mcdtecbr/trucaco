import { DEFAULT_AVATAR_PARTS } from '@trucaco/protocol';
import type { AvatarParts } from '@trucaco/protocol';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client';
import { invalidMatchCases } from './parityCases';
import { createPrisma, type PrismaHandle } from './prisma';
import { constraintNameOf, guarded } from './prismaErrors';
import { PrismaMatchRepository, PrismaUserRepository } from './prismaRepositories';
import { assertSafeTestDatabaseUrl } from './testDatabase';
import {
  InvalidInputError,
  NicknameTakenError,
  NotPartnersError,
  ProviderSubjectTakenError,
  type FinishedMatchInput,
  type PartnerCodesMap,
  type UserRecord,
} from './types';

/**
 * Integração com Postgres real (`pnpm test:int`). Exige TEST_DATABASE_URL de um banco DESCARTÁVEL
 * já migrado (`pnpm db:deploy`): cada teste começa com as tabelas truncadas. A trava
 * (`assertSafeTestDatabaseUrl`) recusa host não local e banco sem "test"/"verif" no nome, antes de
 * qualquer escrita.
 */
const url = process.env['TEST_DATABASE_URL'];

describe.skipIf(url === undefined || url === '')('persistência (Postgres real)', () => {
  let handle: PrismaHandle;
  let users: PrismaUserRepository;
  let matches: PrismaMatchRepository;
  const db = (): PrismaHandle['prisma'] => handle.prisma;
  let seq = 0;

  const guest = (nickname: string): Promise<UserRecord> =>
    users.createGuest({ providerSubject: `g-${++seq}-${nickname}`, nickname });

  const matchInput = (
    players: readonly (string | null)[],
    endedAt: Date,
    overrides: Partial<FinishedMatchInput> = {},
  ): FinishedMatchInput => ({
    variant: 'paulista',
    format: 'single',
    ironHand: false,
    visibility: 'public',
    roomCode: 'ABCD2345',
    seed: 4294967295,
    options: { variant: 'paulista', format: 'single', ironHand: false, visibility: 'public' },
    events: [
      { seq: 1, at: 1000, event: { type: 'handStarted', hand: 1 } },
      { seq: 2, at: 2000, event: { type: 'cardPlayed', seat: 0, covered: true } },
    ],
    deals: [{ hand: 1, cards: [['4C', '5C', '6C']] }],
    winnerTeam: 0,
    games: [[12, 7]],
    status: 'finished',
    startedAt: new Date(endedAt.getTime() - 60_000),
    endedAt,
    players: players.map((userId, seat) => ({
      seat,
      userId,
      team: seat % 2 === 0 ? 0 : 1,
      botFrom: userId === null ? 0 : null,
    })),
    ...overrides,
  });

  /** Dupla A+C (assentos 0 e 2) numa partida finalizada: libera `savePartnerCodes`. */
  const makePartners = async (x: string, y: string): Promise<void> => {
    await matches.saveMatch(matchInput([x, null, y, null], new Date('2026-11-01T11:00:00Z')));
  };

  const rawNick = (nickname: string): Promise<number> =>
    db().$executeRaw`INSERT INTO users (id, provider, provider_subject, nickname)
      VALUES (gen_random_uuid(), 'guest', ${`raw-${++seq}`}, ${nickname})`;

  const rawMatch = (
    over: { status?: string; winner?: number | null; seed?: number; ended?: string } = {},
  ): Promise<number> =>
    db().$executeRaw`INSERT INTO matches (id, variant, format, iron_hand, visibility, seed, options,
        events, games, status, winner_team, started_at, ended_at)
      VALUES (gen_random_uuid(), 'paulista', 'single', false, 'public', ${over.seed ?? 1},
        '{}', '[]', '[]', ${over.status ?? 'finished'}::match_status,
        ${over.winner === undefined ? 0 : over.winner}::smallint, '2026-11-01T12:00:00Z',
        ${over.ended ?? '2026-11-01T12:01:00Z'}::timestamptz)`;

  beforeAll(() => {
    handle = createPrisma(assertSafeTestDatabaseUrl(url), { maxConnections: 4 });
    users = new PrismaUserRepository(handle.prisma);
    matches = new PrismaMatchRepository(handle.prisma);
  });

  afterAll(async () => {
    await handle.close();
  });

  beforeEach(async () => {
    await db().$executeRawUnsafe(
      'TRUNCATE TABLE reports, blocks, partner_codes, match_players, matches, avatars, users CASCADE',
    );
  });

  describe('users', () => {
    it('apelido é único sem diferenciar maiúsculas e minúsculas (inclusive acentuadas)', async () => {
      await guest('Ana');
      await expect(guest('ana')).rejects.toBeInstanceOf(NicknameTakenError);
      await expect(guest('ANA')).rejects.toBeInstanceOf(NicknameTakenError);
      await guest('Ágil');
      await expect(guest('ágil')).rejects.toBeInstanceOf(NicknameTakenError);
      // O índice em lower(nickname) vale também para SQL direto (sem passar pelo repositório).
      await expect(rawNick('aNa')).rejects.toThrow(/users_nickname_lower_key/);
      await expect(rawNick('ÁGIL')).rejects.toThrow(/users_nickname_lower_key/);
      // Banco com locale "C" não dobraria a caixa de Á: o cluster precisa ser UTF-8.
      const [row] = await db().$queryRaw<{ l: string }[]>`SELECT lower('ÁGIL') AS l`;
      expect(row?.l).toBe('ágil');
    });

    it('apelido tem de 3 a 16 caracteres (repositório e CHECK)', async () => {
      await expect(guest('ab')).rejects.toBeInstanceOf(InvalidInputError);
      await expect(guest('a'.repeat(17))).rejects.toBeInstanceOf(InvalidInputError);
      await expect(guest(' ana')).rejects.toBeInstanceOf(InvalidInputError);
      expect((await guest('abc')).nickname).toBe('abc');
      expect((await guest('a'.repeat(16))).nickname).toHaveLength(16);
      await expect(rawNick('ab')).rejects.toThrow(/users_nickname_length_check/);
      // 17 caracteres: recusado pelo VARCHAR(16) antes mesmo do CHECK.
      await expect(rawNick('x'.repeat(17))).rejects.toThrow();
    });

    it('política de apelido: o CHECK recusa o que o repositório recusa (casos do Vitor)', async () => {
      const bad: readonly string[] = [
        'Jo\u200bao', // zero-width
        'J\u043eao', // o cirílico
        '\u03a9mega', // grego
        '\u202eoaoJ', // bidi
        'Joao ',
        'Jo ao',
        'Jo\tao',
        'Joao\n',
        'Jo\u00a0ao',
        'a\u00d7b',
        'Joa\u0303o', // NFD
        'a\u0345bc',
        'Joao\u{1F600}',
      ];
      for (const nick of bad) {
        await expect(rawNick(nick), JSON.stringify(nick)).rejects.toThrow(
          /users_nickname_(charset|nfc|length)_check/,
        );
        await expect(guest(nick === 'Joa\u0303o' ? 'ab' : nick)).rejects.toBeInstanceOf(
          InvalidInputError,
        );
      }
      // O NFD isolado: o repositório normaliza e aceita; o banco, direto, recusa.
      expect((await guest('Joa\u0303o')).nickname).toBe('João');
      for (const nick of ['Zé_da-Silva', 'Ana.B', 'Ágil2', 'Joao', 'Çedilha9']) {
        await expect(rawNick(nick), nick).resolves.toBe(1);
      }
    });

    it('as constraints de apelido têm nome estável (lido do erro estruturado)', async () => {
      await guest('Ana');
      try {
        await db().user.create({
          data: { provider: 'guest', providerSubject: 'q', nickname: 'ANA' },
        });
        expect.unreachable();
      } catch (error) {
        expect(constraintNameOf(error)).toBe('users_nickname_lower_key');
      }
      try {
        await db().user.create({
          data: { provider: 'guest', providerSubject: 'q2', nickname: 'a b' },
        });
        expect.unreachable();
      } catch (error) {
        expect(constraintNameOf(error)).toBe('users_nickname_charset_check');
      }
    });

    it('UNIQUE(provider, provider_subject); o mesmo subject em outro provedor é outra conta', async () => {
      await users.createGuest({ providerSubject: 'abc', nickname: 'Beto' });
      await expect(
        users.createGuest({ providerSubject: 'abc', nickname: 'Carla' }),
      ).rejects.toBeInstanceOf(ProviderSubjectTakenError);
      await db().$executeRawUnsafe(
        `INSERT INTO users (id, provider, provider_subject, nickname)
         VALUES (gen_random_uuid(), 'google', 'abc', 'Dora')`,
      );
      expect((await users.findByProvider('guest', 'abc'))?.nickname).toBe('Beto');
      expect(await users.findByProvider('apple', 'abc')).toBeNull();
    });

    it('updateNickname: troca, repete só o próprio, 409 sem diferenciar caixa e usuário inexistente', async () => {
      const a = await guest('Gil');
      const b = await guest('Hugo');
      await users.updateNickname(a.id, 'Gilberto');
      expect((await users.findById(a.id))?.nickname).toBe('Gilberto');
      await users.updateNickname(a.id, 'gilberto');
      await expect(users.updateNickname(b.id, 'GILBERTO')).rejects.toBeInstanceOf(
        NicknameTakenError,
      );
      await expect(users.updateNickname(b.id, 'a b')).rejects.toBeInstanceOf(InvalidInputError);
      await expect(
        users.updateNickname('00000000-0000-4000-8000-000000000000', 'Fantasma'),
      ).rejects.toBeInstanceOf(InvalidInputError);
    });

    it('id é UUID aleatório e não guarda e-mail nem nome real', async () => {
      const a = await guest('Eva');
      const b = await guest('Fabi');
      expect(a.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(a.id).not.toBe(b.id);
      const cols = await db().$queryRawUnsafe<{ column_name: string }[]>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'users'`,
      );
      expect(cols.map((c) => c.column_name).sort()).toEqual([
        'created_at',
        'id',
        'last_seen_at',
        'nickname',
        'provider',
        'provider_subject',
      ]);
    });

    it('avatar: um por usuário (upsert) e removido junto com o usuário', async () => {
      const u = await guest('Gil');
      await users.saveAvatar(u.id, { ...DEFAULT_AVATAR_PARTS, skin: 1 });
      await users.saveAvatar(u.id, { ...DEFAULT_AVATAR_PARTS, skin: 2 });
      expect(await users.getAvatar(u.id)).toEqual({ ...DEFAULT_AVATAR_PARTS, skin: 2 });
      expect(await db().avatar.count()).toBe(1);
      await expect(
        db().$executeRawUnsafe(`UPDATE avatars SET parts = '[]'::jsonb`),
      ).rejects.toThrow(/avatars_parts_object_check/);
      await db().user.delete({ where: { id: u.id } });
      expect(await db().avatar.count()).toBe(0);
    });

    it('avatar: catálogo no repositório, teto de tamanho no banco, formato antigo vira null', async () => {
      const u = await guest('Gil');
      await expect(
        users.saveAvatar(u.id, { hat: 'x'.repeat(61) } as unknown as AvatarParts),
      ).rejects.toBeInstanceOf(InvalidInputError);
      await expect(
        db().$executeRaw`INSERT INTO avatars (user_id, parts, updated_at)
          VALUES (${u.id}::uuid, jsonb_build_object('k', repeat('x', 5000000)), now())`,
      ).rejects.toThrow(/avatars_parts_size_check/);
      await db().avatar.create({ data: { userId: u.id, parts: { hat: 'cap' } } });
      expect(await users.getAvatar(u.id)).toBeNull();
    });
  });

  describe('blocks', () => {
    it('auto-bloqueio é recusado (CHECK e repositório) e bloquear é idempotente', async () => {
      const a = await guest('Ana');
      const b = await guest('Beto');
      await expect(users.addBlock(a.id, a.id)).rejects.toBeInstanceOf(InvalidInputError);
      await expect(
        db().$executeRawUnsafe(
          `INSERT INTO blocks (id, blocker_id, blocked_id) VALUES (gen_random_uuid(), '${a.id}', '${a.id}')`,
        ),
      ).rejects.toThrow(/blocks_not_self_check/);
      await users.addBlock(a.id, b.id);
      await users.addBlock(a.id, b.id);
      expect(await users.listBlockedIds(a.id)).toEqual([b.id]);
      expect(await users.listBlockerIds(b.id)).toEqual([a.id]);
      expect(await users.listBlockerIds(a.id)).toEqual([]);
      await users.removeBlock(a.id, b.id);
      expect(await users.listBlockedIds(a.id)).toEqual([]);
      await expect(
        users.addBlock(a.id, '00000000-0000-4000-8000-000000000000'),
      ).rejects.toBeInstanceOf(InvalidInputError);
    });
  });

  describe('Fase 6B: listBlocks, hasReport, participantIds e deleteUser', () => {
    it('listBlocks traz apelido; hasReport e participantIds', async () => {
      const a = await guest('Ana');
      const b = await guest('Beto');
      const c = await guest('Caio');
      await users.addBlock(a.id, c.id);
      await users.addBlock(a.id, b.id);
      expect((await users.listBlocks(a.id)).map((x) => x.nickname)).toEqual(['Caio', 'Beto']);
      const matchId = await matches.saveMatch(matchInput([a.id, b.id, null, null], new Date()));
      expect(await users.hasReport(a.id, b.id, null)).toBe(false);
      await users.createReport({ reporterId: a.id, reportedId: b.id, reason: 'cheating' });
      expect(await users.hasReport(a.id, b.id, null)).toBe(true);
      expect(await users.hasReport(a.id, b.id, matchId)).toBe(false);
      await users.createReport({ reporterId: a.id, reportedId: b.id, matchId, reason: 'other' });
      expect(await users.hasReport(a.id, b.id, matchId)).toBe(true);
      expect([...((await matches.participantIds(matchId)) ?? [])].sort()).toEqual(
        [a.id, b.id].sort(),
      );
      expect(await matches.participantIds('00000000-0000-4000-8000-000000000000')).toBeNull();
    });

    it('deleteUser: cascatas do banco, partidas anonimizadas e denúncias mantidas', async () => {
      const a = await guest('Ana');
      const b = await guest('Beto');
      const c = await guest('Caio');
      await users.saveAvatar(a.id, DEFAULT_AVATAR_PARTS);
      await users.addBlock(a.id, b.id);
      await users.addBlock(c.id, a.id);
      const matchId = await matches.saveMatch(matchInput([a.id, b.id, c.id, null], new Date()));
      await users.savePartnerCodes(a.id, c.id, { wink: 'x' });
      await users.createReport({ reporterId: b.id, reportedId: a.id, matchId, reason: 'cheating' });

      expect(await users.deleteUser(a.id)).toBe(true);
      expect(await users.deleteUser(a.id)).toBe(false);
      expect(await users.findById(a.id)).toBeNull();
      expect(await users.getAvatar(a.id)).toBeNull();
      expect(await users.listBlockerIds(b.id)).toEqual([]);
      expect(await users.listBlockedIds(c.id)).toEqual([]);
      expect(await users.getPartnerCodes(a.id, c.id)).toBeNull();
      const reports = await db().report.findMany();
      expect(reports).toHaveLength(1);
      expect(reports[0]).toMatchObject({ reporterId: b.id, reportedId: null, matchId });
      const page = await matches.listForUser(b.id);
      expect(page.items[0]?.players.map((p) => p.userId)).toEqual([null, b.id, c.id, null]);
      expect(page.items[0]?.players.map((p) => p.nickname)).toEqual([null, 'Beto', 'Caio', null]);
    });
  });

  describe('partner_codes', () => {
    it('par é ordenado: (a,b) e (b,a) são o mesmo registro (com vínculo de dupla)', async () => {
      const a = await guest('Ana');
      const b = await guest('Beto');
      await makePartners(a.id, b.id);
      await users.savePartnerCodes(a.id, b.id, { wink: 'tenho zap' });
      await users.savePartnerCodes(b.id.toUpperCase(), a.id, {
        wink: 'tenho zap',
        nod: 'sem manilha',
      });
      expect(await db().partnerCodes.count()).toBe(1);
      expect(await users.getPartnerCodes(a.id, b.id)).toEqual({
        wink: 'tenho zap',
        nod: 'sem manilha',
      });
      expect(await users.getPartnerCodes(b.id, a.id)).toEqual({
        wink: 'tenho zap',
        nod: 'sem manilha',
      });
      const row = await db().partnerCodes.findFirstOrThrow();
      expect(row.userAId < row.userBId).toBe(true);
    });

    it('havePlayedTogether: mesma dupla em partida finalizada; adversário e cancelada não contam', async () => {
      const [a, b, c, d] = await Promise.all([
        guest('Ana'),
        guest('Beto'),
        guest('Caio'),
        guest('Dora'),
      ]);
      const t = new Date('2026-11-01T12:00:00Z');
      expect(await users.havePlayedTogether(a.id, b.id)).toBe(false);
      await expect(users.savePartnerCodes(a.id, b.id, {})).rejects.toBeInstanceOf(NotPartnersError);
      // a,b,c,d nos assentos 0..3: duplas (a,c) e (b,d).
      await matches.saveMatch(matchInput([a.id, b.id, c.id, d.id], t));
      expect(await users.havePlayedTogether(a.id, c.id)).toBe(true);
      expect(await users.havePlayedTogether(d.id.toUpperCase(), b.id)).toBe(true);
      expect(await users.havePlayedTogether(a.id, b.id)).toBe(false);
      expect(await users.havePlayedTogether(a.id, d.id)).toBe(false);
      await expect(users.savePartnerCodes(a.id, b.id, { wink: 'x' })).rejects.toBeInstanceOf(
        NotPartnersError,
      );
      await users.savePartnerCodes(a.id, c.id, { wink: 'x' });
      // Partida cancelada não cria vínculo.
      await matches.saveMatch(
        matchInput([a.id, null, d.id, null], t, { status: 'cancelled', winnerTeam: null }),
      );
      expect(await users.havePlayedTogether(a.id, d.id)).toBe(false);
      await expect(users.havePlayedTogether(a.id, a.id)).rejects.toBeInstanceOf(InvalidInputError);
    });

    it('CHECK recusa par fora de ordem, par consigo e duplicado', async () => {
      const a = await guest('Ana');
      const b = await guest('Beto');
      const [lo, hi] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
      const insert = (x: string, y: string): Promise<number> =>
        db().$executeRawUnsafe(
          `INSERT INTO partner_codes (id, user_a_id, user_b_id, codes, updated_at)
           VALUES (gen_random_uuid(), '${x}', '${y}', '{}'::jsonb, now())`,
        );
      await expect(insert(hi, lo)).rejects.toThrow(/partner_codes_ordered_pair_check/);
      await expect(insert(lo, lo)).rejects.toThrow(/partner_codes_ordered_pair_check/);
      await insert(lo, hi);
      await expect(insert(lo, hi)).rejects.toThrow(/partner_codes_user_a_id_user_b_id_key/);
    });

    it('significado de até 60 caracteres, só signalId do catálogo; teto de 16 KB no banco', async () => {
      const a = await guest('Ana');
      const b = await guest('Beto');
      await makePartners(a.id, b.id);
      await users.savePartnerCodes(a.id, b.id, { wink: 'x'.repeat(60) });
      const badCodes: PartnerCodesMap[] = [
        { wink: 'x'.repeat(61) },
        { naoExiste: 'x' },
        { '': 'x' },
      ];
      for (const bad of badCodes) {
        await expect(users.savePartnerCodes(a.id, b.id, bad)).rejects.toBeInstanceOf(
          InvalidInputError,
        );
      }
      await expect(users.savePartnerCodes(a.id, a.id, {})).rejects.toBeInstanceOf(
        InvalidInputError,
      );
      const [lo, hi] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
      await db().partnerCodes.deleteMany();
      await expect(
        db().$executeRaw`INSERT INTO partner_codes (id, user_a_id, user_b_id, codes, updated_at)
          VALUES (gen_random_uuid(), ${lo}::uuid, ${hi}::uuid,
                  jsonb_build_object('wink', repeat('x', 5000000)), now())`,
      ).rejects.toThrow(/partner_codes_codes_size_check/);
    });
  });

  describe('matches e FK', () => {
    it('grava e consulta eventos jsonb em visão pública, sem expor deals na listagem', async () => {
      const [a, b, c, d] = await Promise.all([
        guest('A1x'),
        guest('B2x'),
        guest('C3x'),
        guest('D4x'),
      ]);
      const id = await matches.saveMatch(
        matchInput([a.id, b.id, c.id, d.id], new Date('2026-11-01T12:00:00Z')),
      );
      const rows = await db().$queryRawUnsafe<{ n: bigint; kind: string; seed: bigint }[]>(
        `SELECT jsonb_array_length(events) AS n, events->1->'event'->>'type' AS kind, seed
           FROM matches WHERE id = '${id}'::uuid`,
      );
      expect(Number(rows[0]?.n)).toBe(2);
      expect(rows[0]?.kind).toBe('cardPlayed');
      expect(rows[0]?.seed).toBe(4294967295n);
      // Consulta por conteúdo (operador @> do jsonb).
      const hit = await db().$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM matches WHERE events @> '[{"seq": 2}]'::jsonb`,
      );
      expect(hit).toHaveLength(1);

      const page = await matches.listForUser(a.id);
      expect(page.items).toHaveLength(1);
      const item = page.items[0];
      expect(item?.players.map((p) => p.nickname)).toEqual(['A1x', 'B2x', 'C3x', 'D4x']);
      expect(item?.games).toEqual([[12, 7]]);
      expect(Object.keys(item ?? {})).not.toContain('deals');
      expect(Object.keys(item ?? {})).not.toContain('events');
      expect(Object.keys(item ?? {})).not.toContain('seed');
    });

    it('CHECKs do banco (SQL direto): status x vencedor, assento 0..3, dupla, período, seed, botFrom', async () => {
      const a = await guest('Ana');
      await expect(rawMatch({ winner: null })).rejects.toThrow(/matches_status_winner_check/);
      await expect(rawMatch({ status: 'cancelled', winner: 1 })).rejects.toThrow(
        /matches_status_winner_check/,
      );
      await expect(rawMatch({ seed: -1 })).rejects.toThrow(/matches_seed_check/);
      await expect(rawMatch({ seed: 4294967296 })).rejects.toThrow(/matches_seed_check/);
      await expect(rawMatch({ ended: '2026-11-01T11:59:00Z' })).rejects.toThrow(
        /matches_period_check/,
      );
      await rawMatch({ status: 'cancelled', winner: null });
      const [m] = await db().$queryRaw<{ id: string }[]>`SELECT id FROM matches`;
      const player = (seat: number, team: number, bot: number | null): Promise<number> =>
        db().$executeRaw`INSERT INTO match_players (match_id, seat, user_id, team, bot_from)
          VALUES (${m?.id}::uuid, ${seat}::smallint, ${a.id}::uuid, ${team}::smallint, ${bot})`;
      await expect(player(4, 0, null)).rejects.toThrow(/match_players_seat_check/);
      await expect(player(1, 0, null)).rejects.toThrow(/match_players_team_check/);
      await expect(player(0, 0, -1)).rejects.toThrow(/match_players_bot_from_check/);
      await player(0, 0, null);
      await expect(player(0, 0, null)).rejects.toThrow(/match_players_pkey/);
      expect(await db().match.count()).toBe(1);
    });

    it('PARIDADE: o mesmo conjunto de entradas inválidas é recusado com InvalidInputError, sem gravar nada', async () => {
      const a = await guest('Ana');
      const valid = matchInput([a.id, null, null, null], new Date('2026-11-01T12:00:00Z'));
      for (const { name, input } of invalidMatchCases(
        valid,
        a.id,
        '00000000-0000-4000-8000-000000000000',
      )) {
        await expect(matches.saveMatch(input), name).rejects.toBeInstanceOf(InvalidInputError);
      }
      expect(await db().match.count()).toBe(0);
      expect(await db().matchPlayer.count()).toBe(0);
      await matches.saveMatch(valid);
      expect(await db().match.count()).toBe(1);
    });

    it('userId inexistente é recusado pela FK mesmo sem a checagem do repositório', async () => {
      const ghost = '00000000-0000-4000-8000-000000000000';
      await expect(
        guarded(() =>
          db().match.create({
            data: {
              variant: 'paulista',
              format: 'single',
              ironHand: false,
              visibility: 'public',
              seed: 1n,
              options: {},
              events: [],
              games: [],
              status: 'cancelled',
              startedAt: new Date(),
              endedAt: new Date(),
              players: { create: [{ seat: 0, userId: ghost, team: 0 }] },
            },
          }),
        ),
      ).rejects.toBeInstanceOf(InvalidInputError);
    });

    it('erro do banco é saneado: sem meta, detail nem o conteúdo de deals; nome da constraint preservado', async () => {
      const marker = 'MAO-SECRETA-4C-7H-ZAP';
      const create = (): Promise<unknown> =>
        db().match.create({
          data: {
            variant: 'paulista',
            format: 'single',
            ironHand: false,
            visibility: 'public',
            seed: 1n,
            options: {},
            events: [],
            games: [],
            deals: [{ hand: 1, cards: [marker] }],
            status: 'finished',
            winnerTeam: null,
            startedAt: new Date(),
            endedAt: new Date(),
          },
        });
      // Prova de que o teste é significativo: o erro BRUTO carrega a linha inteira.
      const raw: unknown = await create().catch((error: unknown) => error);
      expect(JSON.stringify(raw)).toContain(marker);
      expect(constraintNameOf(raw)).toBe('matches_status_winner_check');

      const clean: unknown = await guarded(create).catch((error: unknown) => error);
      expect(clean).toBeInstanceOf(InvalidInputError);
      const err = clean as InvalidInputError;
      expect(err.constraint).toBe('matches_status_winner_check');
      const everything = [
        err.message,
        err.stack ?? '',
        JSON.stringify(err),
        ...Object.getOwnPropertyNames(err).map((k) => String(Reflect.get(err, k))),
      ].join('\n');
      expect(everything).not.toContain(marker);
      expect(everything).not.toContain('Failing row');
      expect(Reflect.get(err, 'meta')).toBeUndefined();
      expect(Reflect.get(err, 'cause')).toBeUndefined();
    });

    it('tetos de tamanho dos jsonb de matches (SQL direto)', async () => {
      const big = (col: string, bytes: number): Promise<number> =>
        db().$executeRawUnsafe(
          `INSERT INTO matches (id, variant, format, iron_hand, visibility, seed, options, events,
                                games, deals, status, winner_team, started_at, ended_at)
           SELECT gen_random_uuid(), 'paulista', 'single', false, 'public', 1,
                  ${col === 'options' ? `jsonb_build_object('k', repeat('x', ${bytes}))` : "'{}'"},
                  ${col === 'events' ? `jsonb_build_array(repeat('x', ${bytes}))` : "'[]'"},
                  ${col === 'games' ? `jsonb_build_array(repeat('x', ${bytes}))` : "'[]'"},
                  ${col === 'deals' ? `jsonb_build_array(repeat('x', ${bytes}))` : 'NULL'},
                  'finished', 0, now(), now()`,
        );
      await expect(big('options', 20_000)).rejects.toThrow(/matches_options_size_check/);
      await expect(big('games', 70_000)).rejects.toThrow(/matches_games_size_check/);
      await expect(big('deals', 1_100_000)).rejects.toThrow(/matches_deals_size_check/);
      await expect(big('events', 2_200_000)).rejects.toThrow(/matches_events_size_check/);
      await big('events', 1_900_000);
      await big('deals', 900_000);
    });

    it('todo id que não é UUID vira InvalidInputError (nunca P2007 cru); MAIÚSCULAS são normalizadas', async () => {
      const a = await guest('Ana');
      const b = await guest('Beto');
      for (const id of ['xyz', '', 'nao-uuid', `${a.id}x`]) {
        await expect(users.findById(id), id).rejects.toBeInstanceOf(InvalidInputError);
        await expect(users.addBlock(a.id, id), id).rejects.toBeInstanceOf(InvalidInputError);
        await expect(users.removeBlock(id, a.id), id).rejects.toBeInstanceOf(InvalidInputError);
        await expect(users.getPartnerCodes(a.id, id), id).rejects.toBeInstanceOf(InvalidInputError);
        await expect(users.havePlayedTogether(a.id, id), id).rejects.toBeInstanceOf(
          InvalidInputError,
        );
        await expect(matches.listForUser(id), id).rejects.toBeInstanceOf(InvalidInputError);
        await expect(
          users.createReport({ reporterId: a.id, reportedId: b.id, matchId: id, reason: 'other' }),
        ).rejects.toBeInstanceOf(InvalidInputError);
      }
      expect((await users.findById(a.id.toUpperCase()))?.nickname).toBe('Ana');
      await users.addBlock(a.id.toUpperCase(), b.id.toUpperCase());
      expect(await users.listBlockedIds(a.id.toUpperCase())).toEqual([b.id]);
      await expect(users.addBlock(a.id, a.id.toUpperCase())).rejects.toBeInstanceOf(
        InvalidInputError,
      );
    });

    it('remover usuário preserva o histórico (SetNull) e leva só os dados pessoais (Cascade)', async () => {
      const a = await guest('Ana');
      const b = await guest('Beto');
      const matchId = await matches.saveMatch(
        matchInput([a.id, b.id, null, null], new Date('2026-11-01T12:00:00Z')),
      );
      await users.saveAvatar(a.id, DEFAULT_AVATAR_PARTS);
      await users.addBlock(a.id, b.id);
      await users.addBlock(b.id, a.id);
      const [lo, hi] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
      await db().partnerCodes.create({ data: { userAId: lo, userBId: hi, codes: {} } });
      const report = await users.createReport({
        reporterId: b.id,
        reportedId: a.id,
        matchId,
        reason: 'abusive_chat',
        text: 'texto',
      });

      await db().user.delete({ where: { id: a.id } });

      expect(await db().match.count()).toBe(1);
      const seats = await db().matchPlayer.findMany({ orderBy: { seat: 'asc' } });
      expect(seats).toHaveLength(4);
      expect(seats[0]?.userId).toBeNull();
      expect(seats[1]?.userId).toBe(b.id);
      const r = await db().report.findUniqueOrThrow({ where: { id: report.id } });
      expect(r.reportedId).toBeNull();
      expect(r.reporterId).toBe(b.id);
      expect(await db().avatar.count()).toBe(0);
      expect(await db().block.count()).toBe(0);
      expect(await db().partnerCodes.count()).toBe(0);
      // O histórico de B ainda lista a partida, com o assento de A anonimizado.
      const page = await matches.listForUser(b.id);
      expect(page.items[0]?.players[0]).toMatchObject({ seat: 0, userId: null, nickname: null });

      // Apagar a partida leva os jogadores (Cascade) e anula a denúncia (SetNull).
      await db().match.delete({ where: { id: matchId } });
      expect(await db().matchPlayer.count()).toBe(0);
      expect(
        (await db().report.findUniqueOrThrow({ where: { id: report.id } })).matchId,
      ).toBeNull();
    });
  });

  describe('reports', () => {
    it('texto até 500 caracteres, sem auto-denúncia, entra como open', async () => {
      const a = await guest('Ana');
      const b = await guest('Beto');
      const ok = await users.createReport({
        reporterId: a.id,
        reportedId: b.id,
        reason: 'cheating',
        text: 'y'.repeat(500),
      });
      expect(ok.status).toBe('open');
      await expect(
        users.createReport({
          reporterId: a.id,
          reportedId: b.id,
          reason: 'other',
          text: 'y'.repeat(501),
        }),
      ).rejects.toBeInstanceOf(InvalidInputError);
      await expect(
        users.createReport({ reporterId: a.id, reportedId: a.id, reason: 'other' }),
      ).rejects.toBeInstanceOf(InvalidInputError);
      await expect(
        db().$executeRawUnsafe(
          `INSERT INTO reports (id, reporter_id, reported_id, reason)
           VALUES (gen_random_uuid(), '${a.id}', '${a.id}', 'other')`,
        ),
      ).rejects.toThrow(/reports_not_self_check/);
    });
  });

  describe('GET /matches (paginação)', () => {
    it('ordem por data decrescente, cursor estável com empate, só partidas do usuário', async () => {
      const a = await guest('Ana');
      const b = await guest('Beto');
      const base = new Date('2026-11-01T12:00:00Z').getTime();
      const expected: string[] = [];
      // 5 partidas de A; as duas mais antigas terminam no mesmo instante (empate resolvido pelo id).
      for (const minutes of [0, 0, 10, 20, 30]) {
        expected.push(
          await matches.saveMatch(
            matchInput([a.id, b.id, null, null], new Date(base + minutes * 60_000)),
          ),
        );
      }
      await matches.saveMatch(matchInput([b.id, null, null, null], new Date(base + 99 * 60_000)));
      const sorted = (
        await db().match.findMany({
          where: { players: { some: { userId: a.id } } },
          orderBy: [{ endedAt: 'desc' }, { id: 'desc' }],
          select: { id: true },
        })
      ).map((m) => m.id);
      expect(sorted).toHaveLength(5);

      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = await matches.listForUser(
          a.id,
          cursor === undefined ? { limit: 2 } : { limit: 2, cursor },
        );
        seen.push(...page.items.map((m) => m.id));
        cursor = page.nextCursor ?? undefined;
        pages += 1;
      } while (cursor !== undefined && pages < 10);
      expect(pages).toBe(3);
      expect(seen).toEqual(sorted);
      expect(new Set(seen).size).toBe(5);
      expect(new Set(seen)).toEqual(new Set(expected));
    });

    it('cursor inválido e limite inválido são InvalidInputError; limite é truncado em 50', async () => {
      const a = await guest('Ana');
      await expect(matches.listForUser(a.id, { cursor: 'lixo' })).rejects.toBeInstanceOf(
        InvalidInputError,
      );
      await expect(matches.listForUser(a.id, { limit: 0 })).rejects.toBeInstanceOf(
        InvalidInputError,
      );
      expect((await matches.listForUser(a.id, { limit: 500 })).items).toEqual([]);
    });

    it('o SQL REAL de listForUser (capturado do client) pode usar o índice de match_players', async () => {
      const a = await guest('Ana');
      await db().$executeRawUnsafe(
        `INSERT INTO matches (id, variant, format, iron_hand, visibility, seed, options, events, games,
                              status, winner_team, started_at, ended_at)
         SELECT gen_random_uuid(), 'paulista', 'single', false, 'public', 1, '{}', '[]', '[]',
                'finished', 0, now() - make_interval(mins => g + 1), now() - make_interval(mins => g)
           FROM generate_series(1, 3000) g`,
      );
      await db().$executeRawUnsafe(
        `INSERT INTO match_players (match_id, seat, user_id, team)
         SELECT id, 0, '${a.id}'::uuid, 0 FROM matches ORDER BY ended_at DESC LIMIT 100`,
      );
      await db().$executeRawUnsafe('ANALYZE matches, match_players');

      // Segundo client, só para capturar o SQL que o Prisma gera para listForUser.
      const captured: { query: string; params: string }[] = [];
      const spy = new PrismaClient({
        adapter: new PrismaPg({ connectionString: assertSafeTestDatabaseUrl(url), max: 2 }),
        log: [{ emit: 'event', level: 'query' }],
      });
      spy.$on('query', (e) => captured.push({ query: e.query, params: e.params }));
      try {
        await new PrismaMatchRepository(spy).listForUser(a.id, { limit: 20 });
      } finally {
        await spy.$disconnect();
      }
      const main = captured.find(
        (c) => /FROM "public"\."matches"/.test(c.query) && c.query.includes('match_players'),
      );
      expect(main, captured.map((c) => c.query).join('\n')).toBeDefined();
      const params = JSON.parse(main?.params ?? '[]') as unknown[];

      // Com tabelas pequenas o planejador prefere Seq Scan; desligá-lo na transação prova que o
      // índice existe e é aplicável ao SQL real (não prova a escolha do planejador em produção).
      const text = await db().$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
        const plan = await tx.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
          `EXPLAIN ${main?.query ?? ''}`,
          ...params,
        );
        return plan.map((r) => r['QUERY PLAN']).join('\n');
      });
      expect(text).toContain('match_players_user_id_match_id_idx');
      expect(text).not.toMatch(/Seq Scan on match_players/);
    });
  });
});
