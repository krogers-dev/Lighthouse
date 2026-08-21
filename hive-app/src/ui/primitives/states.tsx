/** The explicit screen states every feature must be able to show:
 * loading, empty, error, offline, and storage quarantine. */
import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText } from './AppText';
import { Button } from './Button';
import { useThemeColors } from '../theme';
import { spacing } from '../tokens';
import type { SafeError } from '@/core/errors';

const styles = StyleSheet.create({
  block: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.md,
  },
});

interface StateBlockProps {
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  live?: boolean;
  leading?: React.ReactNode;
  testID?: string;
}

function StateBlock({
  title,
  body,
  actionLabel,
  onAction,
  live = false,
  leading,
  testID,
}: StateBlockProps): React.JSX.Element {
  return (
    <View
      style={styles.block}
      testID={testID}
      accessibilityLiveRegion={live ? 'polite' : 'none'}
    >
      {leading}
      <AppText variant="heading" align="center">
        {title}
      </AppText>
      {body ? (
        <AppText variant="body" tone="secondary" align="center">
          {body}
        </AppText>
      ) : null}
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} /> : null}
    </View>
  );
}

export function LoadingState({
  label = 'Loading',
  testID,
}: {
  label?: string;
  testID?: string;
}): React.JSX.Element {
  const colors = useThemeColors();
  return (
    <StateBlock
      title={label}
      live
      testID={testID}
      leading={<ActivityIndicator size="large" color={colors.textPrimary} />}
    />
  );
}

export function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
  testID,
}: {
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
}): React.JSX.Element {
  return (
    <StateBlock title={title} body={body} actionLabel={actionLabel} onAction={onAction} testID={testID} />
  );
}

export function ErrorState({
  error,
  onRetry,
  testID,
}: {
  error: SafeError;
  /** Provide only when a retry cannot widen access (read-only refetch). */
  onRetry?: () => void;
  testID?: string;
}): React.JSX.Element {
  return (
    <StateBlock
      title="Something needs another look"
      body={error.userMessage}
      actionLabel={onRetry ? 'Try again' : undefined}
      onAction={onRetry}
      live
      testID={testID}
    />
  );
}

export function OfflineState({
  onRetry,
  testID,
}: {
  onRetry?: () => void;
  testID?: string;
}): React.JSX.Element {
  return (
    <StateBlock
      title="You are offline"
      body="HIVE needs a connection to show current, verified information. Nothing is shown from stale copies."
      actionLabel={onRetry ? 'Check connection' : undefined}
      onAction={onRetry}
      live
      testID={testID}
    />
  );
}

export function QuarantineState({
  onScrub,
  scrubInProgress = false,
  lastAttemptFailed = false,
  testID,
}: {
  /** The only exit: verified scrub of secure sign-in data. Never a session retry. */
  onScrub: () => void;
  scrubInProgress?: boolean;
  lastAttemptFailed?: boolean;
  testID?: string;
}): React.JSX.Element {
  return (
    <View testID={testID}>
      <StateBlock
        title="Secure sign-in data needs a reset"
        body={
          lastAttemptFailed
            ? 'The reset did not complete. Your records are safe on the server. Try the reset again.'
            : 'Sign-in data stored on this device could not be verified, so HIVE will not use it. Your records are safe on the server. Reset secure sign-in data, then sign in again.'
        }
        actionLabel={scrubInProgress ? undefined : 'Reset secure sign-in data'}
        onAction={scrubInProgress ? undefined : onScrub}
        live
      />
      {scrubInProgress ? <LoadingState label="Resetting secure sign-in data" /> : null}
    </View>
  );
}
