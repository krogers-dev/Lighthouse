import React from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from './AppText';
import { useThemeColors } from '../theme';
import { radii, spacing } from '../tokens';

export type StatusKind = 'neutral' | 'stable' | 'attention' | 'blocked';

export interface StatusBadgeProps {
  kind: StatusKind;
  label: string;
  testID?: string;
}

/** Kind is always spoken and printed alongside the label so status is never
 * color-only (WCAG 1.4.1). */
const KIND_WORD: Record<StatusKind, string> = {
  neutral: 'Status',
  stable: 'Done',
  attention: 'Needs attention',
  blocked: 'Paused',
};

const KIND_GLYPH: Record<StatusKind, string> = {
  neutral: '•',
  stable: '✓',
  attention: '!',
  blocked: '✕',
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm + spacing.xs,
    paddingVertical: spacing.xs + 1,
    alignSelf: 'flex-start',
  },
});

/** Attention sits on Soft Honey in Honey Ink; settled and neutral states on
 * the quiet moss and canvas panels; a paused state on the derived blocked
 * pair. The word carries the meaning; the panel only agrees with it. */
export function StatusBadge({ kind, label, testID }: StatusBadgeProps): React.JSX.Element {
  const colors = useThemeColors();
  const backgrounds: Record<StatusKind, string> = {
    neutral: colors.panelInfoBackground,
    stable: colors.panelStableBackground,
    attention: colors.panelAttentionBackground,
    blocked: colors.panelBlockedBackground,
  };
  const textColors: Record<StatusKind, string> = {
    neutral: colors.panelInfoText,
    stable: colors.panelStableText,
    attention: colors.panelAttentionText,
    blocked: colors.panelBlockedText,
  };
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={`${KIND_WORD[kind]}: ${label}`}
      style={[styles.badge, { backgroundColor: backgrounds[kind] }]}
    >
      <AppText
        variant="labelSmall"
        style={{ color: textColors[kind] }}
        importantForAccessibility="no"
      >
        {`${KIND_GLYPH[kind]} ${KIND_WORD[kind]}`}
      </AppText>
      <AppText variant="caption" style={{ color: textColors[kind] }} importantForAccessibility="no">
        {label}
      </AppText>
    </View>
  );
}
