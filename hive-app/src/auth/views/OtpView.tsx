import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { userMessageFor, type SafeErrorCode } from '@/core/errors';
import { AppText, Button, Notice, TextField } from '@/ui';
import { spacing } from '@/ui/tokens';

export interface OtpViewProps {
  email: string;
  otpSent: boolean;
  verifying: boolean;
  notice?: SafeErrorCode;
  onSubmitCode: (code: string) => void;
  onResend: () => void;
  onCancel: () => void;
}

const styles = StyleSheet.create({
  container: { gap: spacing.lg },
  secondaryRow: { gap: spacing.sm },
});

export function OtpView({
  email,
  otpSent,
  verifying,
  notice,
  onSubmitCode,
  onResend,
  onCancel,
}: OtpViewProps): React.JSX.Element {
  const [code, setCode] = useState('');
  const trimmed = code.trim();
  return (
    <View style={styles.container}>
      <AppText variant="heading" accessibilityRole="header">
        Enter your sign-in code
      </AppText>
      <AppText variant="body" tone="secondary">
        {otpSent
          ? `We sent a one-time code to ${email}.`
          : `Requesting a one-time code for ${email}…`}
      </AppText>
      {notice ? <Notice tone="danger" title={userMessageFor(notice)} testID="otp-notice" /> : null}
      <TextField
        label="One-time code"
        value={code}
        onChangeText={setCode}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        editable={!verifying}
        onSubmitEditing={() => trimmed.length > 0 && onSubmitCode(trimmed)}
        testID="otp-code"
      />
      <Button
        label="Verify code"
        onPress={() => onSubmitCode(trimmed)}
        disabled={trimmed.length === 0 || !otpSent}
        loading={verifying}
        testID="otp-submit"
      />
      <View style={styles.secondaryRow}>
        <Button
          kind="secondary"
          label="Send a new code"
          onPress={onResend}
          disabled={verifying}
          testID="otp-resend"
        />
        <Button
          kind="secondary"
          label="Back"
          onPress={onCancel}
          disabled={verifying}
          testID="otp-cancel"
        />
      </View>
    </View>
  );
}
