/**
 * Mesa jogável (apresentação pura): recebe o `TableViewModel` e callbacks. Nenhuma regra de jogo aqui:
 * cartas e botões habilitados vêm de `legalActions`; valores de aposta e manilhas, do estado.
 *
 * Disposição (`layout`):
 * - `phone` (retrato): barra de placar no topo, pano no centro com os avatares nas bordas, dock
 *   embaixo (mão, sinais, cobrir e o botão de aposta no canto inferior direito).
 * - `landscape` (celular deitado) e `wide` (web largo): mesa horizontal; parceiro em cima, adversários
 *   nos lados, eu embaixo; mão ao centro, sinais à esquerda dela e aposta no canto direito.
 */
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { betCry } from '@trucaco/protocol';
import type { LegalActionId, SfxId, SignalId } from '@trucaco/protocol';
import {
  AvatarPlaceholder,
  BetButtons,
  Card,
  CardBacks,
  ChatBubble,
  SpeechBubble,
  HandFan,
  MIN_TOUCH,
  PlayedCards,
  ScoreLayers,
  SUIT_SYMBOL,
  TurnTimer,
  Vira,
  canCover,
  colors,
  fontSize,
  fontWeight,
  isHorizontalTable,
  parseFace,
  radius,
  spacing,
} from '@trucaco/ui';
import type { HandResult, PeekDirection, TableLayout } from '@trucaco/ui';
import type { SeatView, TableViewModel } from '../table/projectTable';
import type { ConnectionBanner } from '../table/tableRoute';
import type {
  ActiveSignal,
  ChatBubbleEntry,
  LingeringTrick,
  SfxMarkEntry,
  SpeechBubbleEntry,
} from '../table/tableStore';
import { Button } from '../ui/Button';
import { ChatPanel } from './ChatPanel';
import { SoundboardPanel } from './SoundboardPanel';
import type { ChatPanelProps } from './ChatPanel';
import { CodesPanel } from './CodesPanel';
import type { CodesPanelProps } from './CodesPanel';
import { DealOverlay, useDealSequence } from '../table/DealOverlay';
import { ScoreAd } from '../table/ScoreAd';
import {
  FELT_PAD,
  PHONE_SIDE_SHIFT,
  estimateArena,
  landscapeGeometry,
} from '../table/tableGeometry';
import { TableFelt } from '../table/TableFelt';
import type { TableAd } from '../table/ad';
import { SEAT_AVATAR_SIZE, SeatAvatar, seatRingRadius } from './SeatAvatar';
import { SignalGrid, SignalToggle, useSignalPanel } from './SignalPanel';

export interface TableViewProps {
  vm: TableViewModel;
  layout: TableLayout;
  banner: ConnectionBanner;
  /** Sem conexão ativa: nada é enviado. */
  connected: boolean;
  busy: boolean;
  selected: string | null;
  /** Texto pt-BR do último erro do servidor (já traduzido), ou null. */
  errorText: string | null;
  presenceNote: string | null;
  history: readonly HandResult[];
  /** Lances da mão em curso (histórico detalhado). */
  handLog: readonly string[];
  /** Última vaza fechada, mantida por um instante. */
  lingering: LingeringTrick | null;
  /** Modo "jogar coberta". */
  coverMode: boolean;
  /** Emite a sonda `table-state` (data-testid oculto) só em modo E2E. */
  probe: boolean;
  /** Painel de chat aberto (props prontas) ou null. */
  chatPanel: ChatPanelProps | null;
  chatUnreadTotal: number;
  /** Combinado da dupla (só a minha dupla o tem): aparece sob cada sinal no painel de sinais. */
  codes?: Readonly<Partial<Record<SignalId, string>>>;
  /** Painel "Combinar sinais" aberto (props prontas) ou null/omitido. */
  codesPanel?: CodesPanelProps | null;
  /** Aviso curto quando o parceiro sinaliza algo combinado. */
  partnerSignalNote?: string | null;
  /** Balão de chat por assento (4 s). */
  bubbles: Readonly<Record<number, ChatBubbleEntry>>;
  /** Legenda grande da fala (grito, "quero", "corro") por assento (~2 s). Omitido = nenhuma. */
  speech?: Readonly<Record<number, SpeechBubbleEntry>>;
  /** Emoji do efeito engraçado por assento (~1,5 s). Omitido = nenhum. */
  sfxMarks?: Readonly<Record<number, SfxMarkEntry>>;
  /** Painel de efeitos engraçados (no menu). Omitido = sem o botão. */
  soundboard?: { onSend(id: SfxId): boolean; silenced: boolean };
  /** Atalho de som (no menu). Omitido = sem o botão. */
  sound?: { muted: boolean; onToggle(): void };
  /** Sinal animando por assento. */
  signals: Readonly<Record<number, ActiveSignal>>;
  /** Preferência do sistema: sem animação, só destaque estático. */
  reduceMotion: boolean;
  /** Embaralhar, distribuir e recolher com animação. Omitido = desligado (só o estado final). */
  animateDeal?: boolean;
  /** Publicidade impressa no pano. Omitido = arte placeholder; `null` = sem publicidade. */
  tableAd?: TableAd | null;
  /** Publicidade na faixa do placar. Omitido = arte placeholder; `null` = sem publicidade. */
  scoreAd?: TableAd | null;
  deadlineAt: number;
  clockOffsetMs: number;
  leaveConfirm: boolean;
  /** Menu "⋯" já aberto na primeira renderização (testes de marcação estática). */
  defaultMenuOpen?: boolean;
  on: {
    pressCard(id: LegalActionId): void;
    act(id: LegalActionId): void;
    dismissError(): void;
    toggleCover(): void;
    voteCancel(): void;
    openChat(): void;
    /** Abre o painel "Combinar sinais". Omitido = sem o botão. */
    openCodes?(): void;
    /** Estável (método do controlador): alimenta o `SeatAvatar` memoizado. */
    signalEnd(seat: number, key: number): void;
    sendSignal(id: SignalId): boolean;
    askLeave(): void;
    cancelLeave(): void;
    leave(): void;
  };
}

