import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { LegalActionId } from '@trucaco/protocol';
import { betButtons } from './bets';
import type { BetContext, BetButtonTone } from './bets';
import { MIN_TOUCH, colors, fontSize, fontWeight, radius, spacing } from './tokens';

export interface BetButtonsProps extends BetContext {
  readonly legalActions: readonly string[];
  readonly onPress: (actionId: LegalActionId) => void;
  /** Bloqueia toques enquanto a ação anterior não foi confirmada pelo servidor. */
  readonly busy?: boolean;
}

const TONE: Readonly<Record<BetButtonTone, { bg: string; fg: string }>> = {
  primary: { bg: colors.primary, fg: colors.onPrimary },
  danger: { bg: colors.danger, fg: colors.onDanger },
  neutral: { bg: colors.surfaceAlt, fg: colors.text },
};

/** Botões de aposta contextuais: só o que `legalActions` permite. Sem ações, não renderiza nada. */
export function BetButtons({ legalActions, onPress, busy, ...ctx }: BetButtonsProps) {
  const specs = betButtons(legalActions, ctx);
  if (specs.length === 0) return null;
  return (
    <View accessibilityRole="toolbar" accessibilityLabel="Ações da mão" style={styles.row}>
      {specs.map((b) => {
        const tone = TONE[b.tone];
        return (
          <Pressable
            key={b.id}
            accessibilityRole="button"
            accessibilityLabel={b.accessibilityLabel}
            aria-disabled={busy === true}
            disabled={busy === true}
            onPress={() => onPress(b.id)}
            style={[styles.btn, { backgroundColor: tone.bg }, busy === true && styles.busy]}
          >
            <Text style={[styles.label, { color: tone.fg }]}>{b.label}</Text>
            {b.detail !== undefined ? (
              <Text style={[styles.detail, { color: tone.fg }]}>{b.detail}</Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm },
  btn: {
    minHeight: MIN_TOUCH,
    minWidth: MIN_TOUCH * 2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  busy: { opacity: 0.55 },
  label: { fontSize: fontSize.body, fontWeight: fontWeight.heavy },
  detail: { fontSize: fontSize.caption, fontWeight: fontWeight.bold },
});
