import { afterEach, describe, expect, it, vi } from 'vitest';
import { REFRESH_LOCK_NAME, webRefreshLock } from './refreshLock';

describe('webRefreshLock', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sem navigator.locks (nativo/SSR) executa direto', async () => {
    vi.stubGlobal('navigator', {});
    await expect(webRefreshLock(() => Promise.resolve(7))).resolves.toBe(7);
  });

  it('com navigator.locks usa o lock "trucaco-refresh" e repassa o resultado/erro', async () => {
    const names: string[] = [];
    vi.stubGlobal('navigator', {
      locks: {
        request: (name: string, cb: () => Promise<unknown>) => {
          names.push(name);
          return cb();
        },
      },
    });
    await expect(webRefreshLock(() => Promise.resolve('ok'))).resolves.toBe('ok');
    await expect(webRefreshLock(() => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(names).toEqual([REFRESH_LOCK_NAME, REFRESH_LOCK_NAME]);
    expect(REFRESH_LOCK_NAME).toBe('trucaco-refresh');
  });
});
