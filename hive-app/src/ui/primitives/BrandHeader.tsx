/** The HIVE lockup on the fixed Deep Black header band: the approved
 * honeycomb mark beside the wordmark and "by Honeybee Accounting".
 *
 * The mark is the exact approved 512 × 460 transparent asset, rendered on
 * the chrome at its natural aspect ratio with no backing shape, tile,
 * border, or shadow. It is decorative beside the wordmark, so assistive
 * technology reads the words and skips the image. If the image ever fails
 * to load, the lockup simply reads "HIVE / by Honeybee Accounting" — a
 * bounded text fallback that touches nothing else.
 */
import React, { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import mark from '../../../assets/brand/hive-mark-primary-512.png';

import { AppText } from './AppText';
import { appChrome, spacing } from '../tokens';

/** Width over height of the approved artwork. */
export const HIVE_MARK_ASPECT = 512 / 460;
/** Rendered width of the mark in the lockup; height follows the ratio. */
export const HIVE_MARK_WIDTH = 46;

export function markHeightFor(width: number): number {
  return Math.round(width / HIVE_MARK_ASPECT);
}

export interface BrandHeaderProps {
  testID?: string;
}

const styles = StyleSheet.create({
  lockup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.lg - spacing.xs,
  },
  words: {
    flexShrink: 1,
  },
  mark: {
    width: HIVE_MARK_WIDTH,
    height: markHeightFor(HIVE_MARK_WIDTH),
  },
});

export function BrandHeader({ testID = 'brand-header' }: BrandHeaderProps): React.JSX.Element {
  const [imageFailed, setImageFailed] = useState(false);
  return (
    <View style={styles.lockup} testID={testID}>
      {imageFailed ? null : (
        <Image
          source={mark}
          style={styles.mark}
          resizeMode="contain"
          accessible={false}
          importantForAccessibility="no"
          accessibilityElementsHidden
          onError={() => setImageFailed(true)}
          testID="brand-mark"
        />
      )}
      <View style={styles.words}>
        <AppText variant="wordmark" style={{ color: appChrome.text }} testID="brand-wordmark">
          HIVE
        </AppText>
        <AppText variant="tagline" style={{ color: appChrome.secondaryText }}>
          by Honeybee Accounting
        </AppText>
      </View>
    </View>
  );
}
