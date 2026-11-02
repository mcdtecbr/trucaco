import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';
import { selectIsReady, useSessionStore } from '../store/sessionStore';

/** Telas autenticadas: sem sessão pronta (recarregou a página, logout) volta ao splash. */
export function RequireSession({ children }: { children: ReactNode }) {
  const ready = useSessionStore(selectIsReady);
  if (!ready) return <Redirect href="/" />;
  return <>{children}</>;
}
