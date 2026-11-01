import { SIGNAL_IDS } from '@trucaco/protocol';
import { describe, expect, it } from 'vitest';
import { createMemoryRepositories } from './memoryRepositories';
import { invalidMatchCases } from './parityCases';
import {
  InvalidInputError,
  NicknameTakenError,
  NotPartnersError,
  type FinishedMatchInput,
  type JsonObject,
  type PartnerCodesMap,
} from './types';
import {
  decodeCursor,
  encodeCursor,
  normalizeId,
  normalizeNickname,
  orderPair,
  validateNickname,
} from './validation';

const GHOST = '00000000-0000-4000-8000-000000000000';

const match = (
  userId: string,
  endedAt: Date,
  overrides: Partial<FinishedMatchInput> = {},
): FinishedMatchInput => ({
  variant: 'mineiro',
  format: 'single',
  ironHand: true,
  visibility: 'private',
  roomCode: null,
  seed: 7,
  options: {},
  events: [],
  deals: null,
  winnerTeam: null,
  games: [],
  status: 'cancelled',
  startedAt: endedAt,
  endedAt,
  players: [{ seat: 0, userId, team: 0, botFrom: null }],
  ...overrides,
});

const finished = (a: string, b: string, c: string | null, d: string | null): FinishedMatchInput =>
  match(a, new Date('2026-11-01T12:00:00Z'), {
    status: 'finished',
    winnerTeam: 0,
    players: [a, c, b, d].map((userId, seat) => ({
      seat,
      userId,
      team: seat % 2 === 0 ? 0 : 1,
      botFrom: null,
    })),
  });

