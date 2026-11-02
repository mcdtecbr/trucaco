import { describe, expect, it } from 'vitest';
import { createSession } from './session';
import type { SessionState } from './session';
import { createMemoryTokenStorage } from './tokenStorageCore';
import type { StoredSession } from './tokenStorageCore';
import { fakeFetch, tick } from './testHelpers';
import type { Handler, RecordedRequest } from './testHelpers';

const guestRes = (n: number) => ({
  user: { id: `u${n}`, nickname: `Guest${n}` },
  accessToken: `a${n}`,
  refreshToken: `r${n}`,
  expiresIn: 900,
});
const refreshRes = (n: number) => ({ accessToken: `a${n}`, refreshToken: `r${n}`, expiresIn: 900 });

function setup(handler: Handler, stored: StoredSession | null = null, now = { t: 1_000_000 }) {
  const storage = createMemoryTokenStorage(stored);
  const f = fakeFetch(handler);
  const session = createSession({
    storage,
    baseUrl: 'http://x',
    fetch: f.fetch,
    now: () => now.t,
  });
  return { session, storage, now, ...f };
}

describe('start', () => {
  it('sem sessão guardada cria convidado e persiste o refresh', async () => {
    const { session, storage, calls } = setup(() => ({ status: 201, json: guestRes(1) }));
    const seen: string[] = [];
    session.subscribe((s) => seen.push(s.status));
    const st = await session.start();
    expect(st).toMatchObject({ status: 'authenticated', user: { id: 'u1' } });
    expect(await storage.load()).toEqual({ refreshToken: 'r1', userId: 'u1', nickname: 'Guest1' });
    expect(session.getAccessToken()).toBe('a1');
    expect(seen).toEqual(['restoring', 'authenticated']);
    expect(calls.map((c) => c.path)).toEqual(['/auth/guest']);
  });

  it('com sessão guardada renova e NÃO cria convidado', async () => {
    const { session, storage, calls } = setup(() => ({ status: 200, json: refreshRes(2) }), {
      refreshToken: 'r1',
      userId: 'u1',
      nickname: 'Zé',
    });
    const st = await session.start();
    expect(st).toMatchObject({ status: 'authenticated', user: { id: 'u1', nickname: 'Zé' } });
    expect((await storage.load())?.refreshToken).toBe('r2');
    expect(calls.map((c) => c.path)).toEqual(['/auth/refresh']);
    expect(calls[0]?.body).toEqual({ refreshToken: 'r1' });
  });

  it('refresh recusado: limpa e cai para convidado novo (nova família só via guest)', async () => {
    const { session, storage } = setup(
      (r) =>
        r.path === '/auth/refresh'
          ? { status: 401, json: { error: { code: 'INVALID_REFRESH_TOKEN' } } }
          : { status: 201, json: guestRes(9) },
      { refreshToken: 'velho', userId: 'u1', nickname: 'Zé' },
    );
    const st = await session.start();
    expect(st).toMatchObject({ status: 'authenticated', user: { id: 'u9' } });
    expect((await storage.load())?.refreshToken).toBe('r9');
  });

  it('503 na restauração mantém a sessão guardada e fica unavailable; depois recupera', async () => {
    let up = false;
    const { session, storage } = setup(
      () => (up ? { status: 200, json: refreshRes(2) } : { status: 503 }),
      { refreshToken: 'r1', userId: 'u1', nickname: 'Zé' },
    );
    expect((await session.start()).status).toBe('unavailable');
    expect(session.getState().user?.id).toBe('u1');
    expect((await storage.load())?.refreshToken).toBe('r1');
    up = true;
    expect((await session.start()).status).toBe('authenticated');
  });

  it('rede fora no primeiro acesso: unavailable, sem armazenamento', async () => {
    const { session, storage } = setup(() => 'throw');
    expect((await session.start()).status).toBe('unavailable');
    expect(await storage.load()).toBeNull();
  });

  it('start concorrente compartilha a mesma execução', async () => {
    const { session, calls } = setup(() => ({ status: 201, json: guestRes(1) }));
    await Promise.all([session.start(), session.start()]);
    expect(calls).toHaveLength(1);
    await session.start(); // já autenticado: sem rede
    expect(calls).toHaveLength(1);
  });
});

