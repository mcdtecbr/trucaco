import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { LiveRegion, useAnnouncer, useTableLayout } from '@trucaco/ui';
import type { ChatScope, LegalActionId, SfxId, SignalId } from '@trucaco/protocol';
import type { ChatPanelProps } from './ChatPanel';
import { useAudioPrefs } from '../audio/useAudioPrefs';
import { errorMessage } from '../i18n/errors';
import { isE2EMode } from '../net/config';
import { useReduceMotion } from '../platform/useReduceMotion';
import { SHARE_DONE_TEXT, SHARE_FAILED_TEXT, SHARE_LABEL, shareCode } from '../platform/shareCode';
import { getApp } from '../services/app';
import { captureBaseline, startGainWatch } from '../room/achievementWatch';
import { progressStore, useProgressStore } from '../store/progressStore';
import { useRoomStore } from '../store/roomStore';
import { selectProvider, useSessionStore } from '../store/sessionStore';
import { effectiveDeadline, useTableStore } from '../table/tableStore';
import {
  connectionBanner,
  finishedResult,
  holdRoom,
  rematchView,
  roomViewFor,
} from '../table/tableRoute';
import { useMutedNames, mutedStore } from '../store/mutedStore';
import { buildChatPanelProps, muteFeedback, mutesFor, visibleBubbles } from './chatPanelProps';
import { buildCodesPanelProps } from './codesPanelProps';
import type { CodesPanelProps } from './CodesPanel';
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
/** Em jogo só há o chat da mesa; o da dupla fica na sala de espera. */
const IN_GAME_CHAT_SCOPES: readonly ChatScope[] = ['table'];

function useChatPanel(
  nicknameOf: (seat: number) => string,
  mySeat: number,
  connected: boolean,
  scopes?: readonly ChatScope[],
  isBotSeat: (seat: number) => boolean = () => false,
): ChatPanelProps | null {
  const mutedNames = useMutedNames();
  const [muteNote, setMuteNote] = useState<string | null>(null);
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
    errorText: chatError === null ? muteNote : errorMessage(chatError),
    connected,
    nicknameOf,
    mySeat,
    ...(scopes !== undefined ? { scopes } : {}),
    mutes: mutesFor(
      [0, 1, 2, 3].map((seat) => ({ seat, nickname: nicknameOf(seat), isBot: isBotSeat(seat) })),
      mySeat,
      mutedNames,
    ),
    toggleMute: (seat) => setMuteNote(muteFeedback(mutedStore.getState().toggle(nicknameOf(seat)))),
    table: getApp().table,
  });
}

/**
 * Props do painel "Combinar sinais" (espera e mesa). O aviso de que o combinado some ao sair da conta
 * vale só para convidado (`provider` da sessão; desconhecido = sem aviso até o `GET /me` responder).
 */
function useCodesPanel(
  seats: readonly { seat: number; nickname: string; status: string; isBot: boolean }[],
  mySeat: number,
  connected: boolean,
): CodesPanelProps | null {
  const codesOpen = useTableStore((s) => s.codesOpen);
  const codes = useTableStore((s) => s.codes);
  const codesError = useTableStore((s) => s.codesError);
  const provider = useSessionStore(selectProvider);
  return buildCodesPanelProps({
    codesOpen,
    codes,
    codesError,
    seats,
    mySeat,
    connected,
    guest: provider === 'guest',
    table: getApp().table,
  });
}

const WAITING_SCOPES: readonly ChatScope[] = ['table', 'partner'];

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
    (seat) => {
      const s = seats.find((x) => x.seat === seat);
      return s?.isBot === true || s?.status === 'bot';
    },
  );
  const codesPanel = useCodesPanel(seats, mySeat, connection === 'connected');
  const chatUnreadTotal = useTableStore((s) => s.chatUnread.table + s.chatUnread.partner);
  const reduceMotion = useReduceMotion();
  // Foto das conquistas ao entrar na mesa: o fim da partida compara com ela (melhor esforço).
  useEffect(() => {
    let stop = false;
    void captureBaseline(getApp().session.api, progressStore, () => stop);
    return () => {
      stop = true;
    };
  }, []);
  const [feedback, setFeedback] = useState<'idle' | 'done' | 'failed'>('idle');

  // Saiu da tela (voltar, trocar de rota, fechar): sai da sala de forma consentida. Deps `[]`: a troca
  // de fase NÃO desmonta este componente.
  useEffect(() => holdRoom(getApp().rooms), []);

  const leave = useCallback(() => exitTable(getApp().rooms, router), [router]);

  const share = useCallback(() => {
    void shareCode(roomCode).then((o) => setFeedback(o === 'dismissed' ? 'idle' : o));
  }, [roomCode]);

  // O leitor de tela fala por aqui em TODAS as visões (votos de revanche na tela final, "Nova partida
  // começou" na transição para a mesa): o anunciante não pode depender de qual visão está montada.
  const { announce, live } = useAnnouncer();
  useEffect(() => {
    const table = getApp().table;
    table.setAnnouncer(announce);
    return () => table.setAnnouncer(null);
  }, [announce]);

  const view = roomViewFor(tablePhase);
  let body;
  if (view === 'playing') body = <PlayingTable onLeave={leave} />;
  else if (view === 'finished') body = <FinishedTable onLeave={leave} />;
  else
    body = (
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
        codesPanel={codesPanel}
        reduceMotion={reduceMotion}
        on={{
          share,
          leave,
          openChat: () => getApp().table.setChatOpen(true),
          openCodes: () => getApp().table.setCodesOpen(true),
        }}
      />
    );
  // Uma única região viva para espera, mesa e fim de partida.
  return (
    <>
      {body}
      <LiveRegion message={live.message} nonce={live.nonce} />
    </>
  );
}

