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

describe('getApp: troca de usuário na mesma sessão', () => {
  it('trocar user.id (entrar em conta social) limpa mesa guardada e progresso, como signedOut', async () => {
    vi.resetModules(); // recorder novo: o do teste anterior já se considera "limpo"
    const { getApp } = await import('./app');
    const { sessionStore } = await import('../store/sessionStore');
    const { progressStore } = await import('../store/progressStore');
    getApp();
    sessionStore.getState().sync({ status: 'authenticated', user: { id: 'u1', nickname: 'Zé' } });
    await storage.save(REC);
    progressStore.getState().setBaseline([]);
    progressStore.getState().setGains([{ id: 'maratona', name: 'Maratona', levelLabel: 'Bronze' }]);
    // Mesmo usuário (o vínculo mantém o id): nada é limpo.
    sessionStore.getState().sync({
      status: 'authenticated',
      user: { id: 'u1', nickname: 'Zé', provider: 'google' },
    });
    expect(await storage.load()).toEqual(REC);
    expect(progressStore.getState().baseline).toEqual([]);
    // Outro usuário.
    sessionStore.getState().sync({ status: 'authenticated', user: { id: 'u9', nickname: 'Ana' } });
    await vi.waitFor(async () => expect(await storage.load()).toBeNull());
    expect(progressStore.getState().baseline).toBeNull();
    expect(progressStore.getState().gains).toEqual([]);
  });
});
