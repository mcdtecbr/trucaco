// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createResumeStorage as createDefault } from './resumeStorage';
import { createResumeStorage as createWeb } from './resumeStorage.web';
import {
  RESUME_KEY,
  createMemoryResumeStorage,
  isValidReconnectionToken,
  parseResume,
  serializeResume,
  withResumeMemoryFallback,
} from './resumeStorageCore';
import type { ResumeStorage, TableResume } from './resumeStorageCore';

const R: TableResume = { reconnectionToken: 'room_1:tok-abc', code: 'ABCDEFGH', userId: 'u1' };

afterEach(() => {
  globalThis.sessionStorage.clear();
  globalThis.localStorage.clear();
});

describe('serialização', () => {
  it('só os três campos; ida e volta', () => {
    const raw = serializeResume({ ...R, extra: 'NAO' } as TableResume);
    expect(raw).not.toContain('NAO');
    expect(parseResume(raw)).toEqual(R);
  });

  it.each([
    null,
    undefined,
    '',
    'nao-json',
    '123',
    'null',
    '{}',
    JSON.stringify({ ...R, reconnectionToken: 'semdoispontos' }),
    JSON.stringify({ ...R, reconnectionToken: 'a:b:c' }),
    JSON.stringify({ ...R, reconnectionToken: 'a:b c' }),
    JSON.stringify({ ...R, code: 'abc' }),
    JSON.stringify({ ...R, code: 'ABCDEFG0' }),
    JSON.stringify({ ...R, userId: '' }),
    JSON.stringify({ ...R, userId: 7 }),
  ])('rejeita %s', (raw) => {
    expect(parseResume(raw as string | null | undefined)).toBeNull();
  });

  it('formato do token de reconexão', () => {
    expect(isValidReconnectionToken('abc:def')).toBe(true);
    expect(isValidReconnectionToken('abc')).toBe(false);
    expect(isValidReconnectionToken('abc:')).toBe(false);
    expect(isValidReconnectionToken(`a:${'b'.repeat(300)}`)).toBe(false);
    expect(isValidReconnectionToken(42)).toBe(false);
  });
});

describe('memória', () => {
  it('save/load/clear; resolução padrão (testes) é memória funcional', async () => {
    const m = createMemoryResumeStorage();
    expect(await m.load()).toBeNull();
    await m.save(R);
    expect(await m.load()).toEqual(R);
    await m.clear();
    expect(await m.load()).toBeNull();
    const d = createDefault();
    await d.save(R);
    expect(await d.load()).toEqual(R);
  });
});

describe('web: sessionStorage (por aba), nunca localStorage', () => {
  it('grava no sessionStorage e não toca o localStorage', async () => {
    const s = createWeb();
    await s.save(R);
    expect(globalThis.sessionStorage.getItem(RESUME_KEY)).not.toBeNull();
    expect(globalThis.localStorage.getItem(RESUME_KEY)).toBeNull();
    expect(globalThis.localStorage.length).toBe(0);
    // "Reload": uma instância nova lê o mesmo registro.
    expect(await createWeb().load()).toEqual(R);
    await s.clear();
    expect(globalThis.sessionStorage.getItem(RESUME_KEY)).toBeNull();
    expect(await createWeb().load()).toBeNull();
  });

  it('valor corrompido ou adulterado no storage vira "sem registro"', async () => {
    globalThis.sessionStorage.setItem(RESUME_KEY, '{"reconnectionToken":"x"}');
    expect(await createWeb().load()).toBeNull();
  });
});

function broken(): ResumeStorage {
  const boom = () => Promise.reject(new Error('quota SEGREDO'));
  return { load: boom, save: boom, clear: boom };
}

describe('degradação para memória', () => {
  it('primário quebrado: nunca lança e o registro vale em memória', async () => {
    const s = withResumeMemoryFallback(broken());
    expect(await s.load()).toBeNull();
    await s.save(R);
    expect(await s.load()).toEqual(R);
    await s.clear();
    expect(await s.load()).toBeNull();
  });

  it('falha ao gravar apaga o registro anterior do primário (token morto)', async () => {
    const inner = createMemoryResumeStorage({ ...R, reconnectionToken: 'velho:token' });
    let fail = true;
    const flaky: ResumeStorage = {
      load: () => inner.load(),
      save: (r) => (fail ? Promise.reject(new Error('x')) : inner.save(r)),
      clear: () => inner.clear(),
    };
    const s = withResumeMemoryFallback(flaky);
    await s.save(R);
    fail = false;
    expect(await inner.load()).toBeNull();
    expect(await s.load()).toEqual(R);
  });
});

describe('tipo da mesa no registro', () => {
  it('ida e volta com visibility; valor desconhecido é ignorado', () => {
    expect(parseResume(serializeResume({ ...R, visibility: 'public' }))).toEqual({
      ...R,
      visibility: 'public',
    });
    expect(parseResume(JSON.stringify({ ...R, visibility: 'qualquer' }))).toEqual(R);
    expect(parseResume(serializeResume(R))).toEqual(R);
  });
});