describe('repositórios em memória (espelham as regras do SQL)', () => {
  it('updateNickname: troca, repete só o próprio, 409 sem diferenciar caixa e usuário inexistente', async () => {
    const { users } = createMemoryRepositories();
    const a = await users.createGuest({ providerSubject: 's1', nickname: 'Gil' });
    const b = await users.createGuest({ providerSubject: 's2', nickname: 'Hugo' });
    await users.updateNickname(a.id, 'Gilberto');
    expect((await users.findById(a.id))?.nickname).toBe('Gilberto');
    await users.updateNickname(a.id, 'gilberto');
    await expect(users.updateNickname(b.id, 'GILBERTO')).rejects.toBeInstanceOf(NicknameTakenError);
    await expect(users.updateNickname(b.id, 'a b')).rejects.toBeInstanceOf(InvalidInputError);
    await expect(users.updateNickname(GHOST, 'Fantasma')).rejects.toBeInstanceOf(InvalidInputError);
  });

  it('apelido único sem diferenciar caixa, tamanho e provider', async () => {
    const { users } = createMemoryRepositories();
    const ana = await users.createGuest({ providerSubject: 's1', nickname: 'Ana' });
    await expect(
      users.createGuest({ providerSubject: 's2', nickname: 'ana' }),
    ).rejects.toBeInstanceOf(NicknameTakenError);
    await expect(
      users.createGuest({ providerSubject: 's3', nickname: 'ab' }),
    ).rejects.toBeInstanceOf(InvalidInputError);
    expect(await users.findByProvider('guest', 's1')).toEqual(ana);
    expect(await users.findByProvider('google', 's1')).toBeNull();
  });

  it('apelido NFD é gravado em NFC e colide com o NFC', async () => {
    const { users } = createMemoryRepositories();
    const joao = await users.createGuest({ providerSubject: 's1', nickname: 'João' });
    expect(joao.nickname).toBe('João');
    await expect(
      users.createGuest({ providerSubject: 's2', nickname: 'joão' }),
    ).rejects.toBeInstanceOf(NicknameTakenError);
  });

  it('vínculo de dupla: só quem jogou junto (mesma dupla, partida finalizada) grava códigos', async () => {
    const { users, matches } = createMemoryRepositories();
    const a = await users.createGuest({ providerSubject: 'a', nickname: 'Ana' });
    const b = await users.createGuest({ providerSubject: 'b', nickname: 'Beto' });
    const c = await users.createGuest({ providerSubject: 'c', nickname: 'Caio' });
    await expect(users.havePlayedTogether(a.id, b.id)).resolves.toBe(false);
    await expect(users.savePartnerCodes(a.id, b.id, {})).rejects.toBeInstanceOf(NotPartnersError);
    // Adversários (a e c em duplas diferentes) e partida cancelada não contam.
    await matches.saveMatch(finished(a.id, b.id, c.id, null));
    await matches.saveMatch(
      match(a.id, new Date('2026-11-01T13:00:00Z'), {
        players: [
          { seat: 0, userId: a.id, team: 0, botFrom: null },
          { seat: 2, userId: c.id, team: 0, botFrom: null },
        ],
      }),
    );
    await expect(users.havePlayedTogether(a.id, b.id)).resolves.toBe(true);
    await expect(users.havePlayedTogether(b.id, a.id)).resolves.toBe(true);
    await expect(users.havePlayedTogether(a.id, c.id)).resolves.toBe(false);
    await expect(users.havePlayedTogether(b.id, c.id)).resolves.toBe(false);
    await expect(users.savePartnerCodes(a.id, c.id, {})).rejects.toBeInstanceOf(NotPartnersError);
    await users.savePartnerCodes(a.id, b.id, { wink: 'zap' });
    expect(await users.getPartnerCodes(b.id, a.id)).toEqual({ wink: 'zap' });
  });

  it('códigos: só signalId do catálogo, valor até 140 caracteres; bloqueio idempotente', async () => {
    const { users, matches } = createMemoryRepositories();
    const a = await users.createGuest({ providerSubject: 'a', nickname: 'Ana' });
    const b = await users.createGuest({ providerSubject: 'b', nickname: 'Beto' });
    await matches.saveMatch(finished(a.id, b.id, null, null));
    const all = Object.fromEntries(SIGNAL_IDS.map((id) => [id, 'x'.repeat(140)]));
    await users.savePartnerCodes(a.id, b.id, all);
    const badCodes: PartnerCodesMap[] = [
      { wink: 'x'.repeat(141) },
      { naoExiste: 'x' },
      JSON.parse('{"__proto__":"x"}') as PartnerCodesMap,
      { '': 'x' },
      { ...all, extra: 'x' },
    ];
    for (const bad of badCodes) {
      await expect(users.savePartnerCodes(a.id, b.id, bad)).rejects.toBeInstanceOf(
        InvalidInputError,
      );
    }
    await expect(users.addBlock(a.id, a.id)).rejects.toBeInstanceOf(InvalidInputError);
    await users.addBlock(a.id, b.id);
    await users.addBlock(a.id, b.id.toUpperCase());
    expect(await users.listBlockedIds(a.id)).toEqual([b.id]);
    expect(await users.listBlockerIds(b.id)).toEqual([a.id]);
  });

  it('avatar: objeto plano, poucas chaves, valores escalares curtos', async () => {
    const { users } = createMemoryRepositories();
    const a = await users.createGuest({ providerSubject: 'a', nickname: 'Ana' });
    await users.saveAvatar(a.id, { skin: 1, hat: 'cap', glasses: null, beard: false });
    expect(await users.getAvatar(a.id)).toEqual({
      skin: 1,
      hat: 'cap',
      glasses: null,
      beard: false,
    });
    const many = Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`k${i}`, 1]));
    const badParts: JsonObject[] = [
      many,
      { hat: 'x'.repeat(141) },
      { nested: { a: 1 } },
      { list: [1] },
    ];
    for (const bad of badParts) {
      await expect(users.saveAvatar(a.id, bad)).rejects.toBeInstanceOf(InvalidInputError);
    }
    await expect(users.saveAvatar(GHOST, { skin: 1 })).rejects.toBeInstanceOf(InvalidInputError);
  });

  it('todo id de entrada é UUID, normalizado para minúsculas; o resto é InvalidInputError', async () => {
    const { users, matches } = createMemoryRepositories();
    const a = await users.createGuest({ providerSubject: 'a', nickname: 'Ana' });
    const b = await users.createGuest({ providerSubject: 'b', nickname: 'Beto' });
    expect((await users.findById(a.id.toUpperCase()))?.id).toBe(a.id);
    const bad = ['xyz', '', ' ', a.id + 'x', `${a.id}\n`];
    for (const id of bad) {
      await expect(users.findById(id)).rejects.toBeInstanceOf(InvalidInputError);
      await expect(users.touchLastSeen(id, new Date())).rejects.toBeInstanceOf(InvalidInputError);
      await expect(users.getAvatar(id)).rejects.toBeInstanceOf(InvalidInputError);
      await expect(users.saveAvatar(id, {})).rejects.toBeInstanceOf(InvalidInputError);
      await expect(users.addBlock(a.id, id)).rejects.toBeInstanceOf(InvalidInputError);
      await expect(users.addBlock(id, a.id)).rejects.toBeInstanceOf(InvalidInputError);
      await expect(users.removeBlock(a.id, id)).rejects.toBeInstanceOf(InvalidInputError);
      await expect(users.listBlockedIds(id)).rejects.toBeInstanceOf(InvalidInputError);
      await expect(users.listBlockerIds(id)).rejects.toBeInstanceOf(InvalidInputError);
      await expect(users.getPartnerCodes(a.id, id)).rejects.toBeInstanceOf(InvalidInputError);
      await expect(users.savePartnerCodes(a.id, id, {})).rejects.toBeInstanceOf(InvalidInputError);
      await expect(users.havePlayedTogether(id, a.id)).rejects.toBeInstanceOf(InvalidInputError);
      await expect(
        users.createReport({ reporterId: a.id, reportedId: id, reason: 'other' }),
      ).rejects.toBeInstanceOf(InvalidInputError);
      await expect(
        users.createReport({ reporterId: a.id, reportedId: b.id, matchId: id, reason: 'other' }),
      ).rejects.toBeInstanceOf(InvalidInputError);
      await expect(matches.listForUser(id)).rejects.toBeInstanceOf(InvalidInputError);
    }
    expect(normalizeId(a.id.toUpperCase())).toBe(a.id);
  });

  it('saveMatch recusa o que o banco recusa (conjunto de paridade com o Postgres)', async () => {
    const { users, matches } = createMemoryRepositories();
    const a = await users.createGuest({ providerSubject: 'a', nickname: 'Ana' });
    const valid = finished(a.id, a.id, null, null);
    const cases = invalidMatchCases(valid, a.id, GHOST);
    expect(cases.length).toBeGreaterThanOrEqual(16);
    for (const { name, input } of cases) {
      await expect(matches.saveMatch(input), name).rejects.toBeInstanceOf(InvalidInputError);
    }
    await expect(matches.saveMatch(valid)).resolves.toMatch(/^[0-9a-f-]{36}$/);
  });

  it('listForUser pagina por (endedAt, id) sem repetir', async () => {
    const { users, matches } = createMemoryRepositories();
    const a = await users.createGuest({ providerSubject: 'a', nickname: 'Ana' });
    for (let i = 0; i < 5; i += 1) {
      await matches.saveMatch(match(a.id, new Date(Date.UTC(2026, 10, 1, 12, i % 4))));
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await matches.listForUser(
        a.id,
        cursor === undefined ? { limit: 2 } : { limit: 2, cursor },
      );
      seen.push(...page.items.map((m) => m.id));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    expect(new Set(seen).size).toBe(5);
    await expect(matches.listForUser(a.id, { cursor: 'x' })).rejects.toBeInstanceOf(
      InvalidInputError,
    );
  });

  it('helpers: cursor faz ida e volta; orderPair ordena e recusa par consigo', () => {
    const id = '5f3ccbc1-d058-48c3-bc58-213c2398460a';
    const id2 = '6f3ccbc1-d058-48c3-bc58-213c2398460a';
    const at = new Date('2026-11-01T12:00:00.123Z');
    expect(decodeCursor(encodeCursor({ endedAt: at, id }))).toEqual({ endedAt: at, id });
    expect(orderPair(id2.toUpperCase(), id)).toEqual([id, id2]);
    expect(() => orderPair(id, id.toUpperCase())).toThrow(InvalidInputError);
    expect(() => orderPair('b', 'a')).toThrow(InvalidInputError);
  });
});

