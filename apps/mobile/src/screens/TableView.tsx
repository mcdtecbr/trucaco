/**
 * Mesa jogável (apresentação pura): recebe o `TableViewModel` e callbacks. Nenhuma regra de jogo aqui:
 * cartas e botões habilitados vêm de `legalActions`; valores de aposta e manilhas, do estado.
 */
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { betCry, parseLegalAction } from '@trucaco/protocol';
import type { LegalActionId } from '@trucaco/protocol';
import {
  AvatarPlaceholder,
  BetButtons,
  Card,
  ChatBubble,
  HandFan,
  MIN_TOUCH,
  PlayedCards,
  ScoreLayers,
  SUIT_SYMBOL,
  TurnTimer,
  Vira,
  canCover,
  cardName,
  colors,
  fontSize,
  fontWeight,
  parseFace,
  radius,
  spacing,
} from '@trucaco/ui';
import type { HandResult, LayoutMode } from '@trucaco/ui';
import type { SeatView, TableViewModel } from '../table/projectTable';
import type { ConnectionBanner } from '../table/tableRoute';
import type { ChatBubbleEntry, LingeringTrick } from '../table/tableStore';
import { Button } from '../ui/Button';
import { ChatPanel } from './ChatPanel';
import type { ChatPanelProps } from './ChatPanel';

export interface TableViewProps {
  vm: TableViewModel;
  layout: LayoutMode;
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
  /** Balão de chat por assento (4 s). */
  bubbles: Readonly<Record<number, ChatBubbleEntry>>;
  deadlineAt: number;
  clockOffsetMs: number;
  leaveConfirm: boolean;
  on: {
    pressCard(id: LegalActionId): void;
    act(id: LegalActionId): void;
    confirmSelected(): void;
    dismissError(): void;
    toggleCover(): void;
    voteCancel(): void;
    openChat(): void;
    askLeave(): void;
    cancelLeave(): void;
    leave(): void;
  };
}

function seatCaption(s: SeatView, vm: TableViewModel): string {
  if (s.isTurn && vm.handPhase !== 'specialDecision') return 'vez';
  if (vm.phase === 'playing' && s.handSize > 0) {
    return s.handSize === 1 ? '1 carta' : `${s.handSize} cartas`;
  }
  return '';
}

function Bubble({
  seat,
  vm,
  bubbles,
}: {
  seat: number;
  vm: TableViewModel;
  bubbles: Readonly<Record<number, ChatBubbleEntry>>;
}) {
  const b = bubbles[seat];
  if (b === undefined) return null;
  const author = seat === vm.mySeat ? 'Você' : vm.seats[seat]?.nickname || `Jogador ${seat + 1}`;
  // Posição absoluta sobre o avatar: o balão aparece e some sem deslocar o layout.
  return (
    <View style={styles.bubbleSlot} pointerEvents="none">
      <ChatBubble
        author={author}
        text={b.text}
        partner={b.scope === 'partner'}
        testID={`bubble-${seat}`}
      />
    </View>
  );
}

function Seat({
  s,
  vm,
  bubbles,
}: {
  s: SeatView;
  vm: TableViewModel;
  bubbles: Readonly<Record<number, ChatBubbleEntry>>;
}) {
  return (
    <View testID={`table-seat-${s.seat}`} style={styles.seatBox}>
      <Bubble seat={s.seat} vm={vm} bubbles={bubbles} />
      <AvatarPlaceholder
        nickname={s.nickname || '—'}
        status={s.nickname === '' && s.status === 'connected' ? 'empty' : s.status}
        side={s.side}
        active={s.isTurn}
        caption={seatCaption(s, vm)}
        layout="column"
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
    if (vm.canAct) return 'Sua dupla decide';
    return vm.decidingTeam >= 0 ? 'A dupla adversária decide' : null;
  }
  // Aposta pendente: os dois da dupla que responde têm ação legal (actingSeat é o menor assento).
  if (vm.handPhase === 'betPending' && vm.canAct) return 'Sua dupla responde';
  if (vm.actingSeat === vm.mySeat || vm.canAct) return 'Sua vez';
  if (vm.actingSeat < 0) return null;
  const n = vm.seats[vm.actingSeat]?.nickname;
  return `Vez de ${n !== undefined && n !== '' ? n : 'outro jogador'}`;
}

