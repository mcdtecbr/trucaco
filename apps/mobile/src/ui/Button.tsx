import { Pressable, StyleSheet, Text } from 'react-native';
import { MIN_TOUCH, colors, fontSize, radius, spacing } from '@trucaco/ui';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
  hint?: string;
  testID?: string;
}

/** Botão com alvo >= 44 pt. `disabled` também vale durante requisição (anti duplo clique). */
export function Button({
  label,
  onPress,
  disabled = false,
  variant = 'primary',
  hint,
  testID,
}: ButtonProps) {
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      {...(hint !== undefined ? { accessibilityHint: hint } : {})}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      {...(testID !== undefined ? { testID } : {})}
      style={({ pressed }) => [
        styles.base,
        primary ? styles.primary : styles.secondary,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.label, primary ? styles.labelPrimary : styles.labelSecondary]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: MIN_TOUCH,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: { backgroundColor: colors.primary },
  secondary: { backgroundColor: 'transparent', borderWidth: 2, borderColor: colors.border },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
  label: { fontSize: fontSize.body, fontWeight: '700' },
  labelPrimary: { color: colors.onPrimary },
  labelSecondary: { color: colors.text },
});
