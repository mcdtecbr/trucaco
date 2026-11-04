import type { SocialProvider } from '@trucaco/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { providerStates, runSocialAuth, serverProvidersOf } from '../lobby/socialAuth';
import type { SocialMode } from '../lobby/socialAuth';
import { identityRegistry } from '../net/identity';
import { getApp } from '../services/app';
import type { SocialAuthPanelProps } from './SocialAuthPanel';

/**
 * Estado do painel de login social. `onDone` roda depois de sessão atualizada (ex.: navegar).
 * Provedor sem SDK, ou que o servidor respondeu `SOCIAL_LOGIN_DISABLED`, fica "indisponível".
 */
export function useSocialAuth(mode: SocialMode, onDone: () => void): SocialAuthPanelProps {
  const alive = useRef(true);
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offerLogin, setOfferLogin] = useState(false);
  const [disabled, setDisabled] = useState<readonly SocialProvider[]>([]);
  const [server, setServer] = useState<readonly SocialProvider[] | null>(null);
  const last = useRef<SocialProvider | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Uma leitura de /health por montagem: o servidor diz quais provedores liga. Falha = sem informação.
  useEffect(() => {
    void getApp()
      .session.api.health()
      .then((h) => {
        if (alive.current) setServer(serverProvidersOf(h));
      })
      .catch(() => undefined);
  }, []);

  const run = useCallback(
    async (as: SocialMode, id: SocialProvider): Promise<void> => {
      if (busy !== null) return;
      last.current = id;
      setBusy(id);
      setError(null);
      setOfferLogin(false);
      const out = await runSocialAuth({
        mode: as,
        provider: id,
        registry: identityRegistry,
        session: getApp().session,
      });
      if (!alive.current && out.kind !== 'done') return;
      setBusy(null);
      if (out.kind === 'done') onDone();
      else if (out.kind === 'unavailable') {
        setDisabled((cur) => (cur.includes(id) ? cur : [...cur, id]));
        setError(out.message);
      } else if (out.kind === 'error') {
        setError(out.message);
        setOfferLogin(out.offerLogin);
      }
    },
    [busy, onDone],
  );

  return {
    mode,
    providers: providerStates(identityRegistry, server, disabled),
    busy,
    error,
    offerLogin,
    on: {
      press: (id) => void run(mode, id),
      loginExisting: () => {
        if (last.current !== null) void run('login', last.current);
      },
    },
  };
}