/** Medidas e escolhas por disposição. */
export interface TableMetrics {
  readonly avatar: number;
  readonly hand: 'md' | 'lg';
  readonly played: 'sm' | 'md';
  /** Escala visual da vaza. */
  readonly trickScale: number;
  /** Vaza em cruz ou em fileira (celular deitado: falta altura). */
  readonly trick: 'cross' | 'row';
  /** Para onde saem as costas das cartas de cada posição. */
  readonly peek: Readonly<Record<'partner' | 'left' | 'right', PeekDirection>>;
}

export function metricsFor(layout: TableLayout): TableMetrics {
  switch (layout) {
    case 'wide':
      return {
        avatar: SEAT_AVATAR_SIZE.wide,
        hand: 'lg',
        played: 'md',
        trickScale: 1,
        trick: 'cross',
        peek: { partner: 'down', left: 'right', right: 'left' },
      };
    case 'landscape':
      return {
        avatar: SEAT_AVATAR_SIZE.landscape,
        hand: 'md',
        played: 'sm',
        trickScale: 1,
        trick: 'row',
        peek: { partner: 'right', left: 'right', right: 'left' },
      };
    default:
      return {
        avatar: SEAT_AVATAR_SIZE.phone,
        hand: 'lg',
        played: 'sm',
        trickScale: 1,
        trick: 'cross',
        peek: { partner: 'down', left: 'down', right: 'down' },
      };
  }
}

function seatCaption(s: SeatView, vm: TableViewModel): string {
  if (s.isTurn && vm.handPhase !== 'specialDecision') return 'vez';
  if (vm.phase === 'playing' && s.handSize > 0) {
    return s.handSize === 1 ? '1 carta' : `${s.handSize} cartas`;
  }
  return '';
}

type BubbleAnchor = 'center' | 'start' | 'end';

function Bubble({
  seat,
  vm,
  bubbles,
  speech,
  marks,
  anchor = 'center',
  below = false,
}: {
  seat: number;
  vm: TableViewModel;
  bubbles: Readonly<Record<number, ChatBubbleEntry>>;
  speech?: Readonly<Record<number, SpeechBubbleEntry>> | undefined;
  marks?: Readonly<Record<number, SfxMarkEntry>> | undefined;
  /** Alinhamento do balão: assentos na borda não deixam o balão sair da tela. */
  anchor?: BubbleAnchor;
  /** Balão sob o avatar (parceiro, colado na borda de cima do pano). */
  below?: boolean;
}) {
  const b = bubbles[seat];
  const sp = speech?.[seat];
  const mark = marks?.[seat];
  if (b === undefined && sp === undefined && mark === undefined) return null;
  const author = seat === vm.mySeat ? 'Você' : vm.seats[seat]?.nickname || `Jogador ${seat + 1}`;
  // Posição absoluta sobre o avatar: o balão aparece e some sem deslocar o layout. A fala (grande)
  // fica acima do chat quando os dois coexistem.
  return (
    <View
      style={[
        styles.bubbleSlot,
        below ? styles.bubbleBelow : styles.bubbleAbove,
        anchor === 'start' && styles.bubbleStart,
        anchor === 'end' && styles.bubbleEnd,
      ]}
      pointerEvents="none"
    >
      {mark !== undefined ? (
        // O anúncio para o leitor de tela sai pelo controlador: o emoji é só visual.
        <Text
          style={styles.sfxMark}
          testID={`sfx-mark-${seat}`}
          aria-hidden
          importantForAccessibility="no-hide-descendants"
        >
          {mark.icon}
        </Text>
      ) : null}
      {sp !== undefined ? (
        <SpeechBubble author={author} text={sp.text} testID={`speech-${seat}`} />
      ) : null}
      {b !== undefined ? (
        <ChatBubble
          author={author}
          text={b.text}
          partner={b.scope === 'partner'}
          testID={`bubble-${seat}`}
        />
      ) : null}
    </View>
  );
}

interface SeatSignals {
  sfxMarks?: Readonly<Record<number, SfxMarkEntry>> | undefined;
  signals: Readonly<Record<number, ActiveSignal>>;
  reduceMotion: boolean;
  avatarSize: number;
  onSignalEnd(seat: number, key: number): void;
}

