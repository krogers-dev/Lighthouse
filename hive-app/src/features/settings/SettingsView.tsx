/** Account and access settings: sign out, identity/workspace switching,
 * and plain account-access information.
 *
 * Deliberately absent: an account-deletion control. It may not render until
 * its complete authorized backend, retention explanation, and public web
 * route exist — recorded in PRODUCT.md as a store-release dependency.
 */
import React from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { AppText, Button, useThemeColors } from '@/ui';
import { layout, spacing } from '@/ui/tokens';

export interface SettingsViewProps {
  email?: string;
  /** Configured support address (EXPO_PUBLIC_SUPPORT_EMAIL); absent until set. */
  supportEmail?: string;
  workspaceName?: string;
  canSwitchScope: boolean;
  signingOut: boolean;
  onSwitchScope: () => void;
  onSignOut: () => void;
  onBack: () => void;
}

const styles = StyleSheet.create({
  container: { gap: spacing.lg },
  heading: { gap: spacing.xs },
  section: {
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: layout.hairline,
  },
  actions: { gap: spacing.sm },
});

export function SettingsView({
  supportEmail,
  workspaceName,
  canSwitchScope,
  signingOut,
  onSwitchScope,
  onSignOut,
  onBack,
}: SettingsViewProps): React.JSX.Element {
  const colors = useThemeColors();
  return (
    <View style={styles.container}>
      <View style={styles.heading}>
        <AppText variant="title" accessibilityRole="header">
          Account
        </AppText>
        {workspaceName ? (
          <AppText
            variant="caption"
            tone="secondary"
          >{`Current workspace: ${workspaceName}`}</AppText>
        ) : null}
      </View>
      <View style={[styles.section, { borderTopColor: colors.divider }]}>
        <AppText variant="heading" accessibilityRole="header">
          Your access
        </AppText>
        <AppText variant="body">
          Access to HIVE is managed by Honeybee Accounting. To change who can see this workspace,
          contact your Honeybee team.
        </AppText>
      </View>
      <View style={styles.actions}>
        {supportEmail ? (
          <Button
            kind="secondary"
            label={`Email ${supportEmail}`}
            onPress={() => void Linking.openURL(`mailto:${supportEmail}`)}
            accessibilityHint="Opens your email app with a new message to your Honeybee team"
            disabled={signingOut}
            testID="settings-support-email"
          />
        ) : null}
        {canSwitchScope ? (
          <Button
            kind="secondary"
            label="Switch workspace"
            onPress={onSwitchScope}
            disabled={signingOut}
            testID="settings-switch-scope"
          />
        ) : null}
        <Button
          label="Sign out"
          onPress={onSignOut}
          loading={signingOut}
          accessibilityHint="Ends your session on this device"
          testID="settings-sign-out"
        />
        <Button
          kind="secondary"
          label="Back"
          onPress={onBack}
          disabled={signingOut}
          testID="settings-back"
        />
      </View>
    </View>
  );
}
