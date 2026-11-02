import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { normalizeCodeInput } from '../lobby/codeInput';
import { prefillCode, startHome } from '../lobby/homeLifecycle';
import { createLobbyController } from '../lobby/lobbyController';
import {
  lobbyStore,
  queueRemainingSeconds,
  retryRemainingSeconds,
  useLobbyStore,
} from '../store/lobbyStore';
import { sessionStore, useSessionStore, selectNickname } from '../store/sessionStore';
import { getApp } from '../services/app';
import { HomeView } from './HomeView';
import type { QueueForm, TableForm } from './HomeView';
import { useNow } from './useNow';

export function HomeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();
  const nickname = useSessionStore(selectNickname);
  const lostSession = useSessionStore((s) => s.lostPrevious);
  const queue = useLobbyStore((s) => s.queue);
  const busy = useLobbyStore((s) => s.busy);
  const error = useLobbyStore((s) => s.error);
  const notice = useLobbyStore((s) => s.notice);
  const resumeNotice = useLobbyStore((s) => s.resumeNotice);

  const [table, setTable] = useState<TableForm>({
    variant: 'paulista',
    format: 'single',
    ironHand: true,
  });
  const [queueForm, setQueueForm] = useState<QueueForm>({ variant: 'paulista', ironHand: true });
  // Deep link `trucaco://table/CODE` só PREENCHE o campo; entrar é sempre ação do usuário.
  const [code, setCode] = useState(() => prefillCode(params.code));

  const controller = useMemo(() => {
    const app = getApp();
    return createLobbyController({
      api: app.session.api,
      store: lobbyStore,
      enter: (reservation) => app.rooms.enter(reservation),
      onEntered: (roomCode) =>
        router.push({ pathname: '/table/[code]', params: { code: roomCode } }),
      abandon: () => void app.rooms.leave(),
    });
  }, [router]);

  useEffect(() => startHome(controller, lobbyStore), [controller]);

  const queued = queue.status === 'queued';
  const retrying = error?.retryUntil !== undefined;
  const now = useNow(queued || retrying);
  const retryRemaining = retryRemainingSeconds(error, now);
  // Terminou o Retry-After: o erro some e o botão volta.
  useEffect(() => {
    if (retrying && retryRemaining === 0) lobbyStore.getState().setError(null);
  }, [retrying, retryRemaining]);

  return (
    <HomeView
      nickname={nickname}
      lostSession={lostSession}
      resumeNotice={resumeNotice}
      queueExpired={notice === 'queueExpired'}
      table={table}
      code={code}
      queueForm={queueForm}
      queue={queue}
      remainingSeconds={queueRemainingSeconds(queue, now)}
      busy={busy}
      error={error}
      retryRemaining={retryRemaining}
      on={{
        dismissLost: () => sessionStore.getState().dismissLost(),
        dismissResumeNotice: () => lobbyStore.getState().setResumeNotice(null),
        table: setTable,
        create: () => void controller.createTable(table),
        code: (text) => setCode(normalizeCodeInput(text)),
        join: () => void controller.joinByCode(code),
        queueForm: setQueueForm,
        queueStart: () => void controller.startQueue(queueForm),
        queueCancel: () => void controller.cancelQueue(),
        settings: () => router.push('/settings'),
      }}
    />
  );
}
