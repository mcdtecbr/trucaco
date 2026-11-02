import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useAnnouncer, useLayoutMode } from '@trucaco/ui';
import type { ChatScope, LegalActionId } from '@trucaco/protocol';
import type { ChatPanelProps } from './ChatPanel';
import { errorMessage } from '../i18n/errors';
import { isE2EMode } from '../net/config';
import { SHARE_DONE_TEXT, SHARE_FAILED_TEXT, SHARE_LABEL, shareCode } from '../platform/shareCode';
import { getApp } from '../services/app';
import { useRoomStore } from '../store/roomStore';
import { tableStore, effectiveDeadline, useTableStore } from '../table/tableStore';
import { connectionBanner, finishedResult, holdRoom, roomViewFor } from '../table/tableRoute';
import { buildChatPanelProps } from './chatPanelProps';
import { FinishedView } from './FinishedView';
import { TableView } from './TableView';
import { WaitingRoomView } from './WaitingRoomView';
import { decideWaitingRoute, exitTable } from './waitingRoute';

/**
 * Rota `/table/[code]`: a UMA tela dona da sala. Alterna a visão por fase (`waiting` -> espera,
 * `playing` -> mesa, `finished` -> encerrada) sem nunca largar a sala na troca de fase: o `leave()`
 * consentido fica no cleanup de `JoinedTable` (`holdRoom`), que só roda ao sair da rota de verdade.
 * Sem sala (recarregou, deep link) ou com sala de OUTRO código, só redireciona: `JoinedTable` nem monta.
 */
export function TableRoomScreen() {
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

/** Props do painel de chat a partir do store da mesa (compartilhado entre espera e mesa). */
function useChatPanel(
  nicknameOf: (seat: number) => string,
  mySeat: number,
  connected: boolean,
  scopes?: readonly ChatScope[],
): ChatPanelProps | null {
  const chatOpen = useTableStore((s) => s.chatOpen);
  const chatTab = useTableStore((s) => s.chatTab);
  const chat = useTableStore((s) => s.chat);
  const chatUnread = useTableStore((s) => s.chatUnread);
  const chatDraft = useTableStore((s) => s.chatDraft);
  const chatError = useTableStore((s) => s.chatError);
  return buildChatPanelProps({
    chatOpen,
    chatTab,
    chat,
    chatUnread,
    chatDraft,
    errorText: chatError === null ? null : errorMessage(chatError),
    connected,
    nicknameOf,
    mySeat,
    ...(scopes !== undefined ? { scopes } : {}),
    table: getApp().table,
  });
}

const WAITING_SCOPES: readonly ChatScope[] = ['table'];

function JoinedTable() {
  const router = useRouter();
  const connection = useRoomStore((s) => s.connection);
  const roomCode = useRoomStore((s) => s.roomCode);
  const seats = useRoomStore((s) => s.seats);
  const mySeat = useRoomStore((s) => s.mySeat);
  const tablePhase = useRoomStore((s) => s.tablePhase);
  const errorCode = useRoomStore((s) => s.errorCode);
  const chatPanel = useChatPanel(
    (seat) => seats.find((x) => x.seat === seat)?.nickname ?? '',
    mySeat,
    connection === 'connected',
    WAITING_SCOPES,
  );
  const chatUnreadTotal = useTableStore((s) => s.chatUnread.table);
  const [feedback, setFeedback] = useState<'idle' | 'done' | 'failed'>('idle');

  // Saiu da tela (voltar, trocar de rota, fechar): sai da sala de forma consentida. Deps `[]`: a troca
  // de fase NÃO desmonta este componente.
  useEffect(() => holdRoom(getApp().rooms), []);

  const leave = useCallback(() => exitTable(getApp().rooms, router), [router]);

  const share = useCallback(() => {
    void shareCode(roomCode).then((o) => setFeedback(o === 'dismissed' ? 'idle' : o));
  }, [roomCode]);

  const view = roomViewFor(tablePhase);
  if (view === 'playing') return <PlayingTable onLeave={leave} />;
  if (view === 'finished') return <FinishedTable onLeave={leave} />;

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
      chatPanel={chatPanel}
      chatUnreadTotal={chatUnreadTotal}
      on={{
        share,
        leave,
        openChat: () => {
          // Na espera só existe a Mesa: não deixa o store em 'partner'.
          getApp().table.setChatTab('table');
          getApp().table.setChatOpen(true);
        },
      }}
    />
  );
}

