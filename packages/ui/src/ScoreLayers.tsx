import { useState } from 'react';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  describeHandResult,
  defaultTeamNames,
  scoreSummary,
  specialText,
  trickMarks,
} from './score';
import type { HandResult, TrickMark } from './score';
import { MIN_TOUCH, colors, fontSize, fontWeight, radius, spacing, teamColors } from './tokens';

export interface ScoreLayersProps {
  /** Dupla do jogador local (0 ou 1): é destacada e vira "Nós". */
  readonly myTeam: 0 | 1;
  /** Nomes por dupla (índice = dupla). Padrão: "Nós" e "Eles". */
  readonly teamNames?: readonly [string, string];
  /** `snapshot.series`. */
  readonly series: {
    readonly format: string;
    readonly games: readonly number[];
    readonly gameNumber: number;
  };
  /** `snapshot.game.scores`. */
  readonly scores: readonly number[];
  readonly handNumber: number;
  /** `snapshot.hand.value`. */
  readonly handValue: number;
  /** `snapshot.hand.special`. */
  readonly special: string;
  /** `snapshot.hand.tricks` (só `winnerTeam` é usado). */
  readonly tricks: readonly { readonly winnerTeam: number }[];
  /** Histórico das mãos do jogo, alimentado pelo contêiner (coleta de eventos no 3H). */
  readonly history?: readonly HandResult[];
  /** Lances da mão em curso (vazios = não mostra a seção). */
  readonly currentLog?: readonly string[];
  readonly variant?: string;
  readonly defaultHistoryOpen?: boolean;
  /**
   * Versão compacta para ficar fixa no canto da mesa (Nós × Eles, vazas, "Vale", "Mão"). O histórico
   * fica recolhido por padrão, atrás de um botão expandir/recolher que abre sobre a mesa.
   */
  readonly compact?: boolean;
  /**
   * Barra de largura total no topo da mesa (celular e web): duplas com pontos e vazas em bolinhas,
   * "Vale N" e mão especial, ícone do histórico e `actions` (chat, menu, sair) à direita, faixa de
   * publicidade sob a barra. Tem precedência sobre `compact`.
   */
  readonly bar?: boolean;
  /** Botões à direita da barra (só com `bar`). */
  readonly actions?: ReactNode;
  /**
   * Histórico controlado de fora (só com `bar`): o chamador desenha a lista numa camada de tela com
   * `ScoreHistoryList`, porque um dropdown fora dos limites do pai não recebe toque no Android.
   */
  readonly historyOpen?: boolean;
  readonly onHistoryOpenChange?: (open: boolean) => void;
  /** Faixa discreta sob os números (só na versão compacta); o chamador decide o conteúdo. */
  readonly adSlot?: ReactNode;
}

const GLYPH: Readonly<Record<TrickMark, string>> = { won: '●', lost: '✕', draw: '=', pending: '○' };
const MARK_COLOR: Readonly<Record<TrickMark, string>> = {
  won: colors.success,
  lost: colors.danger,
  draw: colors.primary,
  pending: colors.textMuted,
};

