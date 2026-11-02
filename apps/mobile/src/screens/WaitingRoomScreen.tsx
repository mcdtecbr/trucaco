import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { shareCode, SHARE_LABEL } from '../platform/shareCode';
import { getApp } from '../services/app';
import { useRoomStore } from '../store/roomStore';
import { TablePlaceholderView, WaitingRoomView } from './WaitingRoomView';

/**
 * Sala de espera de `/table/[code]`. A sala já foi aberta pelo início (`roomService.enter`). Sem sala
 * (recarregou a página, deep link): volta ao início com o campo preenchido, sem entrar sozinho.
 */
export function WaitingRoomScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();
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

  const leave = useCallback(() => {
    void getApp().rooms.leave();
    // Volta para o início que está embaixo na pilha (evita um segundo `/home` empilhado).
    if (router.canGoBack()) router.back();
    else router.replace('/home');
  }, [router]);

  const share = useCallback(() => {
    void shareCode(roomCode).then((ok) => setFeedback(ok ? 'done' : 'failed'));
  }, [roomCode]);

  if (connection === 'none') {
    const code = typeof params.code === 'string' ? params.code : '';
    return <Redirect href={{ pathname: '/home', params: code !== '' ? { code } : {} }} />;
  }

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
      shareFeedback={feedback}
      on={{ share, leave }}
    />
  );
}
