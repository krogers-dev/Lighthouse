import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from './AppText';
import { useThemeColors } from '../theme';
import { radii, spacing, touchTarget } from '../tokens';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary';
  disabled?: boolean;
  /** Busy state keeps the label visible and blocks re-press; no layout shift. */
  loading?: boolean;
  accessibilityHint?: string;
  testID?: string;
}

const styles = StyleSheet.create({
  base: {
    minHeight: touchTarget.minHeight,
    minWidth: touchTarget.minWidth,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    borderWidth: 2,
  },
});

export function Button({
  label,
  onPress,
  kind = 'primary',
  disabled = false,
  loading = false,
  accessibilityHint,
  testID,
}: ButtonProps): React.JSX.Element {
  const colors = useThemeColors();
  // Keyboard/switch focus visibility (web, TV, hardware keyboards). Pressable
  // does not surface focus in its style callback, so it is tracked here.
  const [focused, setFocused] = useState(false);
  const blocked = disabled || loading;
  const isPrimary = kind === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: blocked, busy: loading }}
      disabled={blocked}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      testID={testID}
      hitSlop={4}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: isPrimary ? colors.primaryActionBackground : 'transparent',
          borderColor: isPrimary ? colors.primaryActionBackground : colors.secondaryActionBorder,
          // Press feedback is immediate and layout-stable: opacity only.
          opacity: blocked ? 0.55 : pressed ? 0.85 : 1,
        },
        focused && {
          borderColor: colors.focusRing,
          borderStyle: 'dashed',
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={isPrimary ? colors.primaryActionText : colors.secondaryActionText}
        />
      ) : null}
      <View>
        <AppText variant="label" tone={isPrimary ? 'inverse' : 'primary'}>
          {label}
        </AppText>
      </View>
    </Pressable>
  );
}