function FinishedTable({ onLeave }: { onLeave(): void }) {
  const router = useRouter();
  const gains = useProgressStore((s) => s.gains);
  const outcome = useTableStore((s) => finishedResult(s.vm).outcome);
  useEffect(
    () => startGainWatch({ api: getApp().session.api, store: progressStore, outcome }),
    [outcome],
  );
  const vm = useTableStore((s) => s.vm);
  const history = useTableStore((s) => s.history);
  const clockOffsetMs = useTableStore((s) => s.clockOffsetMs);
  const errorCode = useTableStore((s) => s.errorCode);
  return (
    <FinishedView
      result={finishedResult(vm)}
      myTeam={vm?.myTeam ?? 0}
      history={history}
      onLeave={onLeave}
      rematch={rematchView(vm)}
      clockOffsetMs={clockOffsetMs}
      errorText={
        errorCode === 'REMATCH_NOT_AVAILABLE' || errorCode === 'RATE_LIMITED'
          ? errorMessage(errorCode)
          : null
      }
      onRematch={() => void getApp().table.voteRematch()}
      gains={gains}
      onOpenAchievements={() => router.push('/achievements')}
    />
  );
}

function PlayingTable({ onLeave }: { onLeave(): void }) {
  const layout = useTableLayout();
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
  const rawBubbles = useTableStore((s) => s.bubbles);
  const speech = useTableStore((s) => s.speech);
  const sfxMarks = useTableStore((s) => s.sfxMarks);
  const audio = getApp().audio;
  const audioPrefs = useAudioPrefs(audio);
  const codes = useTableStore((s) => s.codes);
  const partnerSignalNote = useTableStore((s) => s.partnerSignalNote);
  const signals = useTableStore((s) => s.signals);
  const reduceMotion = useReduceMotion();
  const chatPanel = useChatPanel(
    (seat) => vm?.seats[seat]?.nickname ?? '',
    vm?.mySeat ?? -1,
    connection === 'connected',
    IN_GAME_CHAT_SCOPES,
    (seat) => vm?.seats[seat]?.isBot === true || vm?.seats[seat]?.status === 'bot',
  );
  const codesPanel = useCodesPanel(vm?.seats ?? [], vm?.mySeat ?? -1, connection === 'connected');
  const mutedNames = useMutedNames();
  const bubbles = visibleBubbles(
    rawBubbles,
    mutesFor(vm?.seats ?? [], vm?.mySeat ?? -1, mutedNames),
  );
  const clockOffsetMs = useTableStore((s) => s.clockOffsetMs);
  const deadlineAt = useTableStore((s) => effectiveDeadline(s));
  const leaveConfirm = useTableStore((s) => s.leaveConfirm);

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
      chatUnreadTotal={chatUnread.table}
      chatPanel={chatPanel}
      codes={codes}
      codesPanel={codesPanel}
      partnerSignalNote={partnerSignalNote}
      bubbles={bubbles}
      speech={speech}
      sfxMarks={sfxMarks}
      soundboard={{
        onSend: (id: SfxId) => table.sendSfx(id),
        silenced: audioPrefs.muted || audioPrefs.funnyMuted,
      }}
      sound={{
        muted: audioPrefs.muted,
        onToggle: () => audio.setPrefs({ muted: !audioPrefs.muted }),
      }}
      signals={signals}
      reduceMotion={reduceMotion}
      animateDeal={!isE2EMode()}
      deadlineAt={deadlineAt}
      clockOffsetMs={clockOffsetMs}
      leaveConfirm={leaveConfirm}
      on={{
        pressCard: (id: LegalActionId) => table.pressCard(id),
        act: (id: LegalActionId) => void table.act(id),
        dismissError: () => table.clearError(),
        toggleCover: () => table.setCoverMode(!coverMode),
        voteCancel: () => void table.voteCancel(),
        openChat: () => table.setChatOpen(true),
        openCodes: () => table.setCodesOpen(true),
        signalEnd: table.onSignalEnd,
        sendSignal: (id: SignalId) => table.sendSignal(id),
        askLeave: () => table.setLeaveConfirm(true),
        cancelLeave: () => table.setLeaveConfirm(false),
        leave: onLeave,
      }}
    />
  );
}
