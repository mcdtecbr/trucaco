import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { normalizeCodeInput } from '../lobby/codeInput';
import { getApp } from '../services/app';
import { lobbyStore } from '../store/lobbyStore';
import { roomStore } from '../store/roomStore';
import { useSessionStore } from '../store/sessionStore';
import { BootView } from './BootView';
import { decideBoot } from './bootResume';

/** `checking`: procura mesa guardada; `resuming`: voltando a ela; `done`: segue para o início. */
type Stage = 'checking' | 'resuming' | 'done';

/**
 * Splash: restaura a sessão ou cria convidado. Rede/503 NÃO cria convidado novo (estado `unavailable`
 * mantém a sessão guardada). Com sessão pronta e uma mesa guardada (recarregou a página da mesa, reabriu o
 * app), tenta voltar ao assento ANTES de ir ao início. Com `?code=` (deep link) segue para o início com o
 * campo preenchido.
 */
export function BootScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();
  const status = useSessionStore((s) => s.status);
  const [stage, setStage] = useState<Stage>('checking');
  const started = useRef(false);
  /** Mesa que não voltou: vai no parâmetro `code` da tela inicial (campo preenchido). */
  const [retryCode, setRetryCode] = useState('');

  useEffect(() => {
    void getApp().session.start();
  }, []);

  // Sessão válida: antes de qualquer redirecionamento para o início, tenta retomar a mesa guardada.
  useEffect(() => {
    if (status !== 'authenticated' || started.current) return;
    started.current = true; // uma decisão só, mesmo com o efeito re-executado (Strict Mode, troca de `stage`)
    const app = getApp();
    void decideBoot(app.resume, {
      onResuming: () => setStage('resuming'),
      heldRoomCode: () => (app.rooms.current() === null ? null : roomStore.getState().roomCode),
    }).then((decision) => {
      if (decision.kind === 'table') {
        router.replace({ pathname: '/table/[code]', params: { code: decision.code } });
        return;
      }
      if (decision.kind === 'restartSession') {
        setStage('done');
        void getApp().session.start(); // sessão perdida na retomada: novo convidado
        return;
      }
      lobbyStore.getState().setResumeNotice(decision.notice);
      if (decision.code !== undefined) setRetryCode(decision.code);
      setStage('done');
    });
  }, [status, router]);

  useEffect(() => {
    if (status !== 'authenticated' || stage !== 'done') return;
    const link = typeof params.code === 'string' ? normalizeCodeInput(params.code) : '';
    const code = retryCode !== '' ? retryCode : link;
    if (code !== '') router.replace({ pathname: '/home', params: { code } });
    else router.replace('/home');
  }, [status, stage, params.code, retryCode, router]);

  return (
    <BootView
      phase={
        status === 'unavailable' ? 'unavailable' : stage === 'resuming' ? 'resuming' : 'loading'
      }
      onRetry={() => void getApp().session.start()}
      legal={{ onTerms: () => router.push('/terms'), onPrivacy: () => router.push('/privacy') }}
    />
  );
}
