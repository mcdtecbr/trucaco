import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../net/api';
import { GameClientError } from '../net/colyseus';
import { createMemoryResumeStorage } from '../net/resumeStorageCore';
import type { ResumeStorage, TableResume } from '../net/resumeStorageCore';
import { createResumeRecorder, createTableResume } from './tableResume';
import type { TableResumeDeps } from './tableResume';

const TOKEN = 'room1:tokA';
const REC: TableResume = { reconnectionToken: TOKEN, code: 'ABCDEFGH', userId: 'u1' };
const RESERVATION = { name: 'truco', sessionId: 's', roomId: 'room1' };

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('createResumeRecorder', () => {
  it('grava token + código + dono, ignora repetidos e entradas inválidas', async () => {
    const storage = createMemoryResumeStorage();
    const save = vi.spyOn(storage, 'save');
    const rec = createResumeRecorder({ storage, getUserId: () => 'u1' });
    rec.save(TOKEN, 'ABCDEFGH');
    rec.save(TOKEN, 'ABCDEFGH');
    rec.save('sem-dois-pontos', 'ABCDEFGH');
    rec.save(TOKEN, 'abc');
    await flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(await storage.load()).toEqual(REC);
    rec.save('room1:tokB', 'ABCDEFGH'); // token renovado pelo servidor
    await flush();
    expect((await storage.load())?.reconnectionToken).toBe('room1:tokB');
  });

  it('sem usuário não grava; clear apaga e é idempotente', async () => {
    const storage = createMemoryResumeStorage();
    const clear = vi.spyOn(storage, 'clear');
    let user: string | null = null;
    const rec = createResumeRecorder({ storage, getUserId: () => user });
    rec.save(TOKEN, 'ABCDEFGH');
    await flush();
    expect(await storage.load()).toBeNull();
    user = 'u1';
    rec.save(TOKEN, 'ABCDEFGH');
    await flush();
    expect(await storage.load()).toEqual(REC);
    rec.clear();
    rec.clear();
    rec.clear();
    await flush();
    expect(await storage.load()).toBeNull();
    expect(clear).toHaveBeenCalledTimes(1);
    // Depois de apagado, a mesma mesa pode ser gravada de novo (nova entrada).
    rec.save(TOKEN, 'ABCDEFGH');
    await flush();
    expect(await storage.load()).toEqual(REC);
  });

  it('um clear nunca é atropelado por um save anterior que ainda gravava', async () => {
    let release: () => void = () => undefined;
    const slow: ResumeStorage = {
      load: () => Promise.resolve(null),
      save: () => new Promise<void>((r) => (release = r)),
      clear: vi.fn(() => Promise.resolve()),
    };
    const rec = createResumeRecorder({ storage: slow, getUserId: () => 'u1' });
    rec.save(TOKEN, 'ABCDEFGH');
    rec.clear();
    await flush();
    expect(slow.clear).not.toHaveBeenCalled(); // ainda espera o save terminar
    release();
    await flush();
    expect(slow.clear).toHaveBeenCalledTimes(1);
  });

  it('armazenamento que falha não lança nem derruba as gravações seguintes', async () => {
    let fail = true;
    const storage: ResumeStorage = {
      load: () => Promise.resolve(null),
      save: vi.fn(() => (fail ? Promise.reject(new Error('quota')) : Promise.resolve())),
      clear: () => Promise.reject(new Error('x')),
    };
    const rec = createResumeRecorder({ storage, getUserId: () => 'u1' });
    rec.save(TOKEN, 'ABCDEFGH');
    rec.clear();
    fail = false;
    rec.save('room1:tokC', 'ABCDEFGH');
    await flush();
    expect(storage.save).toHaveBeenCalledTimes(2);
  });
});

function setup(over: Partial<TableResumeDeps> = {}, initial: TableResume | null = REC) {
  const storage = createMemoryResumeStorage(initial);
  const deps = {
    storage,
    clear: vi.fn(() => void storage.clear()),
    getUserId: () => 'u1',
    resumeRoom: vi.fn((): Promise<string> => Promise.resolve('ABCDEFGH')),
    reserveByCode: vi.fn(() => Promise.resolve(RESERVATION)),
    enter: vi.fn((): Promise<string> => Promise.resolve('ABCDEFGH')),
    onStart: vi.fn(),
    sleep: vi.fn(() => Promise.resolve()),
    ...over,
  } satisfies TableResumeDeps;
  return { deps, storage, resume: createTableResume(deps) };
}

