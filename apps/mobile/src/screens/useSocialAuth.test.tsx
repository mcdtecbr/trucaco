// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createIdentityRegistry } from '../net/identity';
import type { SocialAuthPanelProps } from './SocialAuthPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  health: vi.fn(),
  linkAccount: vi.fn(),
  loginSocial: vi.fn(),
  registry: { current: null as unknown },
}));

vi.mock('../net/identity', async (orig) => {
  const real = await orig<typeof import('../net/identity')>();
  const registry = real.createIdentityRegistry();
  mocks.registry.current = registry;
  return { ...real, identityRegistry: registry };
});
vi.mock('../services/app', () => ({
  getApp: () => ({
    session: {
      api: { health: mocks.health },
      linkAccount: mocks.linkAccount,
      loginSocial: mocks.loginSocial,
    },
  }),
}));

const { useSocialAuth } = await import('./useSocialAuth');
const registry = mocks.registry.current as ReturnType<typeof createIdentityRegistry>;
const { health, linkAccount, loginSocial } = mocks;

let latest: SocialAuthPanelProps;
function Probe({ onDone }: { onDone: () => void }) {
  latest = useSocialAuth('link', onDone);
  return null;
}

async function mount(onDone = vi.fn()) {
  const root = createRoot(document.createElement('div'));
  await act(async () => {
    root.render(<Probe onDone={onDone} />);
  });
  return { root, onDone };
}

const avail = () => latest.providers.map((p) => `${p.id}:${p.available}`);

describe('useSocialAuth', () => {
  beforeEach(() => {
    health.mockReset();
    linkAccount.mockReset();
    loginSocial.mockReset();
    for (const p of ['google', 'apple'] as const) {
      registry.register({
        provider: p,
        getCredential: () => Promise.resolve({ idToken: `tok-${p}` }),
      });
    }
  });

  it('botão ativo só se o servidor liga o provedor E há SDK', async () => {
    health.mockResolvedValue({ status: 'ok', protocol: 6, socialProviders: ['google'] });
    await mount();
    expect(health).toHaveBeenCalledOnce();
    expect(avail()).toEqual(['google:true', 'apple:false']);
  });

  it('servidor sem provedores desliga todos; falha do /health vale só o SDK', async () => {
    health.mockResolvedValue({ status: 'ok', protocol: 6, socialProviders: [] });
    await mount();
    expect(avail()).toEqual(['google:false', 'apple:false']);
    health.mockRejectedValue(new Error('x'));
    await mount();
    expect(avail()).toEqual(['google:true', 'apple:true']);
  });

  it('vincula e chama onDone; PROVIDER_TAKEN mostra texto e oferece entrar na conta existente', async () => {
    health.mockResolvedValue({ status: 'ok', protocol: 6, socialProviders: ['google'] });
    linkAccount.mockResolvedValueOnce(undefined);
    const { onDone } = await mount();
    await act(async () => latest.on.press('google'));
    expect(linkAccount).toHaveBeenCalledWith({ provider: 'google', idToken: 'tok-google' });
    expect(onDone).toHaveBeenCalledOnce();

    const { ApiError } = await import('../net/api');
    linkAccount.mockRejectedValueOnce(
      new ApiError({ status: 409, code: 'PROVIDER_TAKEN', kind: 'http' }),
    );
    await act(async () => latest.on.press('google'));
    expect(latest.offerLogin).toBe(true);
    expect(latest.error).toContain('já está em uso');
    loginSocial.mockResolvedValueOnce(undefined);
    await act(async () => latest.on.loginExisting());
    expect(loginSocial).toHaveBeenCalledOnce();
  });

  it('SOCIAL_LOGIN_DISABLED desliga o provedor na tela', async () => {
    health.mockResolvedValue({ status: 'ok', protocol: 6, socialProviders: ['google', 'apple'] });
    const { ApiError } = await import('../net/api');
    linkAccount.mockRejectedValueOnce(
      new ApiError({ status: 503, code: 'SOCIAL_LOGIN_DISABLED', kind: 'unavailable' }),
    );
    await mount();
    await act(async () => latest.on.press('apple'));
    expect(avail()).toEqual(['google:true', 'apple:false']);
  });
});
