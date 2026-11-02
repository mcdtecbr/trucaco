import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MIN_TOUCH, colors, fontSize, radius, spacing } from '@trucaco/ui';

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
}

/** Escolha única (rádio) em linha. */
export function ChoiceGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
  testID,
}: {
  label: string;
  options: readonly ChoiceOption<T>[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.group}>
      <Text style={styles.caption}>{label}</Text>
      <View style={styles.row}>
        {options.map((o) => {
          const checked = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityLabel={o.label}
              aria-checked={checked}
              aria-disabled={disabled}
              disabled={disabled}
              onPress={() => onChange(o.value)}
              {...(testID !== undefined ? { testID: `${testID}-${o.value}` } : {})}
              style={[styles.item, checked && styles.itemChecked, disabled && styles.disabled]}
            >
              <Text style={[styles.itemText, checked && styles.itemTextChecked]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Liga/desliga. */
export function Toggle({
  label,
  value,
  onChange,
  disabled = false,
  testID,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      aria-checked={value}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={() => onChange(!value)}
      {...(testID !== undefined ? { testID } : {})}
      style={[styles.toggle, disabled && styles.disabled]}
    >
      <View style={[styles.box, value && styles.boxOn]}>
        <Text style={styles.boxMark}>{value ? '✓' : ''}</Text>
      </View>
      <Text style={styles.itemText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.xs },
  caption: { color: colors.textMuted, fontSize: fontSize.small },
  row: { flexDirection: 'row', gap: spacing.sm },
  item: {
    flex: 1,
    minHeight: MIN_TOUCH,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  itemChecked: { backgroundColor: colors.surfaceAlt, borderColor: colors.primary },
  itemText: { color: colors.text, fontSize: fontSize.body },
  itemTextChecked: { fontWeight: '700' },
  disabled: { opacity: 0.5 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: MIN_TOUCH },
  box: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  boxMark: { color: colors.onPrimary, fontWeight: '700' },
});
