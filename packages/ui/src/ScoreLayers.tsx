import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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

  return (
    <View style={styles.box}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={open ? 'Fechar histórico das mãos' : 'Abrir histórico das mãos'}
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
        </View>
      ) : null}
    </View>
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
});
