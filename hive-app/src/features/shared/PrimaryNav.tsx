/** The five labeled top-level destinations (PRODUCT.md: Home, Requests,
 * Activity, Help, Account — at most five, always labeled).
 *
 * Labels are persistent text, never icon-only: an icon row is unusable
 * with a screen reader unless every icon carries a label anyway, and it
 * reads as a generic finance app rather than a calm working view. The
 * current destination is marked by an accessibility state AND a visible
 * underline, never by color alone (WCAG 1.4.1).
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, useThemeColors } from '@/ui';
import { spacing } from '@/ui/tokens';

export type NavDestination = 'home' | 'requests' | 'activity' | 'help' | 'account';

/** testIDs are written out as literals rather than built from the id, so
 * they are greppable: maestro:validate proves every flow selector matches
 * a testID that actually exists in the sources, and a template literal
 * would defeat that check. */
const DESTINATIONS: readonly { id: NavDestination; label: string; testID: string }[] = [
  { id: 'home', label: 'Home', testID: 'nav-home' },
  { id: 'requests', label: 'Requests', testID: 'nav-requests' },
  { id: 'activity', label: 'Activity', testID: 'nav-activity' },
  { id: 'help', label: 'Help', testID: 'nav-help' },
  { id: 'account', label: 'Account', testID: 'nav-account' },
];

export interface PrimaryNavProps {
  current: NavDestination;
  onNavigate: (destination: NavDestination) => void;
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
  },
  item: {
    // 44pt iOS / 48dp Android minimum target.
    minHeight: 48,
    minWidth: 48,
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 2,
  },
});

export function PrimaryNav({ current, onNavigate }: PrimaryNavProps): React.JSX.Element {
  const colors = useThemeColors();
  return (
    <View
      style={[styles.bar, { borderTopColor: colors.divider }]}
      accessibilityRole="tablist"
      testID="primary-nav"
    >
      {DESTINATIONS.map((destination) => {
        const isCurrent = destination.id === current;
        return (
          <Pressable
            key={destination.id}
            onPress={() => onNavigate(destination.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: isCurrent }}
            accessibilityLabel={destination.label}
            testID={destination.testID}
            style={({ pressed }) => [
              styles.item,
              {
                // The underline carries the current state visually, so it
                // survives greyscale and high-contrast modes.
                borderBottomColor: isCurrent ? colors.accent : 'transparent',
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <AppText variant="label" tone={isCurrent ? 'primary' : 'secondary'}>
              {destination.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}
