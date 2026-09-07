import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { MembershipId } from '@/core/ids';
import { AppText, Button, useThemeColors } from '@/ui';
import { radii, spacing, touchTarget } from '@/ui/tokens';

import type { Membership } from '../types';

export interface ScopeChooserViewProps {
  memberships: readonly Membership[];
  onSelect: (membershipId: MembershipId) => void;
  onSignOut: () => void;
}

const styles = StyleSheet.create({
  container: { gap: spacing.lg },
  list: { gap: spacing.sm },
  option: {
    minHeight: touchTarget.minHeight,
    borderWidth: 2,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
});

const ROLE_LABEL: Record<Membership['role'], string> = {
  client_user: 'Client access',
  intake: 'Intake',
  preparer: 'Preparer',
  reviewer: 'Reviewer (read-only)',
  approver: 'Approver',
};

/** Most clients are one business with one legal entity under the same
 * name; showing (and reading aloud) that name twice per row helped no one
 * (2026-09-07 wording review). The client name appears only when it
 * differs from the entity name. */
export function chooserLabel(membership: Membership): string {
  const role = ROLE_LABEL[membership.role];
  return membership.clientName === membership.entityName
    ? `${membership.entityName}, ${role}`
    : `${membership.clientName}, ${membership.entityName}, ${role}`;
}

export function chooserDetail(membership: Membership): string {
  const role = ROLE_LABEL[membership.role];
  return membership.clientName === membership.entityName
    ? role
    : `${membership.clientName} · ${role}`;
}

/** Explicit client/entity selection, required whenever more than one
 * server-confirmed membership exists. Selection is by membership id from
 * this list only — never from a route param or deep link. */
export function ScopeChooserView({
  memberships,
  onSelect,
  onSignOut,
}: ScopeChooserViewProps): React.JSX.Element {
  const colors = useThemeColors();
  return (
    <View style={styles.container}>
      <AppText variant="heading" accessibilityRole="header">
        Choose a workspace
      </AppText>
      <AppText variant="body" tone="secondary">
        You have access to more than one workspace. Choose where to work; you can switch at any time
        from Account.
      </AppText>
      <View style={styles.list} accessibilityRole="radiogroup">
        {memberships.map((membership) => (
          <Pressable
            key={membership.membershipId}
            accessibilityRole="radio"
            accessibilityLabel={chooserLabel(membership)}
            onPress={() => onSelect(membership.membershipId)}
            style={({ pressed }) => [
              styles.option,
              {
                borderColor: colors.border,
                backgroundColor: colors.surface,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
            testID={`scope-option-${membership.membershipId}`}
          >
            <AppText variant="label" importantForAccessibility="no">
              {membership.entityName}
            </AppText>
            <AppText variant="caption" tone="secondary" importantForAccessibility="no">
              {chooserDetail(membership)}
            </AppText>
          </Pressable>
        ))}
      </View>
      <Button kind="secondary" label="Sign out" onPress={onSignOut} testID="scope-sign-out" />
    </View>
  );
}
