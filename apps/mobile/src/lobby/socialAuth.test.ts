import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../net/api';
import { createIdentityRegistry } from '../net/identity';
import { errorMessage } from '../i18n/errors';
import { NO_SDK_TEXT, providerStates, runSocialAuth, serverProvidersOf } from './socialAuth';

const seen: string[] = [];

function setup(over: { cred?: { idToken: string } | null | 'throw' } = {}) {
  const registry = createIdentityRegistry();
  const cred = over.cred === undefined ? { idToken: 'tok' } : over.cred;
  registry.register({
    provider: 'google',
    getCredential: (nonce: string) =>
      cred === 'throw'
        ? Promise.reject(new Error('sdk'))
        : (seen.push(nonce), Promise.resolve(cred)),
  });
  const session = {
    loginSocial: vi.fn<(req: unknown) => Promise<void>>(() => Promise.resolve()),
    linkAccount: vi.fn<(req: unknown) => Promise<void>>(() => Promise.resolve()),
    fetchNonce: vi.fn<() => Promise<string>>(() => Promise.resolve('n')),
  };
  return { registry, session };
}

const apiErr = (code: ConstructorParameters<typeof ApiError>[0]['code'], status = 409) =>
  new ApiError({ status, code, kind: 'http' });

describe('runSocialAuth', () => {
  it('sem SDK registrado: indisponível, sem chamar a sessão', async () => {
    const session = { loginSocial: vi.fn(), linkAccount: vi.fn(), fetchNonce: vi.fn() };
    const out = await runSocialAuth({
      mode: 'link',
      provider: 'apple',
      registry: createIdentityRegistry(),
      session,
    });
    expect(out).toEqual({ kind: 'unavailable', message: NO_SDK_TEXT });
    expect(session.linkAccount).not.toHaveBeenCalled();
    expect(session.fetchNonce).not.toHaveBeenCalled();
  });

  it('busca o nonce no servidor, entrega ao provedor e vincula com idToken e nonce', async () => {
    const { registry, session } = setup();
    expect(await runSocialAuth({ mode: 'link', provider: 'google', registry, session })).toEqual({
      kind: 'done',
    });
    expect(session.linkAccount).toHaveBeenCalledWith({
      provider: 'google',
      idToken: 'tok',
      nonce: 'n',
    });
    expect(session.loginSocial).not.toHaveBeenCalled();
    expect(seen.at(-1)).toBe('n'); // o SDK recebeu o nonce do servidor
  });

  it('entrar usa loginSocial; cancelar o fluxo não chama a rede', async () => {
    const a = setup();
    await runSocialAuth({ mode: 'login', provider: 'google', ...a });
    expect(a.session.loginSocial).toHaveBeenCalledOnce();
    const b = setup({ cred: null });
    expect(await runSocialAuth({ mode: 'login', provider: 'google', ...b })).toEqual({
      kind: 'cancelled',
    });
    expect(b.session.loginSocial).not.toHaveBeenCalled();
  });

  it('falha ao buscar o nonce: o provedor nem é aberto; SOCIAL_LOGIN_DISABLED vira indisponível', async () => {
    const { registry, session } = setup();
    const before = seen.length;
    session.fetchNonce.mockRejectedValueOnce(apiErr('SOCIAL_LOGIN_DISABLED', 503));
    const out = await runSocialAuth({ mode: 'login', provider: 'google', registry, session });
    expect(out).toMatchObject({ kind: 'unavailable' });
    session.fetchNonce.mockRejectedValueOnce(new TypeError('rede'));
    expect(
      await runSocialAuth({ mode: 'login', provider: 'google', registry, session }),
    ).toMatchObject({ kind: 'error', code: 'UNKNOWN' });
    expect(seen.length).toBe(before);
    expect(session.loginSocial).not.toHaveBeenCalled();
  });

  it('falha do SDK vira erro genérico sem vazar a mensagem', async () => {
    const { registry, session } = setup({ cred: 'throw' });
    const out = await runSocialAuth({ mode: 'login', provider: 'google', registry, session });
    expect(out).toMatchObject({ kind: 'error', code: 'UNKNOWN', offerLogin: false });
    expect(JSON.stringify(out)).not.toContain('sdk');
  });

  it.each([
    ['SOCIAL_LOGIN_DISABLED', 'unavailable'],
    ['PROVIDER_TAKEN', 'error'],
    ['ALREADY_LINKED', 'error'],
    ['INVALID_ID_TOKEN', 'error'],
  ] as const)('%s é traduzido (%s)', async (code, kind) => {
    const { registry, session } = setup();
    session.linkAccount.mockRejectedValueOnce(apiErr(code));
    const out = await runSocialAuth({ mode: 'link', provider: 'google', registry, session });
    expect(out.kind).toBe(kind);
    expect(out).toMatchObject({ message: errorMessage(code) });
  });

  it('PROVIDER_TAKEN ao vincular oferece entrar na conta existente; ao entrar, não', async () => {
    const a = setup();
    a.session.linkAccount.mockRejectedValueOnce(apiErr('PROVIDER_TAKEN'));
    expect(await runSocialAuth({ mode: 'link', provider: 'google', ...a })).toMatchObject({
      offerLogin: true,
    });
    const b = setup();
    b.session.loginSocial.mockRejectedValueOnce(apiErr('PROVIDER_TAKEN'));
    expect(await runSocialAuth({ mode: 'login', provider: 'google', ...b })).toMatchObject({
      offerLogin: false,
    });
  });
});

describe('provedores ativos: servidor E SDK', () => {
  const withSdk = (ids: ('google' | 'apple')[]) => {
    const registry = createIdentityRegistry();
    for (const provider of ids) {
      registry.register({ provider, getCredential: () => Promise.resolve(null) });
    }
    return registry;
  };

  it('serverProvidersOf lê só valores válidos; sem campo = desconhecido', () => {
    expect(serverProvidersOf({ socialProviders: ['google', 'x'] })).toEqual(['google']);
    expect(serverProvidersOf({ status: 'ok' })).toBeNull();
    expect(serverProvidersOf(null)).toBeNull();
  });

  it('ativo só com SDK e servidor; servidor sem informação vale o SDK; desligado some', () => {
    const both = withSdk(['google', 'apple']);
    expect(providerStates(both, ['google'], [])).toEqual([
      { id: 'google', available: true },
      { id: 'apple', available: false },
    ]);
    expect(providerStates(withSdk([]), ['google', 'apple'], []).every((p) => !p.available)).toBe(
      true,
    );
    expect(providerStates(both, null, []).every((p) => p.available)).toBe(true);
    expect(providerStates(both, null, ['apple'])[1]?.available).toBe(false);
  });
});
