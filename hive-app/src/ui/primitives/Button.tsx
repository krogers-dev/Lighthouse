import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from './AppText';
import { useThemeColors } from '../theme';
import { layout, spacing, touchTarget } from '../tokens';

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
    minHeight: layout.controlMinHeight,
    minWidth: touchTarget.minWidth,
    borderRadius: layout.buttonRadius,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    borderWidth: 2,
  },
  focused: {
    outlineStyle: 'solid',
    outlineWidth: layout.focusRingWidth,
    outlineOffset: layout.focusRingOffset,
  },
});

/** Pill-shaped action. Primary is Soft Black with Warm Paper text by day
 * and Honey Gold with Soft Black text by night; secondary is an outlined
 * pill in the reading color. */
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
        // The ring sits outside the pill so focus never shifts layout; the
        // border color changes too, for a renderer without outline support.
        focused && [
          styles.focused,
          { outlineColor: colors.focusRing, borderColor: colors.focusRing },
        ],
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
