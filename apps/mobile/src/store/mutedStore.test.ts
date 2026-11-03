import { describe, expect, it } from 'vitest';
import {
  MAX_MUTED,
  createMemoryMutedStorage,
  parseMuted,
  safeMutedStorage,
  serializeMuted,
} from '../platform/mutedStorageCore';
import { createMutedStore } from './mutedStore';

describe('mutedStore', () => {
  it('silencia e reativa por apelido (sem diferenciar maiúsculas) e persiste', async () => {
    const storage = createMemoryMutedStorage();
    const store = createMutedStore(storage);
    await store.getState().hydrate();
    expect(store.getState().toggle('Bia')).toBe(true);
    expect(store.getState().has('bia')).toBe(true);
    expect(store.getState().has('BIA')).toBe(true);
    await Promise.resolve();
    expect(await storage.load()).toEqual(['bia']);
    store.getState().toggle('BIA');
    expect(store.getState().has('Bia')).toBe(false);
    expect(store.getState().toggle('   ')).toBe(false);
  });

  it('hydrate junta o que estava guardado com o que já foi silenciado', async () => {
    const storage = createMemoryMutedStorage(['caio']);
    const store = createMutedStore(storage);
    store.getState().toggle('Bia');
    await store.getState().hydrate();
    expect([...store.getState().names].sort()).toEqual(['bia', 'caio']);
    await Promise.resolve();
    expect([...(await storage.load())].sort()).toEqual(['bia', 'caio']);
  });

  it('reativar um jogador depois do hydrate tira o apelido também do armazenamento', async () => {
    const storage = createMemoryMutedStorage(['bia', 'caio']);
    const store = createMutedStore(storage);
    await store.getState().hydrate();
    store.getState().toggle('Bia');
    await Promise.resolve();
    expect(await storage.load()).toEqual(['caio']);
    expect(store.getState().has('bia')).toBe(false);
  });

  it('hydrate com armazenamento acima do teto mantém no máximo MAX_MUTED nomes', async () => {
    const saved = Array.from({ length: MAX_MUTED + 5 }, (_, i) => `j${i}`);
    const store = createMutedStore(createMemoryMutedStorage(saved));
    await store.getState().hydrate();
    expect(store.getState().names).toHaveLength(MAX_MUTED);
    expect(store.getState().toggle('novo')).toBe(false);
  });

  it('a lista tem teto', () => {
    const store = createMutedStore();
    for (let i = 0; i < MAX_MUTED; i += 1) {
      expect(store.getState().toggle(`jogador${i}`)).toBe(true);
    }
    expect(store.getState().toggle('mais um')).toBe(false);
  });
});

describe('mutedStorageCore', () => {
  it('parseMuted aceita só lista de textos curtos; lixo vira lista vazia', () => {
    expect(parseMuted(serializeMuted(['a', 'b']))).toEqual(['a', 'b']);
    expect(parseMuted('{"a":1}')).toEqual([]);
    expect(parseMuted('não é json')).toEqual([]);
    expect(parseMuted(null)).toEqual([]);
    expect(parseMuted(JSON.stringify(['ok', 3, '', 'x'.repeat(40), 'OK']))).toEqual(['ok']);
  });

  it('safeMutedStorage nunca lança', async () => {
    const boom = safeMutedStorage({
      load: () => Promise.reject(new Error('x')),
      save: () => Promise.reject(new Error('x')),
    });
    expect(await boom.load()).toEqual([]);
    await expect(boom.save(['a'])).resolves.toBeUndefined();
  });
});