describe('ensureAccessToken', () => {
  it('devolve o token se faltar mais de 60 s; renova se faltar menos', async () => {
    const now = { t: 1_000_000 };
    const { session, calls } = setup(
      (r) =>
        r.path === '/auth/guest'
          ? { status: 201, json: guestRes(1) }
          : { status: 200, json: refreshRes(2) },
      null,
      now,
    );
    await session.start();
    expect(await session.ensureAccessToken()).toBe('a1');
    now.t += 839_000; // faltam 61 s
    expect(await session.ensureAccessToken()).toBe('a1');
    now.t += 2_000; // faltam 59 s
    expect(await session.ensureAccessToken()).toBe('a2');
    expect(calls.map((c) => c.path)).toEqual(['/auth/guest', '/auth/refresh']);
  });

  it('renovações concorrentes viram uma só', async () => {
    const now = { t: 1_000_000 };
    const { session, calls } = setup(
      (r) =>
        r.path === '/auth/guest'
          ? { status: 201, json: guestRes(1) }
          : { status: 200, json: refreshRes(2) },
      null,
      now,
    );
    await session.start();
    now.t += 880_000;
    const [a, b] = await Promise.all([session.ensureAccessToken(), session.ensureAccessToken()]);
    expect([a, b]).toEqual(['a2', 'a2']);
    expect(calls.filter((c) => c.path === '/auth/refresh')).toHaveLength(1);
  });

  it('sem sessão lança SESSION_REQUIRED', async () => {
    const { session } = setup(() => ({ status: 200, json: {} }));
    await expect(session.ensureAccessToken()).rejects.toThrow('SESSION_REQUIRED');
  });

  it('notifica troca de access e permite cancelar a inscrição', async () => {
    const { session } = setup((r) =>
      r.path === '/auth/guest'
        ? { status: 201, json: guestRes(1) }
        : { status: 200, json: refreshRes(2) },
    );
    const tokens: (string | null)[] = [];
    const off = session.onAccessTokenChange((t) => tokens.push(t));
    await session.start();
    await session.forceRefresh();
    off();
    await session.forceRefresh();
    expect(tokens).toEqual(['a1', 'a2']);
  });
});

describe('logout', () => {
  it('revoga o refresh atual e limpa tudo', async () => {
    const { session, storage, calls } = setup((r) =>
      r.path === '/auth/logout' ? { status: 204 } : { status: 201, json: guestRes(1) },
    );
    await session.start();
    await session.logout();
    const lo = calls.find((c) => c.path === '/auth/logout');
    expect(lo?.body).toEqual({ refreshToken: 'r1' });
    expect(lo?.headers['authorization']).toBe('Bearer a1');
    expect(await storage.load()).toBeNull();
    expect(session.getAccessToken()).toBeNull();
    expect(session.getState()).toEqual({ status: 'signedOut', user: null });
  });

  it('com a rede fora limpa o armazenamento mesmo assim', async () => {
    let down = false;
    const { session, storage } = setup(() => (down ? 'throw' : { status: 201, json: guestRes(1) }));
    await session.start();
    down = true;
    await expect(session.logout()).resolves.toBeUndefined();
    expect(await storage.load()).toBeNull();
    expect(session.getState().status).toBe('signedOut');
  });

  it('com access vencido renova antes e revoga o refresh já rotacionado', async () => {
    const now = { t: 1_000_000 };
    const { session, calls } = setup(
      (r) => {
        if (r.path === '/auth/guest') return { status: 201, json: guestRes(1) };
        if (r.path === '/auth/refresh') return { status: 200, json: refreshRes(2) };
        return { status: 204 };
      },
      null,
      now,
    );
    await session.start();
    now.t += 900_000;
    await session.logout();
    expect(calls.find((c) => c.path === '/auth/logout')?.body).toEqual({ refreshToken: 'r2' });
  });

  it('sem sessão não chama a rede e termina signedOut', async () => {
    const { session, calls } = setup(() => ({ status: 200, json: {} }));
    await session.logout();
    expect(calls).toHaveLength(0);
    expect(session.getState().status).toBe('signedOut');
  });
});

describe('setNickname', () => {
  it('atualiza usuário em memória e no armazenamento', async () => {
    const { session, storage } = setup((r) =>
      r.path === '/me'
        ? { status: 200, json: { nickname: 'Novo' } }
        : { status: 201, json: guestRes(1) },
    );
    await session.start();
    await session.setNickname('Novo');
    expect(session.getState().user?.nickname).toBe('Novo');
    expect((await storage.load())?.nickname).toBe('Novo');
  });

  it('sem usuário não faz nada além da chamada', async () => {
    const { session } = setup(() => ({ status: 200, json: { nickname: 'X' } }));
    await expect(session.setNickname('X')).rejects.toThrow();
  });
});

it('estado é observável e cancelável', async () => {
  const { session } = setup(() => ({ status: 201, json: guestRes(1) }));
  const seen: SessionState[] = [];
  const off = session.subscribe((s) => seen.push(s));
  off();
  await session.start();
  expect(seen).toHaveLength(0);
});

