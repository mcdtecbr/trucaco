import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTokenStorage } from './tokenStorage';
import {
  STORAGE_KEY,
  WEB_STORAGE_KEY,
  createMemoryTokenStorage,
  parseStoredSession,
  serializeSession,
  withMemoryFallback,
} from './tokenStorageCore';
import type { StoredSession, TokenStorage } from './tokenStorageCore';

const S: StoredSession = { refreshToken: 'r1', userId: 'u1', nickname: 'Zé' };

describe('memória', () => {
  it('save/load/clear', async () => {
    const m = createMemoryTokenStorage();
    expect(await m.load()).toBeNull();
    await m.save(S);
    expect(await m.load()).toEqual(S);
    await m.clear();
    expect(await m.load()).toBeNull();
  });
  it('resolução padrão (testes) é memória funcional', async () => {
    const s = createTokenStorage();
    await s.save(S);
    expect(await s.load()).toEqual(S);
  });
});

describe('serialização', () => {
  it('só os três campos; ida e volta', () => {
    const raw = serializeSession({ ...S, accessToken: 'NAO' } as StoredSession);
    expect(raw).not.toContain('NAO');
    expect(parseStoredSession(raw)).toEqual(S);
  });
  it.each([
    null,
    undefined,
    '',
    'nao-json',
    '123',
    'null',
    '{"refreshToken":""}',
    '{"refreshToken":"a"}',
  ])('rejeita %s', (raw) => {
    expect(parseStoredSession(raw)).toBeNull();
  });
});

function broken(): TokenStorage {
  const boom = () => Promise.reject(new Error('quota SEGREDO'));
  return { load: boom, save: boom, clear: boom };
}

describe('degradação para memória', () => {
  it('primário quebrado: nunca lança e a sessão vale em memória', async () => {
    const s = withMemoryFallback(broken());
    expect(await s.load()).toBeNull();
    await s.save(S);
    expect(await s.load()).toEqual(S);
    await s.clear();
    expect(await s.load()).toBeNull();
  });

  it('falha só no save: o valor novo continua disponível', async () => {
    const mem = createMemoryTokenStorage();
    const s = withMemoryFallback({ ...mem, save: () => Promise.reject(new Error('quota')) });
    await s.save(S);
    expect(await s.load()).toEqual(S);
  });

  it('save falho no primário tenta limpá-lo (não deixa refresh velho para o próximo início)', async () => {
    const primary = createMemoryTokenStorage(S);
    const clear = vi.fn(() => primary.clear());
    const s = withMemoryFallback({
      load: () => primary.load(),
      save: () => Promise.reject(new Error('quota')),
      clear,
    });
    await s.save({ ...S, refreshToken: 'r2' });
    expect(clear).toHaveBeenCalledTimes(1);
    expect(await primary.load()).toBeNull();
    expect((await s.load())?.refreshToken).toBe('r2'); // em memória
    // Se o clear também falhar, nada propaga.
    const s2 = withMemoryFallback({
      load: () => primary.load(),
      save: () => Promise.reject(new Error('quota')),
      clear: () => Promise.reject(new Error('keychain')),
    });
    await expect(s2.save(S)).resolves.toBeUndefined();
  });

  it('subscribe do primário é repassado', () => {
    const off = vi.fn();
    const subscribe = vi.fn(() => off);
    const s = withMemoryFallback({ ...createMemoryTokenStorage(), subscribe });
    expect(s.subscribe).toBeDefined();
    expect(withMemoryFallback(createMemoryTokenStorage()).subscribe).toBeUndefined();
  });

  it('primário saudável é a fonte do load', async () => {
    const primary = createMemoryTokenStorage(S);
    const s = withMemoryFallback(primary);
    expect(await s.load()).toEqual(S);
    await s.save({ ...S, refreshToken: 'r2' });
    expect((await primary.load())?.refreshToken).toBe('r2');
    await s.clear();
    expect(await primary.load()).toBeNull();
  });
});

