import React, { useState } from 'react';
import { StyleSheet, TextInput, View, type KeyboardTypeOptions } from 'react-native';

import { AppText } from './AppText';
import { fontStyleFor, useFontStatus } from '../fonts';
import { useThemeColors } from '../theme';
import { inputType, layout, spacing } from '../tokens';

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
  /** testID for the LABEL text. A device flow taps it to blur the field:
   * the label is plain text (never a control), sits directly above the
   * input so it is on screen whenever the input is, and a tap on it is
   * unhandled — the ScrollView blurs the input and the soft keyboard, if
   * one is up, goes with the focus. This replaces Maestro's hideKeyboard,
   * which on Android is an unconditional BACK key press (find 37). */
  labelTestID?: string;
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  input: {
    minHeight: layout.fieldMinHeight,
    borderWidth: 2,
    borderRadius: layout.fieldRadius,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: inputType.fontSize,
    lineHeight: inputType.lineHeight,
  },
  focused: {
    outlineStyle: 'solid',
    outlineWidth: layout.focusRingWidth,
    outlineOffset: layout.focusRingOffset,
  },
});

/** Square-cornered field with a persistent label above it. The boundary is
 * Muted Copy by day and Sage by night — a real boundary, never a decorative
 * rule — and the native input itself renders in Manrope Medium once the
 * faces are registered. */
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
  labelTestID,
}: TextFieldProps): React.JSX.Element {
  const colors = useThemeColors();
  const fontStatus = useFontStatus();
  const [focused, setFocused] = useState(false);
  const hasError = Boolean(errorText);
  return (
    <View style={styles.container}>
      <AppText variant="labelSmall" testID={labelTestID}>
        {label}
      </AppText>
      <TextInput
        accessibilityLabel={label}
        accessibilityState={{ disabled: !editable }}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textSecondary}
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
          fontStyleFor(inputType, fontStatus),
          {
            color: colors.textPrimary,
            backgroundColor: colors.surface,
            borderColor: hasError ? colors.dangerText : focused ? colors.focusRing : colors.border,
            opacity: editable ? 1 : 0.6,
          },
          focused && [styles.focused, { outlineColor: colors.focusRing }],
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
