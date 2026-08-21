import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { userMessageFor, type SafeErrorCode } from '@/core/errors';
import { AppText, Button, Notice, TextField } from '@/ui';
import { spacing } from '@/ui/tokens';

export interface MfaViewProps {
  verifying: boolean;
  notice?: SafeErrorCode;
  onSubmitCode: (code: string) => void;
  onSignOut: () => void;
}

const styles = StyleSheet.create({
  container: { gap: spacing.lg },
});

/** Second factor: six-digit TOTP from the authenticator app. Required for
 * staff roles before any scope binds (AAL2). */
export function MfaView({
  verifying,
  notice,
  onSubmitCode,
  onSignOut,
}: MfaViewProps): React.JSX.Element {
  const [code, setCode] = useState('');
  const trimmed = code.trim();
  return (
    <View style={styles.container}>
      <AppText variant="heading" accessibilityRole="header">
        Verify it is you
      </AppText>
      <AppText variant="body" tone="secondary">
        Enter the six-digit code from your authenticator app.
      </AppText>
      {notice ? <Notice tone="danger" title={userMessageFor(notice)} testID="mfa-notice" /> : null}
      <TextField
        label="Authenticator code"
        value={code}
        onChangeText={setCode}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        editable={!verifying}
        onSubmitEditing={() => trimmed.length > 0 && onSubmitCode(trimmed)}
        testID="mfa-code"
      />
      <Button
        label="Verify"
        onPress={() => onSubmitCode(trimmed)}
        disabled={trimmed.length === 0}
        loading={verifying}
        testID="mfa-submit"
      />
      <Button kind="secondary" label="Sign out" onPress={onSignOut} disabled={verifying} testID="mfa-sign-out" />
    </View>
  );
}
