/** Account and access settings: sign out, identity/workspace switching,
 * and plain account-access information.
 *
 * Deliberately absent: an account-deletion control. It may not render until
 * its complete authorized backend, retention explanation, and public web
 * route exist — recorded in PRODUCT.md as a store-release dependency.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Notice } from '@/ui';
import { spacing } from '@/ui/tokens';

export interface SettingsViewProps {
  email?: string;
  workspaceName?: string;
  canSwitchScope: boolean;
  signingOut: boolean;
  onSwitchScope: () => void;
  onSignOut: () => void;
  onBack: () => void;
}

const styles = StyleSheet.create({
  container: { gap: spacing.lg },
});

export function SettingsView({
  workspaceName,
  canSwitchScope,
  signingOut,
  onSwitchScope,
  onSignOut,
  onBack,
}: SettingsViewProps): React.JSX.Element {
  return (
    <View style={styles.container}>
      <AppText variant="title" accessibilityRole="header">
        Account
      </AppText>
      {workspaceName ? (
        <AppText variant="body" tone="secondary">{`Current workspace: ${workspaceName}`}</AppText>
      ) : null}
      <Notice
        tone="info"
        title="Your access"
        body="Access to HIVE is managed by Honeybee Accounting. To change who can see this workspace, contact your Honeybee team."
      />
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
  );
}
