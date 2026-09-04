import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useThemeColors } from '../theme';
import { spacing } from '../tokens';

export interface ScreenProps {
  children: React.ReactNode;
  /** Scrollable by default so 200% text and landscape never clip content. */
  scroll?: boolean;
  testID?: string;
  /** Chrome pinned BELOW the scroll area rather than scrolling with the
   * content. The nav used to be an ordinary child, so on any screen taller
   * than the viewport it scrolled out of view — on Help, at default text
   * size, it was off screen entirely, and at 200% text every screen is a
   * long screen (find 18, 2026-09-03). "Persistent labels" cannot mean
   * "labels you can scroll away from". */
  footer?: React.ReactNode;
}

const styles = StyleSheet.create({
  outer: { flex: 1 },
  scroller: { flex: 1 },
  content: {
    flexGrow: 1,
    padding: spacing.md,
    width: '100%',
    // Readable measure on tablets without a separate layout system.
    maxWidth: 720,
    alignSelf: 'center',
  },
  footer: {
    width: '100%',
    // The pinned chrome keeps the content's readable measure so the nav
    // lines up with what it navigates.
    maxWidth: 720,
    alignSelf: 'center',
  },
});

export function Screen({
  children,
  scroll = true,
  testID,
  footer,
}: ScreenProps): React.JSX.Element {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  // With pinned chrome the footer owns the bottom safe area, so the scroll
  // content stops short of it instead of reserving the inset twice.
  const padding = {
    paddingTop: insets.top + spacing.md,
    paddingBottom: footer ? spacing.md : insets.bottom + spacing.md,
    paddingLeft: insets.left + spacing.md,
    paddingRight: insets.right + spacing.md,
  };
  const footerPadding = {
    paddingBottom: insets.bottom + spacing.md,
    paddingLeft: insets.left + spacing.md,
    paddingRight: insets.right + spacing.md,
  };
  if (!scroll) {
    return (
      <View testID={testID} style={[styles.outer, { backgroundColor: colors.background }]}>
        <View style={[styles.content, padding]}>{children}</View>
        {footer ? <View style={[styles.footer, footerPadding]}>{footer}</View> : null}
      </View>
    );
  }
  if (!footer) {
    return (
      <ScrollView
        testID={testID}
        style={[styles.outer, { backgroundColor: colors.background }]}
        contentContainerStyle={[styles.content, padding]}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    );
  }
  return (
    <View testID={testID} style={[styles.outer, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.scroller}
        contentContainerStyle={[styles.content, padding]}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
      <View style={[styles.footer, footerPadding]}>{footer}</View>
    </View>
  );
}