function selectedLabel(selected: string | null): string | null {
  const a = parseLegalAction(selected);
  if (a === null) return null;
  if (a.kind === 'play') return `Jogar ${cardName(a.card.rank, a.card.suit)}`;
  if (a.kind === 'playCovered') return `Jogar coberta: ${cardName(a.card.rank, a.card.suit)}`;
  if (a.kind === 'playBlind') return `Jogar a carta ${a.index + 1}`;
  return null;
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

export function TableView(p: TableViewProps) {
  const { vm } = p;
  const wide = p.layout === 'wide';
  const playedSize = wide ? 'md' : 'sm';
  const handSize = 'lg';
  const nicknameOf = (seat: number): string => vm.seats[seat]?.nickname ?? '';
  const modalOpen = p.leaveConfirm;
  const actionsOn = p.connected && !p.busy && !modalOpen;
  const legal = p.connected && !modalOpen ? vm.legalActions : [];
  const label = selectedLabel(p.selected);
  const pending = pendingText(vm);
  const turn = turnText(vm);
  const mineSeat = vm.byPosition.self;
  // Sonda para E2E (esperar por estado, nunca por tempo); fora da árvore de acessibilidade.
  const probe = `${vm.phase}|turn=${vm.actingSeat}|hand=${vm.handNumber}|act=${String(vm.canAct)}|plays=${vm.current.length}|match=${vm.matchNumber}|me=${vm.mySeat}`;

  const score = (
    <ScoreLayers
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
      defaultHistoryOpen={wide}
    />
  );
  const vira = (
    <Vira
      viraRank={vm.vira.rank}
      viraSuit={vm.vira.suit}
      {...(vm.manilhaLabel !== undefined ? { manilhaLabel: vm.manilhaLabel } : {})}
    />
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
  const mineiroManilhas =
    vm.variant === 'mineiro' && vm.manilhas.length > 0 ? (
      <Text style={styles.muted} testID="manilhas">
        Manilhas: {vm.manilhas.map((m) => `${m.rank}${SUIT_SYMBOL[m.suit]}`).join(' ')}
      </Text>
    ) : null;

  const board = (
    <View style={styles.board}>
      <View style={styles.partner}>
        <Seat s={vm.byPosition.partner} vm={vm} bubbles={p.bubbles} />
      </View>
      <View style={styles.middle}>
        <View style={styles.side}>
          <Seat s={vm.byPosition.left} vm={vm} bubbles={p.bubbles} />
        </View>
        <View style={styles.center} testID="trick">
          <PlayedCards
            plays={trickPlays}
            mySeat={vm.mySeat >= 0 ? vm.mySeat : 0}
            ownCovered={trickOwn}
            manilhas={vm.manilhas}
            nicknameOf={nicknameOf}
            size={playedSize}
          />
          {lingerWinner !== null ? (
            <Text style={styles.muted} testID="trick-winner">
              {lingerWinner}
            </Text>
          ) : null}
        </View>
        <View style={styles.side}>
          <Seat s={vm.byPosition.right} vm={vm} bubbles={p.bubbles} />
        </View>
      </View>
    </View>
  );

  const controls = (
    <View style={styles.controls}>
      <View style={styles.statusRow}>
        {turn !== null ? (
          <Text style={[styles.turn, vm.canAct && styles.turnMine]} testID="turn-text">
            {turn}
          </Text>
        ) : null}
        <View style={styles.timer} testID="turn-timer">
          <TurnTimer deadlineAt={p.deadlineAt} clockOffsetMs={p.clockOffsetMs} />
        </View>
      </View>
      {pending !== null ? (
        <Text style={styles.pending} testID="pending-bet" accessibilityLiveRegion="polite">
          {pending}
        </Text>
      ) : null}
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
      <BetButtons
        legalActions={legal}
        busy={!actionsOn}
        raising={vm.pending !== null}
        nextValue={vm.nextBetValue}
        pendingValue={vm.pendingValue}
        onPress={p.on.act}
      />
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
      {canCover(legal) ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={p.coverMode ? 'Cobrir carta, ligado' : 'Cobrir carta, desligado'}
          accessibilityHint="Quando ligado, a carta escolhida é jogada coberta"
          accessibilityState={{ selected: p.coverMode }}
          aria-pressed={p.coverMode}
          onPress={p.on.toggleCover}
          style={[styles.cover, p.coverMode && styles.coverOn]}
          testID="cover-toggle"
        >
          <Text style={styles.menuText}>{p.coverMode ? 'Cobrir: ligado' : 'Cobrir'}</Text>
        </Pressable>
      ) : null}
      {label !== null && actionsOn ? (
        <Button label={label} onPress={p.on.confirmSelected} testID="confirm-play" />
      ) : null}
      <View testID="my-hand">
        <HandFan
          hand={vm.myHand}
          legalActions={actionsOn ? vm.legalActions : []}
          blindCount={vm.blindCount}
          coverMode={p.coverMode}
          manilhas={vm.manilhas}
          selectedAction={p.selected}
          size={handSize}
          onPress={p.on.pressCard}
        />
      </View>
    </View>
  );

  const votes = vm.cancelVotes.length;
  const cancelText = vm.iVotedCancel
    ? `Cancelar: você votou (${votes})`
    : votes > 0
      ? `Cancelar mesa (${votes})`
      : 'Cancelar mesa';
  const cancelLabel = vm.iVotedCancel
    ? `Você já votou para cancelar a mesa. ${votes} votos.`
    : `Votar para cancelar a mesa. ${votes} votos até agora. Todos os jogadores humanos precisam concordar.`;

  const footer = (
    <View style={styles.footer}>
      <View testID="my-seat" style={styles.seatBox}>
        <Bubble seat={vm.mySeat} vm={vm} bubbles={p.bubbles} />
        <AvatarPlaceholder
          nickname={mineSeat.nickname || 'Você'}
          status={mineSeat.status}
          side="mine"
          active={mineSeat.isTurn}
          caption="você"
        />
      </View>
      <View style={styles.menuRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            p.chatUnreadTotal > 0 ? `Chat, ${p.chatUnreadTotal} mensagens novas` : 'Chat'
          }
          onPress={p.on.openChat}
          style={styles.menu}
          testID="open-chat"
        >
          <Text style={styles.menuText}>
            {p.chatUnreadTotal > 0 ? `Chat (${p.chatUnreadTotal})` : 'Chat'}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={cancelLabel}
          aria-disabled={vm.iVotedCancel || !p.connected}
          disabled={vm.iVotedCancel || !p.connected}
          onPress={p.on.voteCancel}
          style={[styles.menu, vm.iVotedCancel && styles.menuOff]}
          testID="vote-cancel"
        >
          <Text style={styles.menuText}>{cancelText}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sair da mesa"
          onPress={p.on.askLeave}
          style={styles.menu}
          testID="leave-table"
        >
          <Text style={styles.menuText}>Sair da mesa</Text>
        </Pressable>
      </View>
    </View>
  );

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
        <Banner banner={p.banner} onLeave={p.on.leave} />
        {wide ? (
          <View style={styles.wideRow}>
            <ScrollView style={styles.wideMain} contentContainerStyle={styles.wideMainContent}>
              {board}
              {controls}
              {footer}
            </ScrollView>
            <ScrollView style={styles.sidebar} contentContainerStyle={styles.sidebarContent}>
              {score}
              <View style={styles.viraBox}>{vira}</View>
              {mineiroManilhas}
            </ScrollView>
          </View>
        ) : (
          <ScrollView style={styles.phone} contentContainerStyle={styles.phoneContent}>
            <View style={styles.topRow}>
              <View style={styles.topScore}>{score}</View>
              <View>{vira}</View>
            </View>
            {mineiroManilhas}
            {board}
            {controls}
            {footer}
          </ScrollView>
        )}
      </View>
      {p.presenceNote !== null ? (
        <Text style={styles.presence} testID="presence-note" pointerEvents="none">
          {p.presenceNote}
        </Text>
      ) : null}
      {p.chatPanel !== null ? <ChatPanel {...p.chatPanel} /> : null}
      {confirm}
    </View>
  );
}