describe('web (localStorage)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  function fakeLocalStorage(throwing = false) {
    const data = new Map<string, string>();
    const guard = () => {
      if (throwing) throw new Error('SecurityError');
    };
    return {
      data,
      getItem: (k: string) => {
        guard();
        return data.get(k) ?? null;
      },
      setItem: (k: string, v: string) => {
        guard();
        data.set(k, v);
      },
      removeItem: (k: string) => {
        guard();
        data.delete(k);
      },
    };
  }

  const U: StoredSession = { userId: 'u1', nickname: 'Zé' };

  it('grava só o usuário (chave v2), nunca o refresh, mesmo que o chamador o passe', async () => {
    const ls = fakeLocalStorage();
    vi.stubGlobal('localStorage', ls);
    const { createTokenStorage: create } = await import('./tokenStorage.web');
    const s = create();
    await s.save(S); // S traz refreshToken: o web o descarta
    expect([...ls.data.keys()]).toEqual([WEB_STORAGE_KEY]);
    expect(ls.data.get(WEB_STORAGE_KEY)).not.toContain('r1');
    expect(ls.data.get(WEB_STORAGE_KEY)).not.toContain('refresh');
    expect(await s.load()).toEqual(U);
    await s.clear();
    expect(ls.data.size).toBe(0);
  });

  it('legado (Fase 3): load devolve o refresh da chave v1; save e clear a apagam', async () => {
    const ls = fakeLocalStorage();
    vi.stubGlobal('localStorage', ls);
    ls.data.set(STORAGE_KEY, serializeSession(S));
    const { createTokenStorage: create } = await import('./tokenStorage.web');
    const s = create();
    expect(await s.load()).toEqual(S);
    await s.save(U);
    expect(ls.data.has(STORAGE_KEY)).toBe(false);
    expect(await s.load()).toEqual(U);
    ls.data.set(STORAGE_KEY, serializeSession(S));
    await s.clear();
    expect(ls.data.size).toBe(0);
  });

  it('subscribe escuta o evento storage de OUTRA aba, só da chave v2 e só com usuário válido', async () => {
    const handlers = new Map<
      string,
      (e: { key: string | null; newValue: string | null }) => void
    >();
    vi.stubGlobal('localStorage', fakeLocalStorage());
    vi.stubGlobal('addEventListener', (t: string, cb: never) => handlers.set(t, cb));
    vi.stubGlobal('removeEventListener', (t: string) => handlers.delete(t));
    const { createTokenStorage: create } = await import('./tokenStorage.web');
    const s = create();
    const got: string[] = [];
    const off = s.subscribe?.((x) => got.push(x.userId));
    const fire = handlers.get('storage')!;
    fire({ key: 'outra', newValue: JSON.stringify(U) });
    fire({ key: STORAGE_KEY, newValue: serializeSession(S) }); // chave legada: ignorada
    fire({ key: WEB_STORAGE_KEY, newValue: null }); // remoção: ignorada
    fire({ key: WEB_STORAGE_KEY, newValue: 'lixo' });
    fire({ key: WEB_STORAGE_KEY, newValue: JSON.stringify({ userId: 'u9', nickname: 'Ana' }) });
    expect(got).toEqual(['u9']);
    off?.();
    expect(handlers.has('storage')).toBe(false);
  });

  it('modo privado (localStorage lança): degrada para memória sem erro', async () => {
    vi.stubGlobal('localStorage', fakeLocalStorage(true));
    const { createTokenStorage: create } = await import('./tokenStorage.web');
    const s = create();
    await expect(s.save(S)).resolves.toBeUndefined();
    expect(await s.load()).toEqual(S);
    await expect(s.clear()).resolves.toBeUndefined();
  });

  it('sem localStorage no ambiente (SSR): degrada', async () => {
    vi.stubGlobal('localStorage', undefined);
    const { createTokenStorage: create } = await import('./tokenStorage.web');
    const s = create();
    await s.save(S);
    expect(await s.load()).toEqual(S);
  });
});

describe('nativo (expo-secure-store)', () => {
  afterEach(() => {
    vi.doUnmock('expo-secure-store');
    vi.resetModules();
  });

  it('usa getItemAsync/setItemAsync/deleteItemAsync e degrada se falhar', async () => {
    const store = new Map<string, string>();
    let fail = false;
    vi.doMock('expo-secure-store', () => ({
      getItemAsync: async (k: string) => {
        if (fail) throw new Error('keychain');
        return store.get(k) ?? null;
      },
      setItemAsync: async (k: string, v: string) => {
        if (fail) throw new Error('keychain');
        store.set(k, v);
      },
      deleteItemAsync: async (k: string) => {
        if (fail) throw new Error('keychain');
        store.delete(k);
      },
    }));
    const { createTokenStorage: create } = await import('./tokenStorage.native');
    const s = create();
    await s.save(S);
    expect(store.get(STORAGE_KEY)).toContain('r1');
    expect(await s.load()).toEqual(S);
    fail = true;
    await expect(s.save({ ...S, refreshToken: 'r2' })).resolves.toBeUndefined();
    expect((await s.load())?.refreshToken).toBe('r2');
    await s.clear();
  });
});
