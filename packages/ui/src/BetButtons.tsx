import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { LegalActionId } from '@trucaco/protocol';
import { betButtons, betCorner } from './bets';
import type { BetButtonSpec, BetContext, BetButtonTone } from './bets';
import { MIN_TOUCH, colors, fontSize, fontWeight, radius, spacing } from './tokens';

export interface BetButtonsProps extends BetContext {
  readonly legalActions: readonly string[];
  readonly onPress: (actionId: LegalActionId) => void;
  /** Bloqueia toques enquanto a ação anterior não foi confirmada pelo servidor. */
  readonly busy?: boolean;
  /**
   * `row` (padrão): fileira centrada. `corner`: canto da dock, com o botão principal (TRUCO!, SEIS!,
   * NOVE!, DOZE!) grande e SEMPRE na mesma posição, e as respostas (correr, aceitar) ao lado.
   */
  readonly variant?: 'row' | 'corner';
}

const TONE: Readonly<Record<BetButtonTone, { bg: string; fg: string }>> = {
  primary: { bg: colors.primary, fg: colors.onPrimary },
  danger: { bg: colors.danger, fg: colors.onDanger },
  neutral: { bg: colors.surfaceAlt, fg: colors.text },
};

/** Botões de aposta contextuais: só o que `legalActions` permite. Sem ações, não renderiza nada. */
export function BetButtons({ legalActions, onPress, busy, variant, ...ctx }: BetButtonsProps) {
  const specs = betButtons(legalActions, ctx);
  if (specs.length === 0) return null;
  const off = busy === true;
  const button = (b: BetButtonSpec, mode: 'row' | 'main' | 'side') => {
    const tone = TONE[b.tone];
    return (
      <Pressable
        key={b.id}
        accessibilityRole="button"
        accessibilityLabel={b.accessibilityLabel}
        aria-disabled={off}
        disabled={off}
        onPress={() => onPress(b.id)}
        style={[
          styles.btn,
          mode === 'main' && styles.big,
          mode === 'side' && styles.side,
          { backgroundColor: tone.bg },
          off && styles.busy,
        ]}
        testID={`bet-${b.id}`}
      >
        <Text
          style={[
            mode === 'main' ? styles.bigLabel : mode === 'side' ? styles.sideLabel : styles.label,
            { color: tone.fg },
          ]}
        >
          {b.label}
        </Text>
        {b.detail !== undefined ? (
          <Text style={[styles.detail, { color: tone.fg }]}>{b.detail}</Text>
        ) : null}
      </Pressable>
    );
  };
  if (variant === 'corner') {
    const { main, side } = betCorner(specs);
    return (
      <View accessibilityRole="toolbar" accessibilityLabel="Ações da mão" style={styles.corner}>
        {side.map((b) => button(b, 'side'))}
        {/* O principal é sempre o último (canto). Sem ele, as respostas ocupam o canto: nada fica reservado. */}
        {main !== null ? button(main, 'main') : null}
      </View>
    );
  }
  return (
    <View accessibilityRole="toolbar" accessibilityLabel="Ações da mão" style={styles.row}>
      {specs.map((b) => button(b, 'row'))}
    </View>
  );
}

/** Lado do botão grande do canto (altura e largura mínima; folga sobre o alvo de 44 pt). */
export const BET_BIG_HEIGHT = 64;
export const BET_BIG_WIDTH = 96;
/**
 * Largura mínima de correr/aceitar/jogar a mão ao lado do botão principal. Abaixo da largura do texto o
 * rótulo quebra em duas linhas (o botão encolhe até aqui), então nada fica sob outro botão.
 */
export const BET_SIDE_WIDTH = 64;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm },
  corner: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
  },
  btn: {
    minHeight: MIN_TOUCH,
    minWidth: MIN_TOUCH * 2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  big: {
    minHeight: BET_BIG_HEIGHT,
    minWidth: BET_BIG_WIDTH,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  side: {
    flexShrink: 1,
    minHeight: BET_BIG_HEIGHT,
    minWidth: BET_SIDE_WIDTH,
    paddingHorizontal: spacing.xs,
  },
  busy: { opacity: 0.55 },
  label: { fontSize: fontSize.body, fontWeight: fontWeight.heavy },
  sideLabel: { fontSize: fontSize.small, fontWeight: fontWeight.heavy, textAlign: 'center' },
  bigLabel: { fontSize: fontSize.large, fontWeight: fontWeight.heavy },
  detail: { fontSize: fontSize.caption, fontWeight: fontWeight.bold },
});

/**
 * Largura mínima (px) que o canto ocupa com os botões encolhidos ao máximo: laterais no mínimo, principal
 * (se houver) com a largura própria e o espaço entre eles. Usada para conferir que a dock não transborda.
 */
export function cornerMinWidth(sideCount: number, hasMain: boolean): number {
  const n = sideCount + (hasMain ? 1 : 0);
  if (n === 0) return 0;
  return sideCount * BET_SIDE_WIDTH + (hasMain ? BET_BIG_WIDTH : 0) + (n - 1) * spacing.sm;
}