/** Largura da lateral do web largo (placar completo, vira). */
const SIDEBAR_WIDTH = 340;

const styles = StyleSheet.create({
  seatBox: { position: 'relative' },
  bubbleSlot: {
    position: 'absolute',
    bottom: '100%',
    left: -spacing.lg,
    right: -spacing.lg,
    alignItems: 'center',
    zIndex: 1,
  },
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  partnerRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm },
  cover: {
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
  },
  coverOn: { borderColor: colors.primary, backgroundColor: colors.surfaceAlt },
  menuRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'flex-end' },
  menuOff: { opacity: 0.55 },
  probe: { position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' },
  phone: { flex: 1 },
  phoneContent: { flexGrow: 1, padding: spacing.sm, gap: spacing.sm },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  topScore: { flex: 1 },
  board: { flex: 1, justifyContent: 'center', gap: spacing.md },
  partner: { alignItems: 'center' },
  middle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  side: { width: 88, alignItems: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  controls: { gap: spacing.sm, alignItems: 'stretch' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  turn: { color: colors.textMuted, fontSize: fontSize.small, fontWeight: fontWeight.bold },
  turnMine: { color: colors.primary },
  timer: { flex: 1 },
  pending: {
    color: colors.primary,
    fontSize: fontSize.body,
    fontWeight: fontWeight.bold,
    textAlign: 'center',
  },
  error: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.sm,
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
  },
  errorText: { color: colors.danger, fontSize: fontSize.small, textAlign: 'center' },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  menu: {
    minHeight: MIN_TOUCH,
    minWidth: MIN_TOUCH,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  menuText: { color: colors.text, fontSize: fontSize.small, fontWeight: fontWeight.bold },
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
  wideRow: { flex: 1, flexDirection: 'row' },
  wideMain: { flex: 1 },
  wideMainContent: {
    flexGrow: 1,
    padding: spacing.md,
    gap: spacing.md,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    justifyContent: 'center',
  },
  sidebar: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: SIDEBAR_WIDTH,
    width: SIDEBAR_WIDTH,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
  },
  sidebarContent: { padding: spacing.md, gap: spacing.md },
  viraBox: { alignItems: 'center' },
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
