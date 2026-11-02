import { describe, expect, it, vi } from 'vitest';
import { createMemoryResumeStorage } from '../net/resumeStorageCore';
import type { TableResume } from '../net/resumeStorageCore';

const REC: TableResume = { reconnectionToken: 'room1:tokA', code: 'ABCDEFGH', userId: 'u1' };
const storage = createMemoryResumeStorage();

vi.mock('../net/resumeStorage', async () => ({
  ...(await vi.importActual<object>('../net/resumeStorageCore')),
  createResumeStorage: () => storage,
}));

describe('getApp: fim da sessão apaga a mesa guardada', () => {
  it('logout (signedOut) executa o clear do registro de retomada', async () => {
    const { getApp } = await import('./app');
    const { sessionStore } = await import('../store/sessionStore');
    getApp();
    await storage.save(REC);
    sessionStore.getState().sync({ status: 'authenticated', user: { id: 'u1', nickname: 'Zé' } });
    expect(await storage.load()).toEqual(REC);
    sessionStore.getState().sync({ status: 'signedOut', user: null });
    await vi.waitFor(async () => expect(await storage.load()).toBeNull());
  });
});
