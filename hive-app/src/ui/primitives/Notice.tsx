import React from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from './AppText';
import { useThemeColors } from '../theme';
import { radii, spacing } from '../tokens';

export type NoticeTone = 'info' | 'success' | 'warning' | 'danger';

export interface NoticeProps {
  tone: NoticeTone;
  title: string;
  body?: string;
  testID?: string;
}

const TONE_WORD: Record<NoticeTone, string> = {
  info: 'Note',
  success: 'Done',
  warning: 'Warning',
  danger: 'Problem',
};

const styles = StyleSheet.create({
  notice: {
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.xs,
    borderLeftWidth: 4,
  },
});

export function Notice({ tone, title, body, testID }: NoticeProps): React.JSX.Element {
  const colors = useThemeColors();
  const background: Record<NoticeTone, string> = {
    info: colors.panelInfoBackground,
    success: colors.panelStableBackground,
    warning: colors.panelAttentionBackground,
    danger: colors.dangerPanelBackground,
  };
  const textColor: Record<NoticeTone, string> = {
    info: colors.panelInfoText,
    success: colors.panelStableText,
    warning: colors.panelAttentionText,
    danger: colors.dangerPanelText,
  };
  const urgent = tone === 'danger' || tone === 'warning';
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole={urgent ? 'alert' : undefined}
      accessibilityLabel={`${TONE_WORD[tone]}: ${title}${body ? `. ${body}` : ''}`}
      style={[styles.notice, { backgroundColor: background[tone], borderLeftColor: colors.accent }]}
    >
      <AppText variant="label" style={{ color: textColor[tone] }} importantForAccessibility="no">
        {`${TONE_WORD[tone]}: ${title}`}
      </AppText>
      {body ? (
        <AppText variant="body" style={{ color: textColor[tone] }} importantForAccessibility="no">
          {body}
        </AppText>
      ) : null}
    </View>
  );
}