describe('política de apelido (espelha os CHECKs do Postgres)', () => {
  it.each(['João', 'Zé_da-Silva', 'Ana.B', 'Ágil', 'Joao', 'abc', 'Çedilha9', 'a'.repeat(16)])(
    'aceita %s',
    (nick) => {
      expect(validateNickname(nick)).toBe(nick.normalize('NFC'));
    },
  );

  it.each([
    ['espaço invisível (zero-width)', 'Jo​ao'],
    ['o cirílico', 'Jоao'],
    ['grego', 'Ωmega'],
    ['bidi (RLO)', '‮oaoJ'],
    ['espaço no fim', 'Joao '],
    ['espaço no meio', 'Jo ao'],
    ['espaço sem quebra', 'Jo ao'],
    ['tab', 'Jo\tao'],
    ['quebra de linha', 'Joao\n'],
    ['controle', 'Jo\u0000ao'],
    ['multiplicação', 'a×b'],
    ['divisão', 'a÷b'],
    ['emoji', 'Joao\u{1F600}'],
    ['combinante sem composição', 'aͅbc'],
    ['curto', 'ab'],
    ['longo', 'a'.repeat(17)],
    ['vazio', ''],
  ])('recusa %s', (_name, nick) => {
    expect(() => validateNickname(nick)).toThrow(InvalidInputError);
  });

  it('normaliza NFD para NFC antes de validar e de contar', () => {
    const nfd = 'João';
    expect(nfd).not.toBe('João');
    expect(normalizeNickname(nfd)).toBe('João');
    expect(validateNickname(nfd)).toBe('João');
    // 16 letras acentuadas em NFD são 32 code points, mas 16 depois do NFC.
    expect(validateNickname('á'.repeat(16))).toBe('á'.repeat(16));
  });
});
