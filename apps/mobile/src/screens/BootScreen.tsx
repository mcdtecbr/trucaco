import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { normalizeCodeInput } from '../lobby/codeInput';
import { getApp } from '../services/app';
import { useSessionStore } from '../store/sessionStore';
import { BootView } from './BootView';

/**
 * Splash: restaura a sessão ou cria convidado. Rede/503 NÃO cria convidado novo (estado `unavailable`
 * mantém a sessão guardada). Com `?code=` (deep link) segue para o início com o campo preenchido.
 */
export function BootScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();
  const status = useSessionStore((s) => s.status);

  useEffect(() => {
    void getApp().session.start();
  }, []);

  useEffect(() => {
    if (status !== 'authenticated') return;
    const code = typeof params.code === 'string' ? normalizeCodeInput(params.code) : '';
    if (code !== '') router.replace({ pathname: '/home', params: { code } });
    else router.replace('/home');
  }, [status, params.code, router]);

  return (
    <BootView
      phase={status === 'unavailable' ? 'unavailable' : 'loading'}
      onRetry={() => void getApp().session.start()}
    />
  );
}
