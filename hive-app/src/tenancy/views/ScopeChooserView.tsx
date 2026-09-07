import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { MembershipId } from '@/core/ids';
import { AppText, Button, useThemeColors } from '@/ui';
import { layout, spacing } from '@/ui/tokens';

import type { Membership } from '../types';

export interface ScopeChooserViewProps {
  memberships: readonly Membership[];
  onSelect: (membershipId: MembershipId) => void;
  onSignOut: () => void;
}

const styles = StyleSheet.create({
  container: { gap: spacing.lg },
  heading: { gap: spacing.sm },
  list: {},
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: layout.controlMinHeight,
    paddingVertical: spacing.md,
    borderTopWidth: layout.hairline,
  },
  optionBody: { flex: 1, gap: spacing.xs },
  focused: {
    outlineStyle: 'solid',
    outlineWidth: layout.focusRingWidth,
    outlineOffset: layout.focusRingOffset,
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

function WorkspaceOption({
  membership,
  onSelect,
}: {
  membership: Membership;
  onSelect: () => void;
}): React.JSX.Element {
  const colors = useThemeColors();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={chooserLabel(membership)}
      onPress={onSelect}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.option,
        { borderTopColor: colors.divider, opacity: pressed ? 0.85 : 1 },
        focused && [styles.focused, { outlineColor: colors.focusRing }],
      ]}
      testID={`scope-option-${membership.membershipId}`}
    >
      <View style={styles.optionBody}>
        <AppText variant="bodyStrong" importantForAccessibility="no">
          {membership.entityName}
        </AppText>
        <AppText variant="caption" tone="secondary" importantForAccessibility="no">
          {chooserDetail(membership)}
        </AppText>
      </View>
      <AppText variant="heading" tone="secondary" importantForAccessibility="no">
        ›
      </AppText>
    </Pressable>
  );
}

/** Explicit client/entity selection, required whenever more than one
 * server-confirmed membership exists. Selection is by membership id from
 * this list only — never from a route param or deep link. */
export function ScopeChooserView({
  memberships,
  onSelect,
  onSignOut,
}: ScopeChooserViewProps): React.JSX.Element {
  return (
    <View style={styles.container}>
      <View style={styles.heading}>
        <AppText variant="title" accessibilityRole="header">
          Choose a workspace
        </AppText>
        <AppText variant="body" tone="secondary">
          You have access to more than one workspace. Choose where to work; you can switch at any
          time from Account.
        </AppText>
      </View>
      <View style={styles.list} accessibilityRole="radiogroup">
        {memberships.map((membership) => (
          <WorkspaceOption
            key={membership.membershipId}
            membership={membership}
            onSelect={() => onSelect(membership.membershipId)}
          />
        ))}
      </View>
      <Button kind="secondary" label="Sign out" onPress={onSignOut} testID="scope-sign-out" />
    </View>
  );
}
