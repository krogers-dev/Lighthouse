import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { getRuntime } from '@/app-runtime';
import { AuthProvider } from '@/auth/provider';
import { AppText, Notice, Screen } from '@/ui';

/** Sanitized application error boundary. Unexpected failures map to a
 * fatal presentation with no internals and no session retry; recovery is
 * closing and reopening the app, which boots through the full verified
 * sequence. */
export function ErrorBoundary(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <Screen testID="fatal-boundary">
        <AppText variant="title" accessibilityRole="header">
          HIVE
        </AppText>
        <Notice
          tone="danger"
          title="Something went wrong"
          body="HIVE hit an unexpected problem and stopped to keep your information safe. Close the app fully and open it again."
        />
      </Screen>
    </SafeAreaProvider>
  );
}

function ConfigurationFatal({ problems }: { problems: readonly string[] }): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <Screen testID="config-fatal">
        <AppText variant="title" accessibilityRole="header">
          HIVE
        </AppText>
        <Notice
          tone="danger"
          title="This build is not configured"
          body="Required public configuration is missing or invalid, so HIVE will not start."
        />
        {problems.map((problem) => (
          <AppText key={problem} variant="caption" tone="secondary">
            {problem}
          </AppText>
        ))}
      </Screen>
    </SafeAreaProvider>
  );
}

export default function RootLayout(): React.JSX.Element {
  const runtime = getRuntime();
  if (!runtime.ok) {
    return <ConfigurationFatal problems={runtime.problems} />;
  }
  return (
    <SafeAreaProvider>
      <AuthProvider controller={runtime.services.controller}>
        <StatusBar style="auto" />
        {/* Frequent navigation is not animated (motion contract). */}
        <Stack screenOptions={{ headerShown: false, animation: 'none' }} />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
