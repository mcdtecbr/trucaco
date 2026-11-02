import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { SHARE_DONE_TEXT, SHARE_FAILED_TEXT, SHARE_LABEL, shareCode } from '../platform/shareCode';
import { getApp } from '../services/app';
import { useRoomStore } from '../store/roomStore';
import { TablePlaceholderView, WaitingRoomView } from './WaitingRoomView';
import { decideWaitingRoute, exitTable } from './waitingRoute';

/**
 * Rota `/table/[code]`. A sala já foi aberta pelo início (`roomService.enter`). Sem sala (recarregou,
 * deep link) ou com sala de OUTRO código, só redireciona: o componente que faz `leave()` no cleanup
 * (`JoinedTable`) nem chega a montar, então um redirect nunca derruba a sala atual.
 */
export function WaitingRoomScreen() {
  const params = useLocalSearchParams<{ code?: string }>();
  const connection = useRoomStore((s) => s.connection);
  const roomCode = useRoomStore((s) => s.roomCode);
  const route = decideWaitingRoute({ connection, paramCode: params.code, roomCode });
  if (route.kind === 'toHome') {
    return (
      <Redirect
        href={{ pathname: '/home', params: route.code !== '' ? { code: route.code } : {} }}
      />
    );
  }
  if (route.kind === 'toCurrent') {
    return <Redirect href={{ pathname: '/table/[code]', params: { code: route.code } }} />;
  }
  return <JoinedTable />;
}

function JoinedTable() {
  const router = useRouter();
  const connection = useRoomStore((s) => s.connection);
  const roomCode = useRoomStore((s) => s.roomCode);
  const seats = useRoomStore((s) => s.seats);
  const mySeat = useRoomStore((s) => s.mySeat);
  const tablePhase = useRoomStore((s) => s.tablePhase);
  const errorCode = useRoomStore((s) => s.errorCode);
  const [feedback, setFeedback] = useState<'idle' | 'done' | 'failed'>('idle');

  // Saiu da tela (voltar, trocar de rota, fechar): sai da sala de forma consentida.
  useEffect(() => {
    return () => {
      void getApp().rooms.leave();
    };
  }, []);

  const leave = useCallback(() => exitTable(getApp().rooms, router), [router]);

  const share = useCallback(() => {
    void shareCode(roomCode).then((o) => setFeedback(o === 'dismissed' ? 'idle' : o));
  }, [roomCode]);

  if (tablePhase === 'playing' || tablePhase === 'finished') {
    return (
      <TablePlaceholderView roomCode={roomCode} seats={seats} mySeat={mySeat} onLeave={leave} />
    );
  }

  return (
    <WaitingRoomView
      roomCode={roomCode}
      seats={seats}
      mySeat={mySeat}
      connection={connection}
      errorCode={errorCode}
      shareLabel={SHARE_LABEL}
      shareDoneText={SHARE_DONE_TEXT}
      shareFailedText={SHARE_FAILED_TEXT}
      shareFeedback={feedback}
      on={{ share, leave }}
    />
  );
}