describe('refresh perdido no caminho (timeout, rede, corpo inválido)', () => {
  const STORED = { refreshToken: 'r1', userId: 'u1', nickname: 'Zé' };
  const refreshCalls = (calls: RecordedRequest[]) =>
    calls.filter((c) => c.path === '/auth/refresh');

  it.each([
    ['rede', 'throw' as const],
    ['corpo inválido', { status: 200, text: 'nao-json' }],
    ['200 vazio', { status: 200 }],
  ])('%s: repete UMA vez na hora com o MESMO refresh e adota o par da graça', async (_n, fail) => {
    let n = 0;
    const { session, storage, calls } = setup(
      () => (++n === 1 ? fail : { status: 200, json: refreshRes(2) }),
      STORED,
    );
    expect((await session.start()).status).toBe('authenticated');
    expect(
      refreshCalls(calls).map((c) => (c.body as { refreshToken: string }).refreshToken),
    ).toEqual(['r1', 'r1']);
    expect((await storage.load())?.refreshToken).toBe('r2');
  });

  it('timeout: também repete uma vez', async () => {
    let n = 0;
    const storage = createMemoryTokenStorage(STORED);
    const f = fakeFetch(() => (++n === 1 ? 'hang' : { status: 200, json: refreshRes(2) }));
    const session = createSession({ storage, baseUrl: 'http://x', fetch: f.fetch, timeoutMs: 10 });
    expect((await session.start()).status).toBe('authenticated');
    expect(n).toBe(2);
  });

  it('segunda falha: unavailable SEM descartar o refresh antigo; depois recupera com ele', async () => {
    let up = false;
    const { session, storage, calls } = setup(
      () => (up ? { status: 200, json: refreshRes(2) } : 'throw'),
      STORED,
    );
    expect((await session.start()).status).toBe('unavailable');
    expect(refreshCalls(calls)).toHaveLength(2); // 1 tentativa + 1 repetição, sem laço
    expect((await storage.load())?.refreshToken).toBe('r1');
    expect(session.getState().user?.id).toBe('u1');
    up = true;
    expect((await session.start()).status).toBe('authenticated');
    expect((refreshCalls(calls).at(-1)?.body as { refreshToken: string }).refreshToken).toBe('r1');
  });

  it('503 e 401 NÃO repetem na hora', async () => {
    const a = setup(() => ({ status: 503 }), STORED);
    await a.session.start();
    expect(refreshCalls(a.calls)).toHaveLength(1);
    const b = setup(
      (r) =>
        r.path === '/auth/refresh'
          ? { status: 401, json: { error: { code: 'INVALID_REFRESH_TOKEN' } } }
          : { status: 201, json: guestRes(9) },
      STORED,
    );
    await b.session.start();
    expect(refreshCalls(b.calls)).toHaveLength(1);
  });
});

describe('promoção de status', () => {
  it('refresh bem-sucedido depois de unavailable volta para authenticated', async () => {
    let up = false;
    const { session } = setup(() => (up ? { status: 200, json: refreshRes(2) } : { status: 503 }), {
      refreshToken: 'r1',
      userId: 'u1',
      nickname: 'Zé',
    });
    expect((await session.start()).status).toBe('unavailable');
    up = true;
    await session.ensureAccessToken();
    expect(session.getState()).toMatchObject({ status: 'authenticated', user: { id: 'u1' } });
  });
});

describe('corrida logout x start', () => {
  it('guest que termina depois do logout é descartado e nada é gravado', async () => {
    let release!: (r: { status: number; json: unknown }) => void;
    const pending = new Promise<{ status: number; json: unknown }>((r) => (release = r));
    let first = true;
    const { session, storage } = setup(() => {
      if (first) {
        first = false;
        return pending;
      }
      return { status: 201, json: guestRes(2) };
    });
    const started = session.start();
    await tick();
    await session.logout();
    release({ status: 201, json: guestRes(1) });
    const result = await started;
    expect(result).toEqual({ status: 'signedOut', user: null });
    expect(session.getState()).toEqual({ status: 'signedOut', user: null });
    expect(session.getAccessToken()).toBeNull();
    expect(await storage.load()).toBeNull();
    // Um start() novo cria outra sessão normalmente.
    expect((await session.start()).user?.id).toBe('u2');
  });

  it('restauração (refresh) que termina depois do logout não ressuscita a sessão', async () => {
    let release!: (r: { status: number; json: unknown }) => void;
    const pending = new Promise<{ status: number; json: unknown }>((r) => (release = r));
    const { session, storage } = setup(
      (r) => (r.path === '/auth/refresh' ? pending : { status: 204 }),
      { refreshToken: 'r1', userId: 'u1', nickname: 'Zé' },
    );
    const started = session.start();
    await tick();
    const loggingOut = session.logout(); // espera o refresh em voo (fila única) e então encerra
    release({ status: 200, json: refreshRes(2) });
    await Promise.all([started, loggingOut]);
    expect(session.getState()).toEqual({ status: 'signedOut', user: null });
    expect(session.getAccessToken()).toBeNull();
    expect(await storage.load()).toBeNull();
  });
});
