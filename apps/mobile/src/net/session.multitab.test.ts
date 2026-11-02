/**
 * Duas "abas" = duas sessões que dividem o mesmo armazenamento e (na web) o mesmo Web Lock, contra um
 * servidor falso com rotação de refresh e detecção de REUSO (reuso revoga a família inteira).
 */
import { describe, expect, it } from 'vitest';
import { createSession } from './session';
import type { Session } from './session';
import { createMemoryTokenStorage } from './tokenStorageCore';
import type { StoredSession, TokenStorage } from './tokenStorageCore';
import { fakeFetch } from './testHelpers';
import type { Handler } from './testHelpers';

function fakeServer() {
  let n = 0;
  const used = new Set<string>();
  let revoked = false;
  const presented: string[] = [];
  const issue = () => {
    n += 1;
    return { accessToken: `a${n}`, refreshToken: `r${n}`, expiresIn: 900 };
  };
  const handler: Handler = (req) => {
    if (req.path === '/auth/guest') {
      return { status: 201, json: { user: { id: 'u1', nickname: 'G' }, ...issue() } };
    }
    if (req.path === '/auth/refresh') {
      const token = (req.body as { refreshToken: string }).refreshToken;
      presented.push(token);
      if (revoked || used.has(token)) {
        revoked = true; // reuso: família inteira morre
        return { status: 401, json: { error: { code: 'INVALID_REFRESH_TOKEN' } } };
      }
      used.add(token);
      return { status: 200, json: issue() };
    }
    return { status: 204 };
  };
  return { handler, presented, isRevoked: () => revoked };
}

function fakeLock() {
  let chain: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => undefined);
    return run;
  };
}

function tab(handler: Handler, storage: TokenStorage, lock?: ReturnType<typeof fakeLock>): Session {
  const f = fakeFetch(handler);
  return createSession({
    storage,
    baseUrl: 'http://x',
    fetch: f.fetch,
    ...(lock !== undefined ? { refreshLock: lock } : {}),
  });
}

describe('duas abas dividindo o armazenamento', () => {
  it('aba B não reapresenta o refresh que a aba A já rotacionou', async () => {
    const server = fakeServer();
    const storage = createMemoryTokenStorage();
    const a = tab(server.handler, storage, fakeLock());
    await a.start(); // cria convidado: r1
    const b = tab(server.handler, storage, fakeLock());
    await b.start(); // restaura r1 -> r2 (A segue com r1 em memória)

    await a.forceRefresh(); // A tem r1 (velho): deve adotar r2 do armazenamento e apresentar r2
    await b.forceRefresh(); // B tem r2 (velho): deve adotar r3

    expect(server.presented).toEqual(['r1', 'r2', 'r3']);
    expect(server.isRevoked()).toBe(false);
    expect(a.getState().status).toBe('authenticated');
    expect((await storage.load())?.refreshToken).toBe('r4');
  });

  it('renovações simultâneas nas duas abas serializam pelo lock', async () => {
    const server = fakeServer();
    const storage = createMemoryTokenStorage();
    const lock = fakeLock();
    const a = tab(server.handler, storage, lock);
    await a.start();
    const b = tab(server.handler, storage, lock);
    await b.start();
    server.presented.length = 0;

    await Promise.all([a.forceRefresh(), b.forceRefresh()]);
    expect(new Set(server.presented).size).toBe(server.presented.length); // nenhum reuso
    expect(server.isRevoked()).toBe(false);
  });

  it('restauração simultânea (ambas leem r1 antes do lock) não gera reuso', async () => {
    const server = fakeServer();
    // O guest cria a família (r1); o armazenamento compartilhado é semeado com esse r1.
    const boot = tab(server.handler, createMemoryTokenStorage(), fakeLock());
    await boot.start();
    const storage = createMemoryTokenStorage({ refreshToken: 'r1', userId: 'u1', nickname: 'G' });
    const lock = fakeLock();
    const a = tab(server.handler, storage, lock);
    const b = tab(server.handler, storage, lock);
    const [sa, sb] = await Promise.all([a.start(), b.start()]);
    expect(sa.status).toBe('authenticated');
    expect(sb.status).toBe('authenticated');
    expect(server.isRevoked()).toBe(false);
  });

  it('aviso de armazenamento de outra aba atualiza o refresh sem renovar', async () => {
    const server = fakeServer();
    const mem = createMemoryTokenStorage();
    const listeners = new Set<(s: StoredSession) => void>();
    let loadFails = false;
    const storage: TokenStorage = {
      load: () => (loadFails ? Promise.reject(new Error('x')) : mem.load()),
      save: (s) => mem.save(s),
      clear: () => mem.clear(),
      subscribe: (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    };
    const a = tab(server.handler, storage);
    await a.start(); // r1
    // Outra aba rotacionou r1 -> r2 (o servidor conhece r2 como válido).
    const other = tab(server.handler, createMemoryTokenStorage({ ...(await mem.load())! }));
    await other.start();
    const rotated: StoredSession = { refreshToken: 'r2', userId: 'u1', nickname: 'G' };
    await mem.save(rotated);
    for (const l of listeners) l(rotated);
    loadFails = true; // força a prova de que o valor veio do aviso, não de uma releitura
    server.presented.length = 0;
    await a.forceRefresh();
    expect(server.presented).toEqual(['r2']);
    expect(server.isRevoked()).toBe(false);
    a.dispose();
    expect(listeners.size).toBe(0);
  });

  it('refresh recusado na aba A: B (que leu o mesmo r1) falha sem laço e termina signedOut', async () => {
    const storage = createMemoryTokenStorage();
    const lock = fakeLock();
    const reject: Handler = (req) =>
      req.path === '/auth/guest'
        ? {
            status: 201,
            json: {
              user: { id: 'u1', nickname: 'G' },
              accessToken: 'a',
              refreshToken: 'r1',
              expiresIn: 900,
            },
          }
        : { status: 401, json: { error: { code: 'INVALID_REFRESH_TOKEN' } } };
    const a = tab(reject, storage, lock);
    await a.start();
    const b = tab(reject, storage, lock);
    await b.start().catch(() => undefined);
    const settled = await Promise.allSettled([a.forceRefresh(), b.forceRefresh()]);
    expect(settled.every((s) => s.status === 'rejected')).toBe(true);
    expect(a.getState().status).toBe('signedOut');
    expect(b.getState().status).toBe('signedOut');
    expect(await storage.load()).toBeNull();
  });

  it('falha de rede simultânea mantém o refresh e as duas abas recuperam depois', async () => {
    const server = fakeServer();
    const storage = createMemoryTokenStorage();
    const lock = fakeLock();
    let down = false;
    const handler: Handler = (req) =>
      down && req.path === '/auth/refresh' ? 'throw' : server.handler(req);
    const a = tab(handler, storage, lock);
    await a.start();
    const b = tab(handler, storage, lock);
    await b.start();
    const before = (await storage.load())?.refreshToken;
    down = true;
    const out = await Promise.allSettled([a.forceRefresh(), b.forceRefresh()]);
    expect(out.every((o) => o.status === 'rejected')).toBe(true);
    expect((await storage.load())?.refreshToken).toBe(before);
    down = false;
    await a.forceRefresh();
    await b.forceRefresh();
    expect(server.isRevoked()).toBe(false);
  });
});
