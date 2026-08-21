import React, { useState } from 'react';
import { StyleSheet, TextInput, View, type KeyboardTypeOptions } from 'react-native';

import { AppText } from './AppText';
import { useThemeColors } from '../theme';
import { radii, spacing, touchTarget, typeScale } from '../tokens';

export interface TextFieldProps {
  /** Persistent visible label; also the accessibility label. */
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  /** Error text is announced and prefixed, never conveyed by color alone. */
  errorText?: string;
  helperText?: string;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoComplete?: 'email' | 'one-time-code' | 'off';
  secureTextEntry?: boolean;
  editable?: boolean;
  onSubmitEditing?: () => void;
  testID?: string;
}

const styles = StyleSheet.create({
  container: { gap: spacing.xs },
  input: {
    minHeight: touchTarget.minHeight,
    borderWidth: 2,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    fontSize: typeScale.body.fontSize,
  },
});

export function TextField({
  label,
  value,
  onChangeText,
  errorText,
  helperText,
  placeholder,
  keyboardType,
  autoCapitalize = 'none',
  autoComplete = 'off',
  secureTextEntry = false,
  editable = true,
  onSubmitEditing,
  testID,
}: TextFieldProps): React.JSX.Element {
  const colors = useThemeColors();
  const [focused, setFocused] = useState(false);
  const hasError = Boolean(errorText);
  return (
    <View style={styles.container}>
      <AppText variant="label">{label}</AppText>
      <TextInput
        accessibilityLabel={label}
        accessibilityState={{ disabled: !editable }}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textDisabled}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        autoCorrect={false}
        secureTextEntry={secureTextEntry}
        editable={editable}
        onSubmitEditing={onSubmitEditing}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        allowFontScaling
        testID={testID}
        style={[
          styles.input,
          {
            color: colors.textPrimary,
            backgroundColor: colors.surface,
            borderColor: hasError ? colors.dangerText : focused ? colors.focusRing : colors.border,
            opacity: editable ? 1 : 0.6,
          },
        ]}
      />
      {hasError ? (
        <AppText variant="caption" tone="danger" accessibilityRole="alert">
          {`Error: ${errorText}`}
        </AppText>
      ) : helperText ? (
        <AppText variant="caption" tone="secondary">
          {helperText}
        </AppText>
      ) : null}
    </View>
  );
}
