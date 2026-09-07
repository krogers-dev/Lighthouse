import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { userMessageFor, type SafeErrorCode } from '@/core/errors';
import { AppText, Button, Notice, TextField } from '@/ui';
import { spacing } from '@/ui/tokens';

export interface SignInViewProps {
  onSubmitEmail: (email: string) => void;
  busy: boolean;
  notice?: SafeErrorCode;
  /** Why the previous session ended, when relevant. */
  signedOutReason?: 'expired' | 'scrubbed' | 'no_access' | 'offline';
}

const styles = StyleSheet.create({
  container: { gap: spacing.lg },
  heading: { gap: spacing.sm },
});

const REASON_COPY: Record<NonNullable<SignInViewProps['signedOutReason']>, string> = {
  expired: 'Your session ended. Sign in again to continue.',
  scrubbed: 'Sign-in on this device was reset. Sign in again to continue.',
  no_access: 'This account has no workspace access yet. Contact your Honeybee team.',
  offline: 'HIVE could not verify your access. Reconnect and sign in to continue.',
};

/** Invite-only entry: an email receives a sign-in code only if it was
 * authorized in advance. Self-registration does not exist.
 *
 * The HIVE lockup lives on the header band above this view, so the screen
 * title greets rather than repeats the name (HIVE 2026 design; one line
 * Stacie can change). The instructions below it are the authorized-email
 * wording decided in the 2026-09-07 review. */
export function SignInView({
  onSubmitEmail,
  busy,
  notice,
  signedOutReason,
}: SignInViewProps): React.JSX.Element {
  const [email, setEmail] = useState('');
  const trimmed = email.trim();
  return (
    <View style={styles.container}>
      <View style={styles.heading}>
        <AppText variant="title" accessibilityRole="header">
          Welcome to HIVE
        </AppText>
        <AppText variant="body" tone="secondary">
          Sign in with your authorized email. We will send a sign-in code.
        </AppText>
      </View>
      {signedOutReason ? (
        <Notice tone="info" title={REASON_COPY[signedOutReason]} testID="signed-out-reason" />
      ) : null}
      {notice ? (
        <Notice tone="danger" title={userMessageFor(notice)} testID="sign-in-notice" />
      ) : null}
      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoComplete="email"
        placeholder="you@yourbusiness.com"
        editable={!busy}
        onSubmitEditing={() => trimmed.length > 0 && onSubmitEmail(trimmed)}
        testID="sign-in-email"
      />
      <Button
        label="Send code"
        onPress={() => onSubmitEmail(trimmed)}
        disabled={trimmed.length === 0}
        loading={busy}
        accessibilityHint="Sends a sign-in code to this email"
        testID="sign-in-submit"
      />
    </View>
  );
}