/** Placar numérico em camadas: série (bo3), jogo, mão (valor), vazas; toque abre o histórico. */
export function ScoreLayers(p: ScoreLayersProps) {
  const names = p.teamNames ?? defaultTeamNames(p.myTeam);
  const [open, setOpen] = useState(p.defaultHistoryOpen === true);
  const other = p.myTeam === 0 ? 1 : 0;
  const order: readonly (0 | 1)[] = [p.myTeam, other];
  const sp = specialText(p.special, p.variant);
  const history = p.history ?? [];
  const currentLog = p.currentLog ?? [];
  const label = scoreSummary({ ...p, names, tricks: p.tricks }, p.variant);

  if (p.bar === true) {
    const layered = p.onHistoryOpenChange !== undefined;
    const isOpen = layered ? p.historyOpen === true : open;
    const toggle = (): void => {
      if (layered) p.onHistoryOpenChange?.(!isOpen);
      else setOpen((o) => !o);
    };
    const historyView =
      !layered && isOpen ? (
        <View style={[styles.history, styles.dropdown, styles.barDropdown]} testID="score-history">
          <ScoreHistoryList {...p} />
        </View>
      ) : null;
    return (
      <View style={styles.barWrap} testID="score-compact">
        <View style={styles.barRow}>
          <View style={styles.barBox} accessible accessibilityLabel={label} testID="score-bar">
            {order.map((team) => (
              <View key={team} style={styles.barBlock}>
                <View style={styles.barTeamLine}>
                  <Text
                    style={[
                      styles.compactName,
                      { color: team === p.myTeam ? teamColors.mine.main : teamColors.theirs.main },
                    ]}
                    numberOfLines={1}
                  >
                    {names[team]}
                  </Text>
                  <Text style={[styles.barScore, team === p.myTeam && styles.scoreMine]}>
                    {p.scores[team] ?? 0}
                  </Text>
                </View>
                <View style={styles.marks}>
                  {trickMarks(p.tricks, team).map((m, i) => (
                    <Text key={i} style={[styles.compactMark, { color: MARK_COLOR[m] }]}>
                      {GLYPH[m]}
                    </Text>
                  ))}
                </View>
              </View>
            ))}
            {p.handNumber > 0 || p.series.format === 'bo3' ? (
              <View style={styles.barBlock}>
                {p.handNumber > 0 ? (
                  <Text style={styles.compactHand} numberOfLines={1}>
                    Vale {p.handValue}
                  </Text>
                ) : null}
                {p.handNumber > 0 && sp !== null ? (
                  <Text style={styles.compactCaption} numberOfLines={1}>
                    {sp}
                  </Text>
                ) : null}
                {p.series.format === 'bo3' ? (
                  <Text style={styles.compactCaption} numberOfLines={1}>
                    Série {p.series.games[p.myTeam] ?? 0}×{p.series.games[other] ?? 0}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
          <View style={styles.barActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                isOpen ? 'Histórico das jogadas, aberto' : 'Histórico das jogadas, fechado'
              }
              accessibilityHint={isOpen ? 'Recolher o histórico' : 'Expandir o histórico'}
              accessibilityState={{ expanded: isOpen }}
              aria-expanded={isOpen}
              onPress={toggle}
              style={styles.barIcon}
              testID="score-history-toggle"
            >
              <Text style={styles.barIconText}>{'📜'}</Text>
            </Pressable>
            {p.actions}
          </View>
        </View>
        {p.adSlot}
        {historyView}
      </View>
    );
  }

  if (p.compact === true) {
    const historyView = open ? (
      <View
        style={[styles.history, styles.dropdown]}
        accessibilityLabel="Histórico das mãos"
        accessibilityRole="list"
        testID="score-history"
      >
        <ScrollView style={styles.dropdownScroll} nestedScrollEnabled>
          <HistoryLines p={p} names={names} history={history} currentLog={currentLog} />
        </ScrollView>
      </View>
    ) : null;
    return (
      <View style={styles.compactWrap} testID="score-compact">
        <View style={styles.compactBox} accessible accessibilityLabel={label}>
          {p.series.format === 'bo3' ? (
            <Text style={styles.compactCaption}>
              Série {p.series.games[p.myTeam] ?? 0} × {p.series.games[other] ?? 0}
            </Text>
          ) : null}
          {order.map((team) => (
            <View key={team} style={styles.compactTeam}>
              <Text
                style={[
                  styles.compactName,
                  { color: team === p.myTeam ? teamColors.mine.main : teamColors.theirs.main },
                ]}
                numberOfLines={1}
              >
                {names[team]}
              </Text>
              <Text style={[styles.compactScore, team === p.myTeam && styles.scoreMine]}>
                {p.scores[team] ?? 0}
              </Text>
              <View style={styles.marks}>
                {trickMarks(p.tricks, team).map((m, i) => (
                  <Text key={i} style={[styles.compactMark, { color: MARK_COLOR[m] }]}>
                    {GLYPH[m]}
                  </Text>
                ))}
              </View>
            </View>
          ))}
          {p.handNumber > 0 ? (
            <Text style={styles.compactHand} numberOfLines={1}>
              Vale {p.handValue} · Mão {p.handNumber}
            </Text>
          ) : null}
          {p.handNumber > 0 && sp !== null ? (
            <Text style={styles.compactCaption} numberOfLines={1}>
              {sp}
            </Text>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            open ? 'Histórico das jogadas, aberto' : 'Histórico das jogadas, fechado'
          }
          accessibilityHint={open ? 'Recolher o histórico' : 'Expandir o histórico'}
          accessibilityState={{ expanded: open }}
          aria-expanded={open}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={() => setOpen((o) => !o)}
          style={styles.compactToggle}
          testID="score-history-toggle"
        >
          <Text style={styles.compactToggleText}>{open ? 'Histórico ▴' : 'Histórico ▾'}</Text>
        </Pressable>
        {p.adSlot}
        {historyView}
      </View>
    );
  }

  return (
    <View style={styles.box}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={open ? 'Fechar histórico das mãos' : 'Abrir histórico das mãos'}
        accessibilityState={{ expanded: open }}
        aria-expanded={open}
        onPress={() => setOpen((o) => !o)}
        style={styles.pressable}
      >
        {p.series.format === 'bo3' ? (
          <Text style={styles.series}>
            Série {p.series.games[p.myTeam] ?? 0} × {p.series.games[other] ?? 0} · Jogo{' '}
            {p.series.gameNumber}
          </Text>
        ) : null}
        <View style={styles.game}>
          {order.map((team) => (
            <View key={team} style={styles.team}>
              <Text
                style={[
                  styles.teamName,
                  { color: team === p.myTeam ? teamColors.mine.main : teamColors.theirs.main },
                ]}
                numberOfLines={1}
              >
                {names[team]}
              </Text>
              <Text style={[styles.score, team === p.myTeam && styles.scoreMine]}>
                {p.scores[team] ?? 0}
              </Text>
              <View style={styles.marks}>
                {trickMarks(p.tricks, team).map((m, i) => (
                  <Text key={i} style={[styles.mark, { color: MARK_COLOR[m] }]}>
                    {GLYPH[m]}
                  </Text>
                ))}
              </View>
            </View>
          ))}
        </View>
        {p.handNumber > 0 ? (
          <View style={styles.hand}>
            <Text style={styles.value}>Vale {p.handValue}</Text>
            <Text style={styles.handInfo}>
              Mão {p.handNumber}
              {sp !== null ? ` · ${sp}` : ''}
            </Text>
          </View>
        ) : null}
      </Pressable>
      {open ? (
        <View
          style={styles.history}
          accessibilityLabel="Histórico das mãos"
          accessibilityRole="list"
        >
          <HistoryLines p={p} names={names} history={history} currentLog={currentLog} />
        </View>
      ) : null}
    </View>
  );
}

/** Lista do histórico (rolável) para uma camada de tela; mesmo conteúdo do dropdown da barra. */
export function ScoreHistoryList(p: ScoreLayersProps) {
  const names = p.teamNames ?? defaultTeamNames(p.myTeam);
  return (
    <ScrollView
      style={styles.dropdownScroll}
      nestedScrollEnabled
      accessibilityRole="list"
      accessibilityLabel="Histórico das mãos"
    >
      <HistoryLines p={p} names={names} history={p.history ?? []} currentLog={p.currentLog ?? []} />
    </ScrollView>
  );
}

function HistoryLines({
  p,
  names,
  history,
  currentLog,
}: {
  p: ScoreLayersProps;
  names: readonly [string, string];
  history: readonly HandResult[];
  currentLog: readonly string[];
}) {
  return (
    <>
      {history.length === 0 ? (
        <Text style={styles.empty}>Nenhuma mão concluída ainda.</Text>
      ) : (
        history.map((r) => (
          <View key={r.handNumber} style={styles.entry}>
            <Text accessibilityRole="text" style={styles.row}>
              {describeHandResult(r, names)}
            </Text>
            {(r.details ?? []).map((line, i) => (
              <Text key={i} style={styles.detail}>
                {line}
              </Text>
            ))}
          </View>
        ))
      )}
      {currentLog.length > 0 ? (
        <View style={styles.entry} testID="current-hand-log">
          <Text style={styles.row}>Mão {p.handNumber} em curso</Text>
          {currentLog.map((line, i) => (
            <Text key={i} style={styles.detail}>
              {line}
            </Text>
          ))}
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  pressable: { minHeight: MIN_TOUCH, gap: spacing.sm },
  series: { color: colors.textMuted, fontSize: fontSize.small, textAlign: 'center' },
  game: { flexDirection: 'row', justifyContent: 'space-around' },
  team: { alignItems: 'center', minWidth: 72 },
  teamName: { fontSize: fontSize.small, fontWeight: fontWeight.bold },
  score: { color: colors.textMuted, fontSize: fontSize.score, fontWeight: fontWeight.heavy },
  scoreMine: { color: colors.text },
  marks: { flexDirection: 'row', gap: spacing.xs },
  mark: {
    fontSize: fontSize.body,
    fontWeight: fontWeight.bold,
    width: spacing.md,
    textAlign: 'center',
  },
  hand: { alignItems: 'center' },
  value: { color: colors.primary, fontSize: fontSize.large, fontWeight: fontWeight.heavy },
  handInfo: { color: colors.textMuted, fontSize: fontSize.caption },
  history: {
    gap: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  entry: { gap: spacing.xs },
  row: { color: colors.text, fontSize: fontSize.small },
  detail: { color: colors.textMuted, fontSize: fontSize.caption, paddingLeft: spacing.sm },
  empty: { color: colors.textMuted, fontSize: fontSize.small },
  compactWrap: { width: 116, alignItems: 'stretch' },
  compactBox: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    gap: 2,
    opacity: 0.96,
  },
  compactTeam: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  compactName: { fontSize: fontSize.caption, fontWeight: fontWeight.bold, flexShrink: 1 },
  compactScore: {
    color: colors.textMuted,
    fontSize: fontSize.large,
    fontWeight: fontWeight.heavy,
    minWidth: 22,
    textAlign: 'right',
  },
  compactMark: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.bold,
    width: 11,
    textAlign: 'center',
  },
  compactHand: { color: colors.primary, fontSize: fontSize.caption, fontWeight: fontWeight.bold },
  compactCaption: { color: colors.textMuted, fontSize: fontSize.caption },
  compactToggle: { alignItems: 'center', justifyContent: 'center', height: 28 },
  compactToggleText: {
    color: colors.text,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.bold,
  },
  dropdown: {
    position: 'absolute',
    top: '100%',
    right: 0,
    width: 280,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    zIndex: 10,
  },
  dropdownScroll: { maxHeight: 260 },
  barWrap: { alignSelf: 'stretch', alignItems: 'stretch', backgroundColor: colors.surface },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: spacing.sm,
  },
  barBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1 },
  barBlock: { alignItems: 'center', justifyContent: 'center', minWidth: 40 },
  barTeamLine: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
  barScore: {
    color: colors.textMuted,
    fontSize: fontSize.large,
    fontWeight: fontWeight.heavy,
  },
  barActions: { flexDirection: 'row', alignItems: 'center' },
  barIcon: {
    minWidth: MIN_TOUCH,
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  barIconText: { color: colors.text, fontSize: fontSize.large, fontWeight: fontWeight.bold },
  barDropdown: { top: '100%', left: 0, right: 0, width: '100%' },
});