function FinishedTable({ onLeave }: { onLeave(): void }) {
  const vm = useTableStore((s) => s.vm);
  const history = useTableStore((s) => s.history);
  return (
    <FinishedView
      result={finishedResult(vm)}
      myTeam={vm?.myTeam ?? 0}
      history={history}
      onLeave={onLeave}
    />
  );
}

function PlayingTable({ onLeave }: { onLeave(): void }) {
  const layout = useLayoutMode();
  const connection = useRoomStore((s) => s.connection);
  const vm = useTableStore((s) => s.vm);
  const busy = useTableStore((s) => s.busy);
  const selected = useTableStore((s) => s.selected);
  const errorCode = useTableStore((s) => s.errorCode);
  const notice = useTableStore((s) => s.notice);
  const presenceNote = useTableStore((s) => s.presenceNote);
  const history = useTableStore((s) => s.history);
  const handLog = useTableStore((s) => s.handLog);
  const lingering = useTableStore((s) => s.lingering);
  const coverMode = useTableStore((s) => s.coverMode);
  const chatUnread = useTableStore((s) => s.chatUnread);
  const bubbles = useTableStore((s) => s.bubbles);
  const chatPanel = useChatPanel(
    (seat) => vm?.seats[seat]?.nickname ?? '',
    vm?.mySeat ?? -1,
    connection === 'connected',
  );
  const clockOffsetMs = useTableStore((s) => s.clockOffsetMs);
  const deadlineAt = useTableStore((s) => effectiveDeadline(s));
  const leaveConfirm = useTableStore((s) => s.leaveConfirm);
  const { announce, live } = useAnnouncer();

  // Anúncios: o controlador entrega as frases; esta tela as fala (fila respeitada pelo useAnnouncer).
  useEffect(() => {
    const table = getApp().table;
    table.setAnnouncer(announce);
    return () => table.setAnnouncer(null);
  }, [announce]);

  const table = getApp().table;
  if (vm === null) return null;
  return (
    <TableView
      vm={vm}
      layout={layout}
      banner={connectionBanner(connection, notice)}
      connected={connection === 'connected'}
      busy={busy}
      selected={selected}
      errorText={errorCode === null ? null : errorMessage(errorCode)}
      presenceNote={presenceNote}
      history={history}
      handLog={handLog}
      lingering={lingering}
      coverMode={coverMode}
      probe={isE2EMode()}
      chatUnreadTotal={chatUnread.table + chatUnread.partner}
      chatPanel={chatPanel}
      bubbles={bubbles}
      deadlineAt={deadlineAt}
      clockOffsetMs={clockOffsetMs}
      leaveConfirm={leaveConfirm}
      live={live}
      on={{
        pressCard: (id: LegalActionId) => table.pressCard(id),
        act: (id: LegalActionId) => void table.act(id),
        confirmSelected: () => {
          const sel = tableStore.getState().selected;
          if (sel !== null) void table.act(sel);
        },
        dismissError: () => table.clearError(),
        toggleCover: () => table.setCoverMode(!coverMode),
        voteCancel: () => void table.voteCancel(),
        openChat: () => table.setChatOpen(true),
        askLeave: () => table.setLeaveConfirm(true),
        cancelLeave: () => table.setLeaveConfirm(false),
        leave: onLeave,
      }}
    />
  );
}
