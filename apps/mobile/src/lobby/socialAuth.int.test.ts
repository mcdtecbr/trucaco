/**
 * Login social e vínculo de conta (Fase 6, bloco 6H) com a `Session` REAL do cliente contra o servidor REAL
 * (`apps/server/dist/main.js`) com o verificador de identidade de TESTE (`AUTH_TEST_IDENTITY=1`, idToken
 * `test:<sub>[:<sufixo>]`). O que o botão faz na UI (`runSocialAuth`) roda inteiro; só o SDK do Google é
 * trocado por um `IdentityProvider` de teste. Rode com `pnpm --filter @trucaco/mobile test:int` (precisa de
 * `pnpm build` antes).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createIdentityRegistry } from '../net/identity';
import type { IdentityProvider } from '../net/identity';
import { startServer } from '../net/integrationServer';
import type { RunningServer } from '../net/integrationServer';
import { createSession } from '../net/session';
import type { Session } from '../net/session';
import { createMemoryTokenStorage } from '../net/tokenStorageCore';
import { NO_SDK_TEXT, providerStates, runSocialAuth, serverProvidersOf } from './socialAuth';

let server: RunningServer;
let disabledServer: RunningServer;
const sessions: Session[] = [];

beforeAll(async () => {
  server = await startServer({ AUTH_TEST_IDENTITY: '1' });
  disabledServer = await startServer();
});
afterAll(async () => {
  for (const s of sessions) s.dispose();
  await server.stop();
  await disabledServer.stop();
});

async function guest(baseUrl = server.url): Promise<Session> {
  const session = createSession({ storage: createMemoryTokenStorage(), baseUrl });
  expect((await session.start()).status).toBe('authenticated');
  sessions.push(session);
  return session;
}

let counter = 0;
const uniqueSub = (label: string): string => `${label}${Date.now().toString(36)}${counter++}`;

/** Provedor de teste: devolve o token dado (um por chamada, na ordem), ou cancela quando acabam. */
function googleReturning(...tokens: (string | null)[]) {
  const queue = [...tokens];
  const registry = createIdentityRegistry();
  const provider: IdentityProvider = {
    provider: 'google',
    getCredential: () => {
      const next = queue.shift();
      return Promise.resolve(next === undefined || next === null ? null : { idToken: next });
    },
  };
  registry.register(provider);
  return registry;
}

describe('vincular conta de convidado (modo link)', () => {
  it('convidado vincula ao Google: mesmo usuário, provider google na sessão e em GET /me', async () => {
    const session = await guest();
    const before = session.getState().user;
    expect(before?.provider).toBe('guest');
    const sub = uniqueSub('link');
    const out = await runSocialAuth({
      mode: 'link',
      provider: 'google',
      registry: googleReturning(`test:${sub}`),
      session,
    });
    expect(out).toEqual({ kind: 'done' });
    const after = session.getState().user;
    expect(after).toMatchObject({ id: before?.id, provider: 'google' });
    // O servidor concorda e a sessão nova (access renovado) funciona.
    const me = await session.api.me();
    expect(me).toMatchObject({ id: before?.id, provider: 'google' });
  });

  it('vincular uma conta que já é Google devolve ALREADY_LINKED, sem oferecer "entrar na conta existente"', async () => {
    const session = await guest();
    const reg = googleReturning(`test:${uniqueSub('a1')}`, `test:${uniqueSub('a2')}`);
    expect(
      await runSocialAuth({ mode: 'link', provider: 'google', registry: reg, session }),
    ).toEqual({ kind: 'done' });
    const second = await runSocialAuth({
      mode: 'link',
      provider: 'google',
      registry: reg,
      session,
    });
    expect(second).toMatchObject({ kind: 'error', code: 'ALREADY_LINKED', offerLogin: false });
    expect(session.getState().user?.provider).toBe('google');
  });

  it('PROVIDER_TAKEN: o vínculo falha oferecendo entrar na conta existente; o convidado segue convidado', async () => {
    const sub = uniqueSub('taken');
    // Conta social que já existe, com apelido próprio.
    const owner = await guest();
    await runSocialAuth({
      mode: 'link',
      provider: 'google',
      registry: googleReturning(`test:${sub}:a`),
      session: owner,
    });
    await owner.setNickname('Original');
    const ownerId = owner.getState().user?.id;

    const visitor = await guest();
    const visitorId = visitor.getState().user?.id;
    const reg = googleReturning(`test:${sub}:b`, `test:${sub}:c`);
    const taken = await runSocialAuth({
      mode: 'link',
      provider: 'google',
      registry: reg,
      session: visitor,
    });
    expect(taken).toMatchObject({ kind: 'error', code: 'PROVIDER_TAKEN', offerLogin: true });
    expect(visitor.getState().user).toMatchObject({ id: visitorId, provider: 'guest' });
    expect(await visitor.api.me()).toMatchObject({ id: visitorId, provider: 'guest' });

    // "Entrar na conta existente" (modo login com o mesmo provedor): a sessão passa a ser a da conta original.
    const entered = await runSocialAuth({
      mode: 'login',
      provider: 'google',
      registry: reg,
      session: visitor,
    });
    expect(entered).toEqual({ kind: 'done' });
    expect(visitor.getState().user).toMatchObject({
      id: ownerId,
      nickname: 'Original',
      provider: 'google',
    });
    expect(await visitor.api.me()).toMatchObject({ id: ownerId, nickname: 'Original' });
  });

  it('idToken de uso único: o mesmo token reapresentado é recusado com INVALID_ID_TOKEN', async () => {
    const token = `test:${uniqueSub('once')}:z`;
    const a = await guest();
    const b = await guest();
    const reg = googleReturning(token, token);
    expect(
      await runSocialAuth({ mode: 'login', provider: 'google', registry: reg, session: a }),
    ).toEqual({ kind: 'done' });
    const replay = await runSocialAuth({
      mode: 'login',
      provider: 'google',
      registry: reg,
      session: b,
    });
    expect(replay).toMatchObject({ kind: 'error', code: 'INVALID_ID_TOKEN', offerLogin: false });
    expect(b.getState().user?.provider).toBe('guest');
  });
});

