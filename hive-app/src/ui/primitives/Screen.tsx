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
}

const styles = StyleSheet.create({
  outer: { flex: 1 },
  content: {
    flexGrow: 1,
    padding: spacing.md,
    width: '100%',
    // Readable measure on tablets without a separate layout system.
    maxWidth: 720,
    alignSelf: 'center',
  },
});

export function Screen({ children, scroll = true, testID }: ScreenProps): React.JSX.Element {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const padding = {
    paddingTop: insets.top + spacing.md,
    paddingBottom: insets.bottom + spacing.md,
    paddingLeft: insets.left + spacing.md,
    paddingRight: insets.right + spacing.md,
  };
  if (!scroll) {
    return (
      <View testID={testID} style={[styles.outer, { backgroundColor: colors.background }]}>
        <View style={[styles.content, padding]}>{children}</View>
      </View>
    );
  }
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