/** Avatar quadrado com o apelido em faixa e, se for o caso, as costas das cartas saindo por trás. */
function Seat({
  s,
  vm,
  bubbles,
  speech,
  fx,
  peek,
  anchor,
  below,
  testID,
  own,
}: {
  s: SeatView;
  vm: TableViewModel;
  bubbles: Readonly<Record<number, ChatBubbleEntry>>;
  speech?: Readonly<Record<number, SpeechBubbleEntry>> | undefined;
  fx: SeatSignals;
  /** Ausente: assento sem costas de carta (o meu). */
  peek?: PeekDirection;
  anchor?: BubbleAnchor;
  below?: boolean;
  testID: string;
  own?: boolean;
}) {
  const status = s.nickname === '' && s.status === 'connected' ? 'empty' : s.status;
  const cards = vm.phase === 'playing' ? s.handSize : 0;
  return (
    <View testID={testID} style={styles.seatBox}>
      {peek !== undefined ? (
        <CardBacks count={cards} direction={peek} avatarSize={fx.avatarSize + 6} />
      ) : null}
      <Bubble
        seat={s.seat}
        vm={vm}
        bubbles={bubbles}
        speech={speech}
        marks={fx.sfxMarks}
        {...(anchor !== undefined ? { anchor } : {})}
        {...(below !== undefined ? { below } : {})}
      />
      <AvatarPlaceholder
        nickname={s.nickname || (own === true ? 'Você' : '—')}
        status={status}
        side={own === true ? 'mine' : s.side}
        active={s.isTurn}
        caption={own === true ? 'você' : seatCaption(s, vm)}
        layout="column"
        nameOverlay
        ringRadius={seatRingRadius(fx.avatarSize)}
        avatar={
          <SeatAvatar
            seat={s.seat}
            size={fx.avatarSize}
            parts={s.avatar}
            signal={fx.signals[s.seat] ?? null}
            reduceMotion={fx.reduceMotion}
            onSignalEnd={fx.onSignalEnd}
          />
        }
      />
    </View>
  );
}

function pendingText(vm: TableViewModel): string | null {
  const p = vm.pending;
  if (p === null) return null;
  const value = vm.pendingValue;
  const cry = value !== undefined ? betCry(value) : undefined;
  const what = cry !== undefined ? `${cry[0]?.toUpperCase()}${cry.slice(1)}` : 'aposta';
  const worth = value !== undefined ? ` (vale ${value})` : '';
  if (p.fromMyTeam) return `Aguardando resposta ao ${what}${worth}.`;
  const name = vm.seats[p.fromSeat]?.nickname;
  return `${name !== undefined && name !== '' ? name : 'Adversário'} pediu ${what}${worth}.`;
}

/** "De quem é a vez": `actingSeat` do servidor (não `hand.turn`); decisão especial é da dupla. */
export function turnText(vm: TableViewModel): string | null {
  if (vm.phase !== 'playing') return null;
  if (vm.handPhase === 'finished' || vm.handPhase === '') return null;
  if (vm.handPhase === 'specialDecision') {
    // Os dois da dupla decidem (`actingSeat` = -1); quem já aceitou espera o parceiro.
    if (vm.decidingTeam >= 0 && vm.decidingTeam !== vm.myTeam) return 'A dupla adversária decide';
    if (vm.iAccepted) return 'Aguardando o parceiro';
    return vm.canAct || vm.decidingTeam === vm.myTeam ? 'Você e seu parceiro decidem' : null;
  }
  // Aposta pendente: só o `responderSeat` (= actingSeat) responde; parceiro e pedinte não têm ação.
  if (vm.handPhase === 'betPending') {
    const responder = vm.pending?.responderSeat ?? vm.actingSeat;
    const who = responder >= 0 ? responder : vm.actingSeat;
    if (vm.canAct || who === vm.mySeat) return 'Sua vez';
    if (who >= 0 && who % 2 === vm.myTeam) return 'Seu parceiro responde';
    const n = who >= 0 ? vm.seats[who]?.nickname : undefined;
    return `Aguardando resposta de ${n !== undefined && n !== '' ? n : 'outro jogador'}`;
  }
  if (vm.actingSeat === vm.mySeat || vm.canAct) return 'Sua vez';
  if (vm.actingSeat < 0) return null;
  const n = vm.seats[vm.actingSeat]?.nickname;
  return `Vez de ${n !== undefined && n !== '' ? n : 'outro jogador'}`;
}

function Banner({ banner, onLeave }: { banner: ConnectionBanner; onLeave(): void }) {
  if (banner === null) return null;
  if (banner === 'closed') {
    return (
      <View
        style={[styles.banner, styles.bannerError]}
        testID="table-closed"
        accessibilityRole="alert"
      >
        <Text style={styles.bannerText}>A conexão com a mesa foi encerrada.</Text>
        <Button
          label="Voltar ao início"
          variant="secondary"
          onPress={onLeave}
          testID="closed-leave"
        />
      </View>
    );
  }
  return (
    <View
      style={styles.banner}
      testID={banner === 'reconnecting' ? 'table-reconnecting' : 'table-reconnected'}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Text style={styles.bannerText}>
        {banner === 'reconnecting' ? 'Reconectando…' : 'Você voltou.'}
      </Text>
    </View>
  );
}