describe('login social (modo login)', () => {
  it('conta nova é criada e a sessão fica autenticada como Google; entrar de novo traz a mesma conta', async () => {
    const sub = uniqueSub('login');
    const first = await guest();
    expect(
      await runSocialAuth({
        mode: 'login',
        provider: 'google',
        registry: googleReturning(`test:${sub}:1`),
        session: first,
      }),
    ).toEqual({ kind: 'done' });
    const id = first.getState().user?.id;
    expect(first.getState().user?.provider).toBe('google');

    const other = await guest();
    await runSocialAuth({
      mode: 'login',
      provider: 'google',
      registry: googleReturning(`test:${sub}:2`),
      session: other,
    });
    expect(other.getState().user?.id).toBe(id);
  });

  it('entrar numa conta social troca o usuário da sessão: o convidado deixado para trás não é mais o dono dela', async () => {
    const session = await guest();
    const guestId = session.getState().user?.id;
    await runSocialAuth({
      mode: 'login',
      provider: 'google',
      registry: googleReturning(`test:${uniqueSub('swap')}`),
      session,
    });
    const now = session.getState().user;
    expect(now?.id).not.toBe(guestId);
    expect((await session.api.me()).id).toBe(now?.id);
  });
});

describe('provedor indisponível e cancelamento', () => {
  it('sem SDK registrado: unavailable com o texto de "ainda não disponível", sem chamar o servidor', async () => {
    const session = await guest();
    const out = await runSocialAuth({
      mode: 'link',
      provider: 'google',
      registry: createIdentityRegistry(),
      session,
    });
    expect(out).toEqual({ kind: 'unavailable', message: NO_SDK_TEXT });
    expect(session.getState().user?.provider).toBe('guest');
  });

  it('usuário fecha o fluxo do provedor: cancelled, nada muda', async () => {
    const session = await guest();
    const out = await runSocialAuth({
      mode: 'link',
      provider: 'google',
      registry: googleReturning(null),
      session,
    });
    expect(out).toEqual({ kind: 'cancelled' });
    expect(session.getState().user?.provider).toBe('guest');
  });

  it('servidor sem credenciais responde SOCIAL_LOGIN_DISABLED: unavailable, e /health não lista provedores', async () => {
    const session = await guest(disabledServer.url);
    const health = await session.api.health();
    expect(serverProvidersOf(health)).toEqual([]);
    for (const mode of ['link', 'login'] as const) {
      const out = await runSocialAuth({
        mode,
        provider: 'google',
        registry: googleReturning('test:qualquer'),
        session,
      });
      expect(out.kind).toBe('unavailable');
    }
    expect(session.getState().user?.provider).toBe('guest');
  });

  it('/health do servidor de teste liga Google e Apple; o botão só fica ativo com SDK registrado', async () => {
    const session = await guest();
    const providers = serverProvidersOf(await session.api.health());
    expect(providers).toEqual(['google', 'apple']);
    const states = providerStates(googleReturning('x'), providers, []);
    expect(states).toEqual([
      { id: 'google', available: true },
      { id: 'apple', available: false },
    ]);
  });
});
