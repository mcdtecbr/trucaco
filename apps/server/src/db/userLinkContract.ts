import { describe, expect, it } from 'vitest';
import {
  InvalidInputError,
  NicknameTakenError,
  ProviderSubjectTakenError,
  type FinishedMatchInput,
  type MatchRepository,
  type UserRepository,
} from './types';

/**
 * Contrato de `createSocialUser` e `linkProvider` (6F): roda contra a memória SEMPRE (`userLink.test.ts`)
 * e contra o Postgres quando há `TEST_DATABASE_URL` (`userLink.int.test.ts`).
 */
export interface UserLinkHarness {
  readonly users: UserRepository;
  readonly matches: MatchRepository;
  reset(): Promise<void>;
}

const GHOST = '00000000-0000-4000-8000-000000000000';

export function userLinkContract(name: string, harness: () => UserLinkHarness): void {
  describe(`vínculo de conta social: ${name}`, () => {
    let h: UserLinkHarness;
    let seq = 0;
    const setup = async (): Promise<void> => {
      await harness().reset();
      h = harness();
    };
    const guest = (nick: string) =>
      h.users.createGuest({ providerSubject: `g-${++seq}-${nick}`, nickname: nick });

    it('createSocialUser: conta com provider e sub, sem linkedAt; findByProvider a acha', async () => {
      await setup();
      const u = await h.users.createSocialUser({
        provider: 'google',
        providerSubject: 'sub-1',
        nickname: 'Social1',
      });
      expect(u).toMatchObject({ provider: 'google', providerSubject: 'sub-1', linkedAt: null });
      expect((await h.users.findByProvider('google', 'sub-1'))?.id).toBe(u.id);
      expect(await h.users.findByProvider('apple', 'sub-1')).toBeNull();
    });

    it('createSocialUser: sub repetido no provedor, apelido repetido (sem caixa) e sub inválido', async () => {
      await setup();
      await h.users.createSocialUser({
        provider: 'google',
        providerSubject: 'dup',
        nickname: 'Original',
      });
      await expect(
        h.users.createSocialUser({
          provider: 'google',
          providerSubject: 'dup',
          nickname: 'Outro1',
        }),
      ).rejects.toBeInstanceOf(ProviderSubjectTakenError);
      await expect(
        h.users.createSocialUser({ provider: 'apple', providerSubject: 'x', nickname: 'ORIGINAL' }),
      ).rejects.toBeInstanceOf(NicknameTakenError);
      // o mesmo sub em outro provedor são contas distintas
      await expect(
        h.users.createSocialUser({ provider: 'apple', providerSubject: 'dup', nickname: 'Outro2' }),
      ).resolves.toBeDefined();
      await expect(
        h.users.createSocialUser({ provider: 'apple', providerSubject: '', nickname: 'Outro3' }),
      ).rejects.toBeInstanceOf(InvalidInputError);
    });

    it('linkProvider: o convidado vira social mantendo o id; linkedAt gravado; o sub antigo some', async () => {
      await setup();
      const g = await guest('Convid1');
      const before = Date.now() - 1000;
      const linked = await h.users.linkProvider(g.id.toUpperCase(), 'apple', 'apple-sub');
      expect(linked).toMatchObject({
        id: g.id,
        nickname: 'Convid1',
        provider: 'apple',
        providerSubject: 'apple-sub',
      });
      expect(linked?.linkedAt?.getTime()).toBeGreaterThan(before);
      expect((await h.users.findByProvider('apple', 'apple-sub'))?.id).toBe(g.id);
      expect(await h.users.findByProvider('guest', g.providerSubject)).toBeNull();
      expect((await h.users.findById(g.id))?.provider).toBe('apple');
    });

    it('linkProvider: quem já não é convidado, inexistente: null; id inválido: InvalidInputError', async () => {
      await setup();
      const g = await guest('Convid2');
      await h.users.linkProvider(g.id, 'google', 'a');
      expect(await h.users.linkProvider(g.id, 'apple', 'b')).toBeNull();
      expect((await h.users.findById(g.id))?.provider).toBe('google');
      expect(await h.users.findByProvider('apple', 'b')).toBeNull();
      const social = await h.users.createSocialUser({
        provider: 'apple',
        providerSubject: 'nasceu',
        nickname: 'Nativo1',
      });
      expect(await h.users.linkProvider(social.id, 'google', 'c')).toBeNull();
      expect(await h.users.linkProvider(GHOST, 'google', 'd')).toBeNull();
      await expect(h.users.linkProvider('nao-e-uuid', 'google', 'e')).rejects.toBeInstanceOf(
        InvalidInputError,
      );
      await expect(h.users.linkProvider(g.id, 'google', '')).rejects.toBeInstanceOf(
        InvalidInputError,
      );
    });

    it('linkProvider: sub de outra conta é ProviderSubjectTakenError e o convidado fica intacto', async () => {
      await setup();
      await h.users.createSocialUser({
        provider: 'google',
        providerSubject: 'ocupado',
        nickname: 'Dono01',
      });
      const g = await guest('Convid3');
      await expect(h.users.linkProvider(g.id, 'google', 'ocupado')).rejects.toBeInstanceOf(
        ProviderSubjectTakenError,
      );
      const after = await h.users.findById(g.id);
      expect(after).toMatchObject({ provider: 'guest', providerSubject: g.providerSubject });
      expect(after?.linkedAt).toBeNull();
      // o mesmo sub em OUTRO provedor está livre
      expect(await h.users.linkProvider(g.id, 'apple', 'ocupado')).not.toBeNull();
    });

    it('corrida: N convidados no mesmo sub, só UM vincula; os demais ProviderSubjectTakenError', async () => {
      await setup();
      const gs = await Promise.all([
        guest('Corr01'),
        guest('Corr02'),
        guest('Corr03'),
        guest('Corr04'),
      ]);
      const results = await Promise.allSettled(
        gs.map((g) => h.users.linkProvider(g.id, 'google', 'disputado')),
      );
      expect(results.filter((r) => r.status === 'fulfilled' && r.value !== null)).toHaveLength(1);
      const failed = results.filter((r) => r.status === 'rejected');
      expect(failed).toHaveLength(3);
      for (const r of failed) {
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ProviderSubjectTakenError);
      }
      expect((await h.users.findByProvider('google', 'disputado'))?.id).toBeDefined();
      let guests = 0;
      for (const g of gs) if ((await h.users.findById(g.id))?.provider === 'guest') guests++;
      expect(guests).toBe(3);
    });

    it('corrida: o mesmo convidado em dois provedores, só UM vale (o outro devolve null)', async () => {
      await setup();
      const g = await guest('Corr05');
      const [a, b] = await Promise.all([
        h.users.linkProvider(g.id, 'google', 'um'),
        h.users.linkProvider(g.id, 'apple', 'dois'),
      ]);
      expect([a, b].filter((r) => r !== null)).toHaveLength(1);
      const after = await h.users.findById(g.id);
      const winner = a ?? b;
      expect(after?.provider).toBe(winner?.provider);
      // não ficou registro do perdedor
      const loserProvider = winner?.provider === 'google' ? 'apple' : 'google';
      const loserSub = winner?.provider === 'google' ? 'dois' : 'um';
      expect(await h.users.findByProvider(loserProvider, loserSub)).toBeNull();
    });

    it('o histórico segue o id: partida gravada antes do vínculo continua listada', async () => {
      await setup();
      const g = await guest('Hist01');
      const others = await Promise.all([guest('Hist02'), guest('Hist03'), guest('Hist04')]);
      const endedAt = new Date('2026-11-01T12:00:00Z');
      const input: FinishedMatchInput = {
        variant: 'paulista',
        format: 'single',
        ironHand: false,
        visibility: 'public',
        roomCode: null,
        seed: 1,
        options: {},
        events: [],
        deals: null,
        winnerTeam: 0,
        games: [[12, 3]],
        status: 'finished',
        startedAt: new Date(endedAt.getTime() - 60_000),
        endedAt,
        players: [g, ...others].map((u, seat) => ({
          seat,
          userId: u.id,
          team: seat % 2 === 0 ? 0 : 1,
          botFrom: null,
        })),
      };
      await h.matches.saveMatch(input);
      await h.users.linkProvider(g.id, 'google', 'hist');
      const page = await h.matches.listForUser(g.id);
      expect(page.items).toHaveLength(1);
      expect(page.items[0]?.players[0]).toMatchObject({ userId: g.id, nickname: 'Hist01' });
    });
  });
}