/** Ícone de 44 pt da barra do topo, com selo opcional (mensagens não lidas). */
function BarIcon({
  icon,
  label,
  badge,
  onPress,
  testID,
  on,
}: {
  icon: string;
  label: string;
  badge?: number;
  onPress(): void;
  testID: string;
  on?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      {...(on !== undefined ? { accessibilityState: { expanded: on }, 'aria-expanded': on } : {})}
      onPress={onPress}
      style={styles.barIcon}
      testID={testID}
    >
      <Text style={styles.barIconText}>{icon}</Text>
      {badge !== undefined && badge > 0 ? (
        <View style={styles.badge} importantForAccessibility="no-hide-descendants">
          <Text style={styles.badgeText}>{badge > 9 ? '9+' : String(badge)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function TableView(p: TableViewProps) {
  const { vm } = p;
  const horizontal = isHorizontalTable(p.layout);
  const m = metricsFor(p.layout);
  const win = useWindowDimensions();
  const [menuOpen, setMenuOpen] = useState(p.defaultMenuOpen === true);
  const [barH, setBarH] = useState(0);
  const [dockH, setDockH] = useState(0);
  const [arena, setArena] = useState<{ w: number; h: number } | null>(null);
  const landscape = p.layout === 'landscape';
  const modalOpen = p.leaveConfirm;
  const actionsOn = p.connected && !p.busy && !modalOpen;
  const signalPanel = useSignalPanel({
    connected: p.connected && !modalOpen,
    onSend: p.on.sendSignal,
  });
  const nicknameOf = (seat: number): string => vm.seats[seat]?.nickname ?? '';
  const legal = p.connected && !modalOpen ? vm.legalActions : [];
  const pending = pendingText(vm);
  const turn = turnText(vm);
  const mineSeat = vm.byPosition.self;
  const fx: SeatSignals = {
    sfxMarks: p.sfxMarks,
    signals: p.signals,
    reduceMotion: p.reduceMotion,
    avatarSize: m.avatar,
    onSignalEnd: p.on.signalEnd,
  };
  const deal = useDealSequence({
    key: `${vm.matchNumber}:${vm.handNumber}`,
    enabled: p.animateDeal === true && !p.reduceMotion && vm.handNumber > 0,
    pe: vm.pe,
    mySeat: vm.mySeat,
    fresh: vm.current.length === 0 && vm.tricks.length === 0,
  });
  // Sonda para E2E (esperar por estado, nunca por tempo); fora da árvore de acessibilidade.
  const probe = `${vm.phase}|turn=${vm.actingSeat}|hand=${vm.handNumber}|act=${String(vm.canAct)}|plays=${vm.current.length}|match=${vm.matchNumber}|me=${vm.mySeat}`;

  const votes = vm.cancelVotes.length;
  const cancelText = vm.iVotedCancel
    ? `Cancelar: você votou (${votes})`
    : votes > 0
      ? `Cancelar mesa (${votes})`
      : 'Cancelar mesa';
  const cancelLabel = vm.iVotedCancel
    ? `Você já votou para cancelar a mesa. ${votes} votos.`
    : `Votar para cancelar a mesa. ${votes} votos até agora. Todos os jogadores humanos precisam concordar.`;
  const usable = p.connected && !modalOpen;

  /** Barra de placar no topo, em largura total: duplas, vazas, valor, publicidade e ícones. */
  const scoreBar = (
    <View
      style={styles.scoreFixed}
      testID="score-fixed"
      onLayout={(e) => setBarH(Math.round(e.nativeEvent.layout.height))}
    >
      <ScoreLayers
        bar
        myTeam={vm.myTeam}
        series={vm.series}
        scores={vm.scores}
        handNumber={vm.handNumber}
        handValue={vm.handValue}
        special={vm.special}
        tricks={vm.tricks}
        history={p.history}
        currentLog={p.handLog}
        variant={vm.variant}
        {...(landscape
          ? {}
          : {
              adSlot: (
                <View style={styles.adRow}>
                  <ScoreAd ad={p.scoreAd} />
                </View>
              ),
            })}
        actions={
          <>
            {landscape ? <ScoreAd ad={p.scoreAd} /> : null}
            <BarIcon
              icon={'\u{1F4AC}'}
              label={p.chatUnreadTotal > 0 ? `Chat, ${p.chatUnreadTotal} mensagens novas` : 'Chat'}
              badge={p.chatUnreadTotal}
              onPress={p.on.openChat}
              testID="open-chat"
            />
            <BarIcon
              icon={'⋯'}
              label={menuOpen ? 'Fechar menu da mesa' : 'Abrir menu da mesa'}
              onPress={() => setMenuOpen((o) => !o)}
              testID="open-menu"
              on={menuOpen}
            />
            <BarIcon
              icon={'\u{1F6AA}'}
              label="Sair da mesa"
              onPress={p.on.askLeave}
              testID="leave-table"
            />
          </>
        }
      />
    </View>
  );

  const viraBox = (
    <View
      style={[styles.viraBox, deal.viraHidden ? styles.hidden : undefined]}
      pointerEvents="none"
    >
      <Vira
        viraRank={vm.vira.rank}
        viraSuit={vm.vira.suit}
        {...(vm.manilhaLabel !== undefined ? { manilhaLabel: vm.manilhaLabel } : {})}
      />
      {vm.variant === 'mineiro' && vm.manilhas.length > 0 ? (
        <Text style={styles.muted} testID="manilhas">
          Manilhas: {vm.manilhas.map((x) => `${x.rank}${SUIT_SYMBOL[x.suit]}`).join(' ')}
        </Text>
      ) : null}
    </View>
  );

  const showLinger = vm.current.length === 0 && p.lingering !== null;
  const trickPlays = showLinger ? (p.lingering?.plays ?? []) : vm.current;
  const trickOwn = showLinger ? (p.lingering?.ownCovered ?? null) : vm.ownCoveredCurrent;
  const lingerSeat = showLinger ? (p.lingering?.winnerSeat ?? -1) : -1;
  const lingerWinner =
    lingerSeat >= 0
      ? `Vaza de ${lingerSeat === vm.mySeat ? 'você' : nicknameOf(lingerSeat) || 'outro jogador'}`
      : null;
  const showPartner = vm.handPhase === 'specialDecision' && vm.partnerCards.length > 0;

  // Faixa do topo do pano ocupada pelo parceiro (avatar + borda + costas das cartas que saem abaixo).
  const partnerZone = m.avatar + 6 + (m.peek.partner === 'down' ? 24 : 0) + spacing.xs;
  const sideSeatStyle = (side: 'left' | 'right'): StyleProp<ViewStyle> => [
    styles.sideSeat,
    p.layout === 'phone' ? { top: PHONE_SIDE_SHIFT * 2 } : null,
    side === 'left' ? styles.sideLeft : styles.sideRight,
  ];

  const seatNode = (
    s: SeatView,
    peek: PeekDirection | undefined,
    extra: { anchor?: BubbleAnchor; below?: boolean; testID: string; own?: boolean },
  ) => (
    <Seat
      s={s}
      vm={vm}
      bubbles={p.bubbles}
      speech={p.speech}
      fx={fx}
      {...(peek !== undefined ? { peek } : {})}
      {...extra}
    />
  );

  const trickCards = (
    <PlayedCards
      plays={trickPlays}
      mySeat={vm.mySeat >= 0 ? vm.mySeat : 0}
      ownCovered={trickOwn}
      manilhas={vm.manilhas}
      nicknameOf={nicknameOf}
      size={m.played}
      arrangement={m.trick}
    />
  );
  const winnerText =
    lingerWinner !== null ? (
      <Text style={styles.muted} testID="trick-winner">
        {lingerWinner}
      </Text>
    ) : null;
  /** Painel de status: de quem é a vez e a aposta pendente. Fica no pano, num canto. */
  const statusNode =
    turn !== null || pending !== null ? (
      <>
        {turn !== null ? (
          <Text
            style={[styles.turn, vm.canAct && styles.turnMine]}
            testID="turn-text"
            accessibilityLiveRegion="polite"
          >
            {turn}
          </Text>
        ) : null}
        {pending !== null ? (
          <Text style={styles.pending} testID="pending-bet" accessibilityLiveRegion="polite">
            {pending}
          </Text>
        ) : null}
      </>
    ) : null;

  const abs = (r: { x: number; y: number }): ViewStyle => ({
    position: 'absolute',
    left: r.x,
    top: r.y,
  });
  const est = estimateArena(p.layout, win.width, win.height);
  const geo = landscape ? landscapeGeometry(arena?.w ?? est.w, arena?.h ?? est.h, m.avatar) : null;

  /** Celular deitado: posições calculadas (sem colisão); meu avatar fica na dock, ao lado da mão. */
  const landscapeArena =
    geo !== null ? (
      <View
        style={styles.arena}
        pointerEvents="box-none"
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setArena((a) =>
            a !== null && a.w === width && a.h === height ? a : { w: width, h: height },
          );
        }}
      >
        <View style={abs(geo.partner.avatar)} pointerEvents="box-none">
          {seatNode(vm.byPosition.partner, m.peek.partner, {
            below: true,
            testID: `table-seat-${vm.byPosition.partner.seat}`,
          })}
        </View>
        <View style={abs(geo.left.avatar)} pointerEvents="box-none">
          {seatNode(vm.byPosition.left, m.peek.left, {
            anchor: 'start',
            testID: `table-seat-${vm.byPosition.left.seat}`,
          })}
        </View>
        <View style={abs(geo.right.avatar)} pointerEvents="box-none">
          {seatNode(vm.byPosition.right, m.peek.right, {
            anchor: 'end',
            testID: `table-seat-${vm.byPosition.right.seat}`,
          })}
        </View>
        <View
          style={[abs(geo.trick), { width: geo.trick.w, alignItems: 'center' }]}
          testID="trick"
          pointerEvents="box-none"
        >
          {trickCards}
          {winnerText}
        </View>
        <View style={abs(geo.vira)} pointerEvents="none">
          {viraBox}
        </View>
        {statusNode !== null ? (
          <View
            style={[abs(geo.status), { width: geo.status.w, alignItems: 'flex-start' }]}
            pointerEvents="none"
          >
            {statusNode}
          </View>
        ) : null}
      </View>
    ) : null;

  const flexArena = (
    <View style={styles.arena} pointerEvents="box-none">
      <View style={styles.partnerSeat} pointerEvents="box-none">
        {seatNode(vm.byPosition.partner, m.peek.partner, {
          below: true,
          testID: `table-seat-${vm.byPosition.partner.seat}`,
        })}
      </View>
      <View style={sideSeatStyle('left')} pointerEvents="box-none">
        {seatNode(vm.byPosition.left, m.peek.left, {
          anchor: 'start',
          testID: `table-seat-${vm.byPosition.left.seat}`,
        })}
      </View>
      <View style={sideSeatStyle('right')} pointerEvents="box-none">
        {seatNode(vm.byPosition.right, m.peek.right, {
          anchor: 'end',
          testID: `table-seat-${vm.byPosition.right.seat}`,
        })}
      </View>
      <View style={styles.mySeat} pointerEvents="box-none">
        {seatNode(mineSeat, undefined, { anchor: 'start', testID: 'my-seat', own: true })}
      </View>
      <View style={[styles.trickZone, { paddingTop: partnerZone }]} pointerEvents="box-none">
        <View style={styles.center} testID="trick" pointerEvents="box-none">
          <View
            style={m.trickScale !== 1 ? { transform: [{ scale: m.trickScale }] } : undefined}
            pointerEvents="box-none"
          >
            {trickCards}
          </View>
          {winnerText}
        </View>
      </View>
      <View style={styles.viraCorner} pointerEvents="none">
        {viraBox}
      </View>
      {statusNode !== null ? (
        <View
          style={[
            styles.status,
            horizontal ? styles.statusCorner : [styles.statusPhone, { top: partnerZone }],
          ]}
          pointerEvents="none"
        >
          {statusNode}
        </View>
      ) : null}
    </View>
  );

  const board = (
    <TableFelt
      style={styles.board}
      contentStyle={styles.boardContent}
      ad={p.tableAd}
      testID="table-felt"
    >
      {landscapeArena ?? flexArena}
      {deal.run !== null ? (
        <DealOverlay
          runId={deal.run.id}
          plan={deal.run.plan}
          mySeat={vm.mySeat}
          avatarSize={m.avatar}
          {...(geo !== null
            ? {
                deckAt: {
                  x: FELT_PAD + geo.deck.x + geo.deck.w / 2,
                  y: FELT_PAD + geo.deck.y + geo.deck.h / 2,
                },
              }
            : {})}
        />
      ) : null}
    </TableFelt>
  );

  const coverButton = canCover(legal) ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={p.coverMode ? 'Cobrir carta, ligado' : 'Cobrir carta, desligado'}
      accessibilityHint="Quando ligado, a carta escolhida é jogada coberta"
      accessibilityState={{ selected: p.coverMode }}
      aria-pressed={p.coverMode}
      onPress={p.on.toggleCover}
      style={[styles.dockBtn, landscape && styles.dockBtnLand, p.coverMode && styles.dockBtnOn]}
      testID="cover-toggle"
    >
      <Text style={styles.dockBtnText}>{p.coverMode ? 'Cobrir: ligado' : 'Cobrir'}</Text>
    </Pressable>
  ) : null;

  const signalButtons =
    vm.mySeat >= 0 ? (
      <View style={[styles.dockGroup, landscape && styles.dockGroupCol]}>
        <SignalToggle
          panel={signalPanel}
          style={[styles.dockBtn, landscape && styles.dockBtnLand]}
        />
        {coverButton}
      </View>
    ) : (
      coverButton
    );

  const betCorner = (
    <BetButtons
      variant="corner"
      legalActions={legal}
      busy={!actionsOn}
      raising={vm.pending !== null}
      nextValue={vm.nextBetValue}
      pendingValue={vm.pendingValue}
      onPress={p.on.act}
    />
  );

  const hand = (
    <View
      testID="my-hand"
      style={deal.handHidden ? styles.hidden : undefined}
      pointerEvents={deal.handHidden ? 'none' : 'auto'}
    >
      <HandFan
        hand={vm.myHand}
        legalActions={actionsOn ? vm.legalActions : []}
        blindCount={vm.blindCount}
        coverMode={p.coverMode}
        manilhas={vm.manilhas}
        selectedAction={p.selected}
        size={m.hand}
        onPress={p.on.pressCard}
      />
    </View>
  );

  const dockExtras = (
    <>
      {p.errorText !== null ? (
        <Pressable
          accessibilityRole="alert"
          accessibilityLabel={`${p.errorText} Toque para dispensar.`}
          onPress={p.on.dismissError}
          style={styles.error}
          testID="table-error"
        >
          <Text style={styles.errorText}>{p.errorText}</Text>
        </Pressable>
      ) : null}
      {showPartner ? (
        <View testID="partner-cards" accessibilityLabel="Cartas do seu parceiro">
          <Text style={styles.muted}>Cartas do seu parceiro</Text>
          <View style={styles.partnerRow}>
            {vm.partnerCards.map((c, i) => {
              const face = parseFace(c);
              return (
                <Card
                  key={i}
                  size="sm"
                  {...(face !== null ? { rank: face.rank, suit: face.suit } : {})}
                />
              );
            })}
          </View>
        </View>
      ) : null}
    </>
  );

  /**
   * Dock inferior, ao alcance do polegar. Retrato: mão, e logo abaixo sinais (e cobrir) à esquerda e o
   * botão de aposta no canto direito. Horizontal: sinais, mão e aposta numa linha só, com a mão ao centro.
   */
  const dock = horizontal ? (
    <View
      style={styles.dock}
      testID="dock"
      onLayout={(e) => setDockH(Math.round(e.nativeEvent.layout.height))}
    >
      {dockExtras}
      <View style={[styles.dockRow, landscape && styles.dockRowLand]}>
        {landscape ? (
          <View style={styles.dockMine}>
            {seatNode(mineSeat, undefined, { anchor: 'start', testID: 'my-seat', own: true })}
            <View style={styles.dockStack}>{signalButtons}</View>
          </View>
        ) : (
          <View style={[styles.dockSide, styles.dockSideStart]}>{signalButtons}</View>
        )}
        {hand}
        <View style={landscape ? styles.dockBet : [styles.dockSide, styles.dockSideEnd]}>
          {betCorner}
        </View>
      </View>
    </View>
  ) : (
    <View
      style={styles.dock}
      testID="dock"
      onLayout={(e) => setDockH(Math.round(e.nativeEvent.layout.height))}
    >
      {dockExtras}
      {hand}
      <View style={styles.dockActions}>
        <View style={styles.dockStart}>{signalButtons}</View>
        {betCorner}
      </View>
    </View>
  );

  const menuWidth = Math.min(320, Math.max(220, win.width - spacing.md));
  const menu = menuOpen ? (
    <View
      style={[styles.menuSheet, { top: barH, width: menuWidth }]}
      testID="table-menu"
      accessibilityLabel="Menu da mesa"
    >
      <ScrollView style={{ maxHeight: Math.max(160, win.height * 0.6) }} nestedScrollEnabled>
        <View style={styles.menuList}>
          {p.on.openCodes !== undefined && vm.mySeat >= 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Combinar sinais com o parceiro"
              onPress={() => {
                setMenuOpen(false);
                p.on.openCodes?.();
              }}
              style={styles.menuItem}
              testID="open-codes"
            >
              <Text style={styles.menuText}>Combinar sinais</Text>
            </Pressable>
          ) : null}
          {vm.mySeat >= 0 && p.soundboard !== undefined ? (
            <SoundboardPanel
              connected={usable}
              onSend={p.soundboard.onSend}
              silenced={p.soundboard.silenced}
            />
          ) : null}
          {p.sound !== undefined ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                p.sound.muted ? 'Som desligado. Ligar o som' : 'Som ligado. Desligar o som'
              }
              accessibilityState={{ checked: !p.sound.muted }}
              aria-pressed={!p.sound.muted}
              onPress={p.sound.onToggle}
              style={[styles.menuItem, p.sound.muted && styles.menuOff]}
              testID="sound-toggle"
            >
              <Text style={styles.menuText}>
                {p.sound.muted ? '\u{1F507} Som desligado' : '\u{1F50A} Som ligado'}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={cancelLabel}
            aria-disabled={vm.iVotedCancel || !p.connected}
            disabled={vm.iVotedCancel || !p.connected}
            onPress={p.on.voteCancel}
            style={[styles.menuItem, vm.iVotedCancel && styles.menuOff]}
            testID="vote-cancel"
          >
            <Text style={styles.menuText}>{cancelText}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  ) : null;

  const signalSheet =
    signalPanel.open && vm.mySeat >= 0 ? (
      <View style={[styles.signalSheet, { bottom: dockH }]} pointerEvents="box-none">
        <View style={styles.signalSheetInner} testID="signal-panel">
          <SignalGrid
            panel={signalPanel}
            maxHeight={Math.max(160, win.height * 0.5)}
            {...(p.codes !== undefined ? { codes: p.codes } : {})}
          />
        </View>
      </View>
    ) : null;

  const confirm = p.leaveConfirm ? (
    <View style={styles.overlay} testID="leave-confirm" accessibilityViewIsModal>
      <View style={styles.dialog} accessibilityRole="alert" aria-modal>
        <Text style={styles.dialogTitle}>Sair da mesa?</Text>
        <Text style={styles.dialogBody}>Um bot assume o seu lugar e a partida continua.</Text>
        <Button label="Sair da mesa" onPress={p.on.leave} testID="leave-confirm-yes" />
        <Button
          label="Continuar jogando"
          variant="secondary"
          onPress={p.on.cancelLeave}
          testID="leave-confirm-no"
        />
      </View>
    </View>
  ) : null;

  return (
    <View style={styles.root} testID="table">
      {p.probe ? (
        <Text
          testID="table-state"
          aria-hidden
          importantForAccessibility="no-hide-descendants"
          style={styles.probe}
        >
          {probe}
        </Text>
      ) : null}
      {/* O fundo some para o leitor de tela enquanto o diálogo está aberto. */}
      <View
        style={styles.flex}
        aria-hidden={modalOpen}
        importantForAccessibility={modalOpen ? 'no-hide-descendants' : 'auto'}
      >
        {scoreBar}
        <View style={styles.timerStrip} testID="turn-timer">
          <TurnTimer deadlineAt={p.deadlineAt} clockOffsetMs={p.clockOffsetMs} />
        </View>
        <Banner banner={p.banner} onLeave={p.on.leave} />
        <View style={[styles.main, p.layout === 'wide' && styles.mainWide]}>
          <View style={styles.boardBox}>{board}</View>
          {dock}
        </View>
        {menu}
        {signalSheet}
      </View>
      {p.presenceNote !== null ? (
        <Text style={styles.presence} testID="presence-note" pointerEvents="none">
          {p.presenceNote}
        </Text>
      ) : null}
      {p.partnerSignalNote !== undefined && p.partnerSignalNote !== null ? (
        <Text
          style={styles.signalNote}
          testID="partner-signal-note"
          accessibilityLiveRegion="polite"
          pointerEvents="none"
        >
          {p.partnerSignalNote}
        </Text>
      ) : null}
      {p.chatPanel !== null ? <ChatPanel {...p.chatPanel} /> : null}
      {p.codesPanel !== undefined && p.codesPanel !== null ? (
        <CodesPanel {...p.codesPanel} />
      ) : null}
      {confirm}
    </View>
  );
}

/** Largura máxima da mesa no web largo (acima disso o pano não estica mais). */
const MAX_TABLE_WIDTH = 1280;

const styles = StyleSheet.create({
  seatBox: { position: 'relative' },
  bubbleSlot: {
    position: 'absolute',
    left: -spacing.lg,
    right: -spacing.lg,
    alignItems: 'center',
    zIndex: 2,
  },
  bubbleAbove: { bottom: '100%' },
  bubbleBelow: { top: '100%' },
  bubbleStart: { left: 0, right: -spacing.xl * 3, alignItems: 'flex-start' },
  bubbleEnd: { right: 0, left: -spacing.xl * 3, alignItems: 'flex-end' },
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  partnerRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm },
  sfxMark: { alignSelf: 'center', fontSize: fontSize.large },
  probe: { position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' },
  timerStrip: { paddingHorizontal: spacing.xs },
  scoreFixed: { alignSelf: 'stretch', zIndex: 5 },
  adRow: { alignItems: 'center', paddingBottom: 2 },
  barIcon: {
    minWidth: MIN_TOUCH,
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  barIconText: { color: colors.text, fontSize: fontSize.large, fontWeight: fontWeight.bold },
  badge: {
    position: 'absolute',
    top: 4,
    right: 2,
    minWidth: 18,
    height: 18,
    borderRadius: radius.round,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { color: colors.onPrimary, fontSize: 11, fontWeight: fontWeight.heavy },
  hidden: { opacity: 0 },
  main: { flex: 1, width: '100%', alignSelf: 'center' },
  mainWide: { maxWidth: MAX_TABLE_WIDTH },
  boardBox: { flex: 1, padding: spacing.xs },
  board: { flex: 1 },
  boardContent: { flex: 1 },
  arena: { flex: 1 },
  partnerSeat: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center' },
  sideSeat: { position: 'absolute', top: 0, bottom: 0, justifyContent: 'center' },
  sideLeft: { left: 0, alignItems: 'flex-start' },
  sideRight: { right: 0, alignItems: 'flex-end' },
  mySeat: { position: 'absolute', left: 0, bottom: 0 },
  trickZone: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
  viraCorner: { position: 'absolute', top: 0, right: 0 },
  viraBox: { alignItems: 'center', gap: 2, maxWidth: 120 },
  status: { position: 'absolute', alignItems: 'center', paddingVertical: 2 },
  statusPhone: { left: spacing.xl * 3, right: spacing.xl * 3 },
  statusCorner: { top: 4, left: 64, maxWidth: 170, alignItems: 'flex-start' },
  turn: {
    color: colors.text,
    fontSize: fontSize.small,
    fontWeight: fontWeight.bold,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    overflow: 'hidden',
    textAlign: 'center',
  },
  turnMine: { color: colors.primary },
  pending: {
    color: colors.primary,
    fontSize: fontSize.small,
    fontWeight: fontWeight.bold,
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    overflow: 'hidden',
    marginTop: 2,
  },
  error: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.sm,
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
  },
  errorText: { color: colors.danger, fontSize: fontSize.small, textAlign: 'center' },
  dock: { paddingHorizontal: spacing.sm, paddingBottom: spacing.sm, gap: spacing.xs },
  dockActions: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  dockStart: { flexShrink: 1 },
  dockGroup: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dockRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: spacing.md,
  },
  dockRowLand: { justifyContent: 'space-between', gap: spacing.sm },
  dockMine: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, flexShrink: 1 },
  dockStack: { gap: spacing.xs },
  dockBet: { flexShrink: 0, alignItems: 'flex-end' },
  dockSide: { flex: 1, justifyContent: 'flex-end' },
  dockSideStart: { alignItems: 'flex-end' },
  dockSideEnd: { alignItems: 'flex-end' },
  dockBtn: {
    minHeight: 64,
    minWidth: 72,
    paddingHorizontal: spacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  dockGroupCol: { flexDirection: 'column', gap: spacing.xs },
  dockBtnLand: { minHeight: MIN_TOUCH, minWidth: 72 },
  dockBtnOn: { borderColor: colors.primary, backgroundColor: colors.surfaceAlt },
  dockBtnText: {
    color: colors.text,
    fontSize: fontSize.small,
    fontWeight: fontWeight.bold,
    textAlign: 'center',
  },
  menuSheet: {
    position: 'absolute',
    right: spacing.xs,
    zIndex: 20,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
  },
  menuList: { gap: spacing.sm },
  menuItem: {
    minHeight: MIN_TOUCH,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  menuOff: { opacity: 0.55 },
  menuText: { color: colors.text, fontSize: fontSize.small, fontWeight: fontWeight.bold },
  signalSheet: {
    position: 'absolute',
    left: spacing.xs,
    right: spacing.xs,
    alignItems: 'center',
    zIndex: 15,
  },
  signalSheetInner: { width: '100%', maxWidth: 560 },
  muted: { color: colors.textMuted, fontSize: fontSize.small, textAlign: 'center' },
  banner: {
    backgroundColor: colors.surfaceAlt,
    padding: spacing.sm,
    alignItems: 'center',
    gap: spacing.sm,
  },
  bannerError: { borderBottomWidth: 2, borderBottomColor: colors.danger },
  bannerText: { color: colors.text, fontSize: fontSize.body, fontWeight: fontWeight.bold },
  presence: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surfaceAlt,
    color: colors.textMuted,
    fontSize: fontSize.small,
    textAlign: 'center',
    padding: spacing.xs,
  },
  signalNote: {
    position: 'absolute',
    top: spacing.xl,
    left: spacing.md,
    right: spacing.md,
    backgroundColor: colors.surfaceAlt,
    color: colors.text,
    fontSize: fontSize.body,
    fontWeight: fontWeight.bold,
    textAlign: 'center',
    padding: spacing.sm,
    borderRadius: radius.md,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
  },
  dialog: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.md,
    width: '100%',
    maxWidth: 360,
  },
  dialogTitle: { color: colors.text, fontSize: fontSize.large, fontWeight: fontWeight.heavy },
  dialogBody: { color: colors.textMuted, fontSize: fontSize.body },
});
