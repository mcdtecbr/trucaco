import { describe, expect, it } from 'vitest';
import { MAX_CLAIMED_ID_TOKENS, MemoryTokenStore } from './tokenStore';

describe('MemoryTokenStore.claimIdToken: teto de memória', () => {
  it('descarta os mais antigos acima do teto e continua recusando os recentes', async () => {
    const now = 1_000_000;
    const store = new MemoryTokenStore(() => now);
    for (let i = 0; i < MAX_CLAIMED_ID_TOKENS + 50; i++) {
      expect(await store.claimIdToken(`k${i}`, 3600)).toBe(true);
    }
    // o mais antigo saiu (pode ser consumido de novo); o mais recente segue protegido
    expect(await store.claimIdToken('k0', 3600)).toBe(true);
    expect(await store.claimIdToken(`k${MAX_CLAIMED_ID_TOKENS + 49}`, 3600)).toBe(false);
  });

  it('antes de descartar, varre os vencidos', async () => {
    let now = 1_000_000;
    const store = new MemoryTokenStore(() => now);
    for (let i = 0; i < MAX_CLAIMED_ID_TOKENS; i++) await store.claimIdToken(`v${i}`, 1);
    now += 5000; // todos vencidos
    expect(await store.claimIdToken('novo', 3600)).toBe(true);
    expect(await store.claimIdToken('novo', 3600)).toBe(false);
    expect(await store.claimIdToken('v5', 3600)).toBe(true);
  });
});