const gone = () => Promise.reject(new GameClientError('ROOM_NOT_FOUND'));
const apiError = (code: ApiError['code'], status = 409) =>
  Promise.reject(new ApiError({ status, code, kind: 'http' }));

describe('createTableResume', () => {
  it('sem registro: nada a fazer e nenhuma rede', async () => {
    const t = setup({}, null);
    expect(await t.resume.pending()).toBeNull();
    expect(await t.resume.run()).toEqual({ kind: 'none' });
    expect(t.deps.resumeRoom).not.toHaveBeenCalled();
    expect(t.deps.onStart).not.toHaveBeenCalled();
  });

  it('registro de OUTRO usuário é apagado e nunca usado', async () => {
    const t = setup({ getUserId: () => 'u2' });
    expect(await t.resume.pending()).toBeNull();
    expect(t.deps.clear).toHaveBeenCalled();
    expect(await t.resume.run()).toEqual({ kind: 'none' });
    expect(t.deps.resumeRoom).not.toHaveBeenCalled();
  });

  it('sem sessão (usuário desconhecido) também descarta o registro', async () => {
    const t = setup({ getUserId: () => null });
    expect(await t.resume.pending()).toBeNull();
    expect(t.deps.clear).toHaveBeenCalled();
  });

  it('token válido: reconecta pelo token, sem tocar o lobby', async () => {
    const t = setup();
    expect(await t.resume.run()).toEqual({ kind: 'resumed', code: 'ABCDEFGH' });
    expect(t.deps.resumeRoom).toHaveBeenCalledWith(TOKEN);
    expect(t.deps.reserveByCode).not.toHaveBeenCalled();
    expect(t.deps.onStart).toHaveBeenCalledTimes(1);
    expect(t.deps.clear).not.toHaveBeenCalled();
  });

  it('estado ainda não chegou (código vazio): usa o código guardado', async () => {
    const t = setup({ resumeRoom: () => Promise.resolve('') });
    expect(await t.resume.run()).toEqual({ kind: 'resumed', code: 'ABCDEFGH' });
  });

  it('token recusado (janela fechada, o bot assumiu): o dono volta pelo código', async () => {
    const t = setup({ resumeRoom: vi.fn(gone) });
    expect(await t.resume.run()).toEqual({ kind: 'resumed', code: 'ABCDEFGH' });
    expect(t.deps.reserveByCode).toHaveBeenCalledWith('ABCDEFGH');
    expect(t.deps.enter).toHaveBeenCalledWith(RESERVATION);
    expect(t.deps.clear).not.toHaveBeenCalled();
  });

  it('corrida com o servidor (ainda não notou o socket antigo): tenta de novo e conecta', async () => {
    const resumeRoom = vi
      .fn<(t: string) => Promise<string>>()
      .mockImplementationOnce(gone)
      .mockResolvedValueOnce('ABCDEFGH');
    const reserveByCode = vi.fn(() => apiError('TABLE_UNAVAILABLE', 404));
    const t = setup({ resumeRoom, reserveByCode });
    expect(await t.resume.run()).toEqual({ kind: 'resumed', code: 'ABCDEFGH' });
    expect(t.deps.sleep).toHaveBeenCalledTimes(1);
    expect(resumeRoom).toHaveBeenCalledTimes(2);
  });

  it('mesa inexistente: esgota as tentativas, apaga o registro e diz que a mesa se perdeu', async () => {
    const t = setup({
      resumeRoom: vi.fn(gone),
      reserveByCode: vi.fn(() => apiError('TABLE_UNAVAILABLE', 404)),
    });
    const out = await t.resume.run();
    expect(out).toEqual({ kind: 'failed', reason: 'gone', errorCode: 'TABLE_UNAVAILABLE' });
    expect(t.deps.resumeRoom).toHaveBeenCalledTimes(3);
    expect(t.deps.sleep).toHaveBeenCalledTimes(2);
    // Cada falha por código conta no freio de força bruta do servidor: UMA tentativa, nunca mais.
    expect(t.deps.reserveByCode).toHaveBeenCalledTimes(1);
    expect(t.deps.clear).toHaveBeenCalled();
  });

  it('mesa pública (fila): pula o caminho por código, sem gastar tentativa no servidor', async () => {
    const t = setup({ resumeRoom: vi.fn(gone) }, { ...REC, visibility: 'public' });
    expect(await t.resume.run()).toMatchObject({ kind: 'failed', reason: 'gone' });
    expect(t.deps.reserveByCode).not.toHaveBeenCalled();
    expect(t.deps.clear).toHaveBeenCalled();
  });

  it('aba duplicada (assento ocupado em outra aba): uma tentativa por código e mesa perdida', async () => {
    const t = setup({
      resumeRoom: vi.fn(gone),
      reserveByCode: vi.fn(() => apiError('ALREADY_IN_TABLE')),
    });
    expect(await t.resume.run()).toMatchObject({ kind: 'failed', reason: 'gone' });
    expect(t.deps.reserveByCode).toHaveBeenCalledTimes(1);
  });

  it('sessão perdida (token expirado ou refresh recusado): falha de sessão e apaga', async () => {
    const t = setup({
      resumeRoom: vi.fn(() => Promise.reject(new GameClientError('TOKEN_EXPIRED'))),
    });
    expect(await t.resume.run()).toMatchObject({ kind: 'failed', reason: 'session' });
    expect(t.deps.reserveByCode).not.toHaveBeenCalled();
    expect(t.deps.clear).toHaveBeenCalled();
    const t2 = setup({
      resumeRoom: vi.fn(gone),
      reserveByCode: vi.fn(() => apiError('UNAUTHORIZED', 401)),
    });
    expect(await t2.resume.run()).toMatchObject({ kind: 'failed', reason: 'session' });
  });

  it('servidor ou rede fora: falha "indisponível" sem insistir e NÃO apaga o registro', async () => {
    const t = setup({
      resumeRoom: vi.fn(() => Promise.reject(new GameClientError('UNAVAILABLE'))),
    });
    expect(await t.resume.run()).toMatchObject({ kind: 'failed', reason: 'unavailable' });
    expect(t.deps.resumeRoom).toHaveBeenCalledTimes(1);
    expect(t.deps.clear).not.toHaveBeenCalled();
    const t2 = setup({
      resumeRoom: vi.fn(gone),
      reserveByCode: vi.fn(() => apiError('NETWORK', 0)),
    });
    expect(await t2.resume.run()).toMatchObject({ kind: 'failed', reason: 'unavailable' });
    expect(t2.deps.reserveByCode).toHaveBeenCalledTimes(1);
    expect(t2.deps.clear).not.toHaveBeenCalled();
  });

  it('muitas tentativas no lobby: para na hora (não alimenta o bloqueio) e conta como mesa perdida', async () => {
    const t = setup({
      resumeRoom: vi.fn(gone),
      reserveByCode: vi.fn(() => apiError('RATE_LIMITED', 429)),
    });
    expect(await t.resume.run()).toMatchObject({ kind: 'failed', reason: 'gone' });
    expect(t.deps.reserveByCode).toHaveBeenCalledTimes(1);
  });

  it('exceção inesperada vira falha, nunca lança', async () => {
    const t = setup({ resumeRoom: vi.fn(() => Promise.reject(new Error('token SEGREDO'))) });
    const out = await t.resume.run();
    expect(out).toMatchObject({ kind: 'failed', reason: 'unavailable', errorCode: 'UNKNOWN' });
    expect(JSON.stringify(out)).not.toContain('SEGREDO');
  });

  it('chamadas simultâneas compartilham a mesma tentativa', async () => {
    const t = setup();
    const [a, b] = await Promise.all([t.resume.run(), t.resume.run()]);
    expect(a).toEqual(b);
    expect(t.deps.resumeRoom).toHaveBeenCalledTimes(1);
  });

  it('armazenamento que lança no load equivale a "sem registro"', async () => {
    const storage: ResumeStorage = {
      load: () => Promise.reject(new Error('x')),
      save: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    };
    const t = setup({ storage });
    expect(await t.resume.run()).toEqual({ kind: 'none' });
  });
});
