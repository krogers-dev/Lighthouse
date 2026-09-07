import React, { useCallback, useEffect, useState } from 'react';
import {
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type KeyboardEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandHeader } from './BrandHeader';
import { useThemeColors } from '../theme';
import { appChrome, layout, spacing } from '../tokens';

/** How much bottom padding the content container needs so that nothing in it
 * is hidden under the soft keyboard (find 49).
 *
 * Under Android edge-to-edge (this app targets Android 15) the window is NOT
 * resized for the keyboard: React Native's root view only reports the
 * keyboard through an event, and the `screenY` in that event is taken from
 * the "visible display frame" on the assumption that the window shrank —
 * which it did not, so `KeyboardAvoidingView` computed a zero overlap on the
 * device while the verify control sat under the keyboard (desktop 2,
 * 2026-09-07, run 7). The reported HEIGHT is right, so the room is computed
 * from it: the keyboard's top edge is the window's bottom minus that height
 * (minus the navigation-bar inset on Android, which the height excludes),
 * and the room is the part of this container that lies below that edge.
 * On a platform that does resize the window, the container's measured
 * bottom already sits at the keyboard's top and the room is zero. */
export function keyboardRoomFor({
  containerBottom,
  windowHeight,
  keyboardHeight,
  bottomInset,
  platform,
}: {
  /** The container's bottom edge in window coordinates (the shell's outer
   * view sits at the window origin, so a layout relative to it is that). */
  containerBottom: number | null;
  windowHeight: number;
  keyboardHeight: number;
  bottomInset: number;
  platform: typeof Platform.OS;
}): number {
  if (containerBottom === null || keyboardHeight <= 0) return 0;
  const keyboardTop = windowHeight - keyboardHeight - (platform === 'android' ? bottomInset : 0);
  return Math.max(0, Math.round(containerBottom - keyboardTop));
}

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
  const { width, height: windowHeight } = useWindowDimensions();
  const gutter = width < layout.compactWidth ? layout.compactGutter : layout.screenGutter;
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [containerBottom, setContainerBottom] = useState<number | null>(null);
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, (event: KeyboardEvent) =>
      setKeyboardHeight(event.endCoordinates.height),
    );
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const onContainerLayout = useCallback((event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    setContainerBottom(y + height);
  }, []);
  const keyboardRoom = keyboardRoomFor({
    containerBottom,
    windowHeight,
    keyboardHeight,
    bottomInset: insets.bottom,
    platform: Platform.OS,
  });
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
      {/* The content makes room for the soft keyboard itself (find 49; see
          keyboardRoomFor above): the container measures where it ends and
          pads its bottom by the part of it the keyboard covers, so the
          scroll view shrinks to the keyboard's top edge and any control can
          be scrolled above it. */}
      <View
        style={[styles.scroller, { paddingBottom: keyboardRoom }]}
        onLayout={onContainerLayout}
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
      </View>
      {footerBand}
    </View>
  );
}
