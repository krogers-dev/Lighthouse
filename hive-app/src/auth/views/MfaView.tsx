import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SvgXml } from 'react-native-svg';

import type { TotpEnrollment } from '@/auth/client-lifecycle';
import { userMessageFor, type SafeErrorCode } from '@/core/errors';
import { AppText, Button, Notice, TextField, useThemeColors } from '@/ui';
import { radii, spacing } from '@/ui/tokens';

export interface MfaViewProps {
  verifying: boolean;
  notice?: SafeErrorCode;
  /** Present only for first-time setup; secret/QR are memory-only and are
   * never persisted, logged, or included in diagnostics or screenshots. */
  enrollment?: TotpEnrollment;
  onSubmitCode: (code: string) => void;
  onRetrySetup: () => void;
  onSignOut: () => void;
}

const styles = StyleSheet.create({
  container: { gap: spacing.lg },
  qrBox: {
    alignSelf: 'center',
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 2,
  },
  secretBox: {
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
  },
});

/** Second factor: six-digit TOTP. First-time staff sign-in enrolls the
 * authenticator here (QR plus manual secret), then verifies; later
 * sign-ins verify against the existing factor. AAL2 is required for staff
 * before any scope binds. */
export function MfaView({
  verifying,
  notice,
  enrollment,
  onSubmitCode,
  onRetrySetup,
  onSignOut,
}: MfaViewProps): React.JSX.Element {
  const colors = useThemeColors();
  const [code, setCode] = useState('');
  const trimmed = code.trim();
  const enrolling = Boolean(enrollment);
  return (
    <View style={styles.container}>
      <AppText variant="heading" accessibilityRole="header">
        {enrolling ? 'Set up your authenticator' : 'Verify it is you'}
      </AppText>
      <AppText variant="body" tone="secondary">
        {enrolling
          ? 'Scan the QR code with your authenticator app, or enter the setup key manually. Then enter the six-digit code it shows.'
          : 'Enter the six-digit code from your authenticator app.'}
      </AppText>
      {notice ? (
        <>
          <Notice tone="danger" title={userMessageFor(notice)} testID="mfa-notice" />
          {!enrolling ? (
            <Button
              kind="secondary"
              label="Try setup again"
              onPress={onRetrySetup}
              disabled={verifying}
              testID="mfa-retry-setup"
            />
          ) : null}
        </>
      ) : null}
      {enrollment?.qrSvg ? (
        <View
          style={[styles.qrBox, { borderColor: colors.border, backgroundColor: colors.surface }]}
          accessible
          accessibilityLabel="Authenticator setup QR code. If you cannot scan it, use the setup key below."
          testID="mfa-enroll-qr"
        >
          <SvgXml xml={enrollment.qrSvg} width={180} height={180} />
        </View>
      ) : null}
      {enrollment ? (
        <View
          style={[
            styles.secretBox,
            { borderColor: colors.border, backgroundColor: colors.surface },
          ]}
        >
          <AppText variant="label">Setup key</AppText>
          <AppText variant="body" testID="mfa-enroll-secret" accessibilityLabel="Setup key">
            {enrollment.secret}
          </AppText>
          <AppText variant="caption" tone="secondary">
            Enter this key in your authenticator app if you cannot scan the code. Keep it private;
            HIVE never stores or shows it again.
          </AppText>
        </View>
      ) : null}
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
        label={enrolling ? 'Verify and finish setup' : 'Verify'}
        onPress={() => onSubmitCode(trimmed)}
        disabled={trimmed.length === 0}
        loading={verifying}
        testID="mfa-submit"
      />
      <Button
        kind="secondary"
        label="Sign out"
        onPress={onSignOut}
        disabled={verifying}
        testID="mfa-sign-out"
      />
    </View>
  );
}
