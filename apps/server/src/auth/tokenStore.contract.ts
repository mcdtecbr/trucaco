/**
 * Bateria de contrato do `TokenStore`: roda igual contra a implementação em memória e contra o Redis
 * real (`redisTokenStore.int.test.ts`). Garante a mesma semântica nas duas.
 */
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { TokenStore } from './tokenStore';

const hex = (): string => randomUUID().replaceAll('-', '').repeat(2);

/** Relógio da bateria: tempo real mais um deslocamento controlável (a graça e o teto usam este relógio). */
export interface TestClock {
  now: () => number;
  advance: (ms: number) => void;
}

export function tokenStoreContract(name: string, make: (clock: () => number) => TokenStore): void {
  describe(`TokenStore (${name})`, () => {
    const opened: TokenStore[] = [];
    let offset = 0;
    const clock: TestClock = {
      now: () => Date.now() + offset,
      advance: (ms) => {
        offset += ms;
      },
    };
    const fresh = (): TokenStore => {
      const store = make(clock.now);
      opened.push(store);
      return store;
    };
    afterEach(async () => {
      offset = 0;
      for (const store of opened.splice(0)) await store.close();
    });

    const family = async (store: TokenStore, ttlSec = 60) => {
      const input = {
        familyId: randomUUID(),
        userId: randomUUID(),
        refreshHash: hex(),
        jti: randomUUID(),
        ttlSec,
      };
      await store.createFamily(input);
      return input;
    };
    const rot = (
      store: TokenStore,
      from: string,
      jti = randomUUID(),
      ttlSec = 60,
      graceSec = 0,
      familyMaxSec = 7_776_000,
    ) => {
      const to = hex();
      return {
        to,
        jti,
        run: () =>
          store.rotate({
            refreshHash: from,
            newRefreshHash: to,
            newJti: jti,
            ttlSec,
            graceSec,
            familyMaxSec,
          }),
      };
    };

    it('peekLive: vivo sem efeito colateral; usado, revogado e desconhecido dão null', async () => {
      const store = fresh();
      const f = await family(store);
      expect(await store.peekLive(f.refreshHash)).toEqual({
        userId: f.userId,
        familyId: f.familyId,
      });
      expect(await store.peekLive(f.refreshHash)).not.toBeNull();
      expect(await store.peekLive(hex())).toBeNull();
      const a = rot(store, f.refreshHash);
      expect((await a.run()).status).toBe('rotated');
      expect(await store.peekLive(f.refreshHash)).toBeNull();
      expect(await store.peekLive(a.to)).not.toBeNull();
      await store.revokeFamily(f.familyId);
      expect(await store.peekLive(a.to)).toBeNull();
    });

    it('rotaciona em cadeia e o token novo vale', async () => {
      const store = fresh();
      const f = await family(store);
      const a = rot(store, f.refreshHash);
      expect(await a.run()).toEqual({ status: 'rotated', userId: f.userId, familyId: f.familyId });
      const b = rot(store, a.to);
      expect((await b.run()).status).toBe('rotated');
    });

    it('hash desconhecido não tem efeito colateral', async () => {
      const store = fresh();
      const r = rot(store, hex());
      expect(await r.run()).toEqual({ status: 'unknown' });
      // o hash "novo" não foi criado
      expect((await rot(store, r.to).run()).status).toBe('unknown');
    });

    it('reuso de token já rotacionado revoga a família inteira', async () => {
      const store = fresh();
      const f = await family(store);
      const first = rot(store, f.refreshHash);
      expect((await first.run()).status).toBe('rotated');
      const replay = await rot(store, f.refreshHash).run();
      expect(replay).toEqual({
        status: 'reuse',
        userId: f.userId,
        familyId: f.familyId,
        lastJti: first.jti,
      });
      // o token legítimo da família (o novo) também morreu
      expect((await rot(store, first.to).run()).status).toBe('revoked');
    });

    it('dois refresh simultâneos com o mesmo token: só um vence', async () => {
      const store = fresh();
      const f = await family(store);
      const results = await Promise.all(
        Array.from({ length: 12 }, () => rot(store, f.refreshHash).run()),
      );
      expect(results.filter((r) => r.status === 'rotated')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'reuse').length).toBeGreaterThanOrEqual(1);
      expect(
        results.every(
          (r) => r.status === 'rotated' || r.status === 'reuse' || r.status === 'revoked',
        ),
      ).toBe(true);
    });

    it('família revogada recusa o refresh; revokeAllForUser pega todas as do usuário', async () => {
      const store = fresh();
      const f = await family(store);
      await store.revokeFamily(f.familyId);
      expect((await rot(store, f.refreshHash).run()).status).toBe('revoked');

      const userId = randomUUID();
      const a = {
        familyId: randomUUID(),
        userId,
        refreshHash: hex(),
        jti: randomUUID(),
        ttlSec: 60,
      };
      const b = { ...a, familyId: randomUUID(), refreshHash: hex() };
      await store.createFamily(a);
      await store.createFamily(b);
      await store.revokeAllForUser(userId);
      expect((await rot(store, a.refreshHash).run()).status).toBe('revoked');
      expect((await rot(store, b.refreshHash).run()).status).toBe('revoked');
    });

    it('revokeFamily e revokeAllForUser são escopados: não tocam outra família nem outro usuário', async () => {
      const store = fresh();
      const userId = randomUUID();
      const mk = (uid: string) => ({
        familyId: randomUUID(),
        userId: uid,
        refreshHash: hex(),
        jti: randomUUID(),
        ttlSec: 60,
      });
      const a1 = mk(userId);
      const a2 = mk(userId);
      const b = mk(randomUUID());
      for (const f of [a1, a2, b]) await store.createFamily(f);
      await store.revokeFamily(a1.familyId);
      expect((await rot(store, a1.refreshHash).run()).status).toBe('revoked');
      expect((await rot(store, a2.refreshHash).run()).status).toBe('rotated');
      await store.revokeAllForUser(userId);
      expect((await rot(store, b.refreshHash).run()).status).toBe('rotated');
      // famílias de outro usuário continuam acháveis pelo lookup, com o dono certo
      expect((await store.lookup(b.refreshHash))?.userId).toBe(b.userId);
      // revogar família inexistente é no-op
      await store.revokeFamily(randomUUID());
    });

    it('revokeFamily/revokeAllForUser devolvem o lastJti das famílias RECÉM-revogadas', async () => {
      const store = fresh();
      const userId = randomUUID();
      const mk = () => ({
        familyId: randomUUID(),
        userId,
        refreshHash: hex(),
        jti: randomUUID(),
        ttlSec: 60,
      });
      const a = mk();
      const b = mk();
      await store.createFamily(a);
      await store.createFamily(b);
      // a rotação troca o lastJti da família a
      const r = rot(store, a.refreshHash);
      expect((await r.run()).status).toBe('rotated');
      expect(await store.revokeFamily(a.familyId)).toBe(r.jti);
      // repetir não revoga de novo: nada a devolver (e família inexistente também)
      expect(await store.revokeFamily(a.familyId)).toBeNull();
      expect(await store.revokeFamily(randomUUID())).toBeNull();
      // all: só a família ainda viva (b) conta, com o jti dela
      expect(await store.revokeAllForUser(userId)).toEqual([b.jti]);
      expect(await store.revokeAllForUser(userId)).toEqual([]);
    });

    it('corrida rotate -> revokeFamily: o jti do access NOVO é o devolvido (e nenhum rotate depois passa)', async () => {
      const store = fresh();
      const f = await family(store);
      const r = rot(store, f.refreshHash);
      expect((await r.run()).status).toBe('rotated');
      expect(await store.revokeFamily(f.familyId)).toBe(r.jti);
      expect((await rot(store, r.to).run()).status).toBe('revoked');
    });

    it('jti revogado vale até o TTL', async () => {
      const store = fresh();
      const jti = randomUUID();
      expect(await store.isJtiRevoked(jti)).toBe(false);
      await store.revokeJti(jti, 60);
      expect(await store.isJtiRevoked(jti)).toBe(true);
      const short = randomUUID();
      await store.revokeJti(short, 1);
      await new Promise((r) => setTimeout(r, 1200));
      expect(await store.isJtiRevoked(short)).toBe(false);
    });

    it('revokeAllForUser com exceção: poupa a família indicada e devolve só os jti das revogadas', async () => {
      const store = fresh();
      const userId = randomUUID();
      const a = await family(store);
      void a;
      const mk = () => ({
        familyId: randomUUID(),
        userId,
        refreshHash: hex(),
        jti: randomUUID(),
        ttlSec: 60,
      });
      const x = mk();
      const y = mk();
      await store.createFamily(x);
      await store.createFamily(y);
      expect(await store.revokeAllForUser(userId, y.familyId)).toEqual([x.jti]);
      const rotate = (refreshHash: string) =>
        store.rotate({
          refreshHash,
          newRefreshHash: hex(),
          newJti: randomUUID(),
          ttlSec: 60,
          graceSec: 0,
          familyMaxSec: 7_776_000,
        });
      expect((await rotate(y.refreshHash)).status).toBe('rotated');
      expect((await rotate(x.refreshHash)).status).toBe('revoked');
    });

    it('claimIdToken: uso único até o TTL; chaves distintas são independentes; só uma de N concorrentes vence', async () => {
      const store = fresh();
      const key = hex();
      expect(await store.claimIdToken(key, 60)).toBe(true);
      expect(await store.claimIdToken(key, 60)).toBe(false);
      expect(await store.claimIdToken(hex(), 60)).toBe(true);
      const race = hex();
      const results = await Promise.all(
        Array.from({ length: 8 }, () => store.claimIdToken(race, 60)),
      );
      expect(results.filter(Boolean)).toHaveLength(1);
      const short = hex();
      expect(await store.claimIdToken(short, 1)).toBe(true);
      await new Promise((r) => setTimeout(r, 1200));
      expect(await store.claimIdToken(short, 60)).toBe(true);
    });

    it('família expirada: refresh é desconhecido', async () => {
      const store = fresh();
      const f = await family(store, 1);
      await new Promise((r) => setTimeout(r, 1200));
      expect(await rot(store, f.refreshHash).run()).toEqual({ status: 'unknown' });
    });

    it('lookup devolve dono e família sem efeito colateral', async () => {
      const store = fresh();
      const f = await family(store);
      expect(await store.lookup(f.refreshHash)).toEqual({
        userId: f.userId,
        familyId: f.familyId,
      });
      expect(await store.lookup(hex())).toBeNull();
      expect((await rot(store, f.refreshHash).run()).status).toBe('rotated');
    });

    it('graça: reapresentar logo após rotacionar emite UM sucessor irmão; a 2ª vez é reuso', async () => {
      const store = fresh();
      const f = await family(store);
      const first = rot(store, f.refreshHash, randomUUID(), 60, 20);
      expect((await first.run()).status).toBe('rotated');
      clock.advance(5_000);
      const again = rot(store, f.refreshHash, randomUUID(), 60, 20);
      expect(await again.run()).toEqual({
        status: 'rotated',
        userId: f.userId,
        familyId: f.familyId,
        graced: true,
      });
      // os dois sucessores valem (a cadeia bifurcou)
      expect((await rot(store, first.to, randomUUID(), 60, 20).run()).status).toBe('rotated');
      expect((await rot(store, again.to, randomUUID(), 60, 20).run()).status).toBe('rotated');
      // segunda reapresentação do original: reuso, revoga a família
      const third = await rot(store, f.refreshHash, randomUUID(), 60, 20).run();
      expect(third.status).toBe('reuse');
      expect((await rot(store, again.to, randomUUID(), 60, 20).run()).status).toBe('revoked');
    });

    it('fora da graça (ou graça 0) a reapresentação é reuso e revoga a família', async () => {
      const store = fresh();
      const f = await family(store);
      expect((await rot(store, f.refreshHash, randomUUID(), 60, 20).run()).status).toBe('rotated');
      clock.advance(21_000);
      expect((await rot(store, f.refreshHash, randomUUID(), 60, 20).run()).status).toBe('reuse');

      const g = await family(store);
      expect((await rot(store, g.refreshHash).run()).status).toBe('rotated');
      expect((await rot(store, g.refreshHash).run()).status).toBe('reuse');
    });

    it('teto absoluto da família: a rotação não renova além de createdAt + familyMaxSec', async () => {
      const store = fresh();
      const f = await family(store, 60);
      const a = rot(store, f.refreshHash, randomUUID(), 60, 0, 100);
      clock.advance(50_000);
      expect((await a.run()).status).toBe('rotated');
      const b = rot(store, a.to, randomUUID(), 60, 0, 100);
      clock.advance(40_000);
      expect((await b.run()).status).toBe('rotated');
      clock.advance(11_000); // 101 s desde a criação
      expect(await rot(store, b.to, randomUUID(), 60, 0, 100).run()).toEqual({
        status: 'unknown',
      });
    });
  });
}
