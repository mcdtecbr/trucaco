import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { TextInputProps } from 'react-native';
import { MIN_TOUCH, colors, fontSize, radius, spacing } from '@trucaco/ui';

export interface TextFieldProps {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  disabled?: boolean;
  testID?: string;
  maxLength?: number;
  autoCapitalize?: TextInputProps['autoCapitalize'];
  onSubmit?: () => void;
}

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  disabled = false,
  testID,
  maxLength,
  autoCapitalize = 'none',
  onSubmit,
}: TextFieldProps) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.caption}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        editable={!disabled}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        spellCheck={false}
        placeholderTextColor={colors.textMuted}
        {...(placeholder !== undefined ? { placeholder } : {})}
        {...(maxLength !== undefined ? { maxLength } : {})}
        {...(testID !== undefined ? { testID } : {})}
        {...(onSubmit !== undefined ? { onSubmitEditing: onSubmit } : {})}
        style={[styles.input, disabled && styles.disabled]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  caption: { color: colors.textMuted, fontSize: fontSize.small },
  input: {
    minHeight: MIN_TOUCH,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: fontSize.body,
    paddingHorizontal: spacing.md,
  },
  disabled: { opacity: 0.5 },
});
