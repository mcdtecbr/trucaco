import { describe, expect, it } from 'vitest';
import { createMemoryRepositories } from './memoryRepositories';
import { InvalidInputError, NicknameTakenError, type FinishedMatchInput } from './types';
import { decodeCursor, encodeCursor, orderPair } from './validation';

const match = (userId: string, endedAt: Date): FinishedMatchInput => ({
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
});

describe('repositórios em memória (espelham as regras do SQL)', () => {
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

  it('par de códigos é simétrico, bloqueio é validado e idempotente', async () => {
    const { users } = createMemoryRepositories();
    const a = await users.createGuest({ providerSubject: 'a', nickname: 'Ana' });
    const b = await users.createGuest({ providerSubject: 'b', nickname: 'Beto' });
    await users.savePartnerCodes(a.id, b.id, { s1: 'zap' });
    expect(await users.getPartnerCodes(b.id, a.id)).toEqual({ s1: 'zap' });
    await expect(
      users.savePartnerCodes(a.id, b.id, { s1: 'x'.repeat(141) }),
    ).rejects.toBeInstanceOf(InvalidInputError);
    await expect(users.addBlock(a.id, a.id)).rejects.toBeInstanceOf(InvalidInputError);
    await users.addBlock(a.id, b.id);
    await users.addBlock(a.id, b.id);
    expect(await users.listBlockedIds(a.id)).toEqual([b.id]);
    expect(await users.listBlockerIds(b.id)).toEqual([a.id]);
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
    const at = new Date('2026-11-01T12:00:00.123Z');
    expect(decodeCursor(encodeCursor({ endedAt: at, id }))).toEqual({ endedAt: at, id });
    expect(orderPair('b', 'a')).toEqual(['a', 'b']);
    expect(() => orderPair('a', 'A')).toThrow(InvalidInputError);
  });
});
