/** The five labeled top-level destinations (PRODUCT.md: Home, Requests,
 * Activity, Help, Account — at most five, always labeled).
 *
 * Labels are persistent text, never icon-only: an icon row is unusable
 * with a screen reader unless every icon carries a label anyway, and it
 * reads as a generic finance app rather than a calm working view. The
 * current destination is marked by an accessibility state AND a filled
 * Honey Gold pill with Soft Black text on the Deep Black bar — a change of
 * shape and value that survives greyscale, never color alone (WCAG 1.4.1).
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/ui';
import { appChrome, layout, radii, spacing, touchTarget } from '@/ui/tokens';

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
    // At large text the five labels wrap into a second row rather than
    // truncating; the bar grows and the content above it scrolls.
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  item: {
    minHeight: touchTarget.minHeight,
    minWidth: touchTarget.minWidth,
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
  },
  focused: {
    outlineStyle: 'solid',
    outlineWidth: layout.focusRingWidth,
    outlineOffset: layout.focusRingOffset,
    outlineColor: appChrome.focusRing,
  },
});

export function PrimaryNav({ current, onNavigate }: PrimaryNavProps): React.JSX.Element {
  const [focusedId, setFocusedId] = useState<NavDestination | null>(null);
  return (
    <View style={styles.bar} accessibilityRole="tablist" testID="primary-nav">
      {DESTINATIONS.map((destination) => {
        const isCurrent = destination.id === current;
        return (
          <Pressable
            key={destination.id}
            onPress={() => onNavigate(destination.id)}
            onFocus={() => setFocusedId(destination.id)}
            onBlur={() => setFocusedId((id) => (id === destination.id ? null : id))}
            accessibilityRole="tab"
            accessibilityState={{ selected: isCurrent }}
            accessibilityLabel={destination.label}
            testID={destination.testID}
            style={({ pressed }) => [
              styles.item,
              {
                backgroundColor: isCurrent ? appChrome.selectedBackground : 'transparent',
                opacity: pressed ? 0.85 : 1,
              },
              focusedId === destination.id && styles.focused,
            ]}
          >
            <AppText
              variant="nav"
              style={{ color: isCurrent ? appChrome.selectedText : appChrome.secondaryText }}
            >
              {destination.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}
