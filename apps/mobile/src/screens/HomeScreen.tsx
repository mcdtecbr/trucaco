import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { normalizeCodeInput } from '../lobby/codeInput';
import { createLobbyController } from '../lobby/lobbyController';
import { lobbyStore, queueRemainingSeconds, useLobbyStore } from '../store/lobbyStore';
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

  const [table, setTable] = useState<TableForm>({
    variant: 'paulista',
    format: 'single',
    ironHand: true,
  });
  const [queueForm, setQueueForm] = useState<QueueForm>({ variant: 'paulista', ironHand: true });
  // Deep link `trucaco://table/CODE` só PREENCHE o campo; entrar é sempre ação do usuário.
  const [code, setCode] = useState(() =>
    typeof params.code === 'string' ? normalizeCodeInput(params.code) : '',
  );

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

  useEffect(() => {
    // Ao entrar na tela, nada de erro ou aviso de uma visita anterior.
    lobbyStore.getState().setError(null);
    lobbyStore.getState().setNotice(null);
    return () => controller.dispose();
  }, [controller]);

  const queued = queue.status === 'queued';
  const now = useNow(queued);

  return (
    <HomeView
      nickname={nickname}
      lostSession={lostSession}
      queueExpired={notice === 'queueExpired'}
      table={table}
      code={code}
      queueForm={queueForm}
      queue={queue}
      remainingSeconds={queueRemainingSeconds(queue, now)}
      busy={busy}
      error={error}
      on={{
        dismissLost: () => sessionStore.getState().dismissLost(),
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
