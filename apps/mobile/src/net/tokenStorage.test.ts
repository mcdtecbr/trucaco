import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTokenStorage } from './tokenStorage';
import {
  STORAGE_KEY,
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

  it('persiste sob a chave versionada', async () => {
    const ls = fakeLocalStorage();
    vi.stubGlobal('localStorage', ls);
    const { createTokenStorage: create } = await import('./tokenStorage.web');
    const s = create();
    await s.save(S);
    expect(ls.data.has(STORAGE_KEY)).toBe(true);
    expect(await s.load()).toEqual(S);
    await s.clear();
    expect(ls.data.size).toBe(0);
  });

  it('subscribe escuta o evento storage de OUTRA aba, só da chave da sessão', async () => {
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
    const off = s.subscribe?.((x) => got.push(x.refreshToken));
    const fire = handlers.get('storage')!;
    fire({ key: 'outra', newValue: serializeSession(S) });
    fire({ key: STORAGE_KEY, newValue: null }); // remoção: ignorada
    fire({ key: STORAGE_KEY, newValue: 'lixo' });
    fire({ key: STORAGE_KEY, newValue: serializeSession({ ...S, refreshToken: 'r9' }) });
    expect(got).toEqual(['r9']);
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
