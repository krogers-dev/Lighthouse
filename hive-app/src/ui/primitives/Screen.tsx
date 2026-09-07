import React from 'react';
import {
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandHeader } from './BrandHeader';
import { useThemeColors } from '../theme';
import { appChrome, layout, spacing } from '../tokens';

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
  /** Chrome pinned ABOVE the scroll area on the Deep Black band. Every
   * screen carries the HIVE lockup unless it explicitly passes null. */
  header?: React.ReactNode | null;
}

const styles = StyleSheet.create({
  outer: { flex: 1 },
  scroller: { flex: 1 },
  /** The chrome bands span the full window; their content keeps the same
   * readable measure as the column they frame. */
  chrome: {
    width: '100%',
    backgroundColor: appChrome.background,
  },
  chromeInner: {
    width: '100%',
    maxWidth: layout.contentMaxWidth,
    alignSelf: 'center',
  },
  content: {
    flexGrow: 1,
    width: '100%',
    // Readable measure on tablets without a separate layout system; the
    // canvas shows either side of the column.
    maxWidth: layout.contentMaxWidth,
    alignSelf: 'center',
  },
});

export function Screen({
  children,
  scroll = true,
  testID,
  footer,
  header = <BrandHeader />,
}: ScreenProps): React.JSX.Element {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const gutter = width < layout.compactWidth ? layout.compactGutter : layout.screenGutter;
  // The header band owns the top inset and the footer band the bottom
  // one, so the column reserves neither twice.
  const padding = {
    paddingTop: header ? spacing.lg : insets.top + spacing.lg,
    paddingBottom: footer ? spacing.lg : insets.bottom + spacing.lg,
    paddingLeft: insets.left + gutter,
    paddingRight: insets.right + gutter,
  };
  const headerPadding = {
    paddingTop: insets.top,
    paddingLeft: insets.left + gutter,
    paddingRight: insets.right + gutter,
  };
  const footerPadding = {
    paddingBottom: insets.bottom,
    paddingLeft: insets.left + gutter,
    paddingRight: insets.right + gutter,
  };
  const column = [styles.content, padding, { backgroundColor: colors.background }];
  const headerBand = header ? (
    <View style={[styles.chrome, headerPadding]}>
      <View style={styles.chromeInner}>{header}</View>
    </View>
  ) : null;
  const footerBand = footer ? (
    <View style={[styles.chrome, footerPadding]}>
      <View style={styles.chromeInner}>{footer}</View>
    </View>
  ) : null;
  return (
    <View testID={testID} style={[styles.outer, { backgroundColor: colors.canvas }]}>
      {headerBand}
      {/* The content makes room for the soft keyboard itself. Under Android
          edge-to-edge (this app targets Android 15) the window is NOT resized
          for the keyboard: React Native's root view only reports the
          keyboard's height, so without this a long screen's controls below
          the focused field stay under the keyboard at maximum scroll and
          cannot be reached — the enrollment screen's verify control was
          exactly that (find 49, 2026-09-07). The padding is the measured
          overlap between this container and the keyboard, so on a platform
          that does resize the window it is zero and never doubles. */}
      <KeyboardAvoidingView
        behavior="padding"
        style={styles.scroller}
        testID="screen-keyboard-room"
      >
        {scroll ? (
          <ScrollView
            style={styles.scroller}
            contentContainerStyle={column}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.scroller, ...column]}>{children}</View>
        )}
      </KeyboardAvoidingView>
      {footerBand}
    </View>
  );
}
