import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { Linking } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { getRuntime } from '@/app-runtime';
import { AuthProvider } from '@/auth/provider';
import { AppText, Notice, Screen } from '@/ui';

/** Development-only QA hook (RETURN-2 area 7; RETURN-3 area 8): a QA
 * build (dev build with EXPO_PUBLIC_QA_HOOKS=1) corrupts the stored
 * session on the exact deep link hivedev://qa/corrupt-storage so the
 * quarantine device flow is executable, and returns true once the
 * corruption write has COMPLETED so Maestro can wait for the on-screen
 * acknowledgment before stopping the app. The `__DEV__` guard means
 * release bundles drop the entire block (Metro dead-code elimination);
 * bundle:inspect proves the marker string is absent from non-development
 * exports and config:check rejects the env flag for candidate/release
 * profiles. */
function useDevQaHooks(): boolean {
  const [corrupted, setCorrupted] = React.useState(false);
  React.useEffect(() => {
    if (!(__DEV__ && process.env.EXPO_PUBLIC_QA_HOOKS === '1')) return undefined;
    /* eslint-disable @typescript-eslint/no-require-imports */
    const qa = require('@/dev/qa-corrupt-storage') as typeof import('@/dev/qa-corrupt-storage');
    const secureStore = require('expo-secure-store') as typeof import('expo-secure-store');
    /* eslint-enable @typescript-eslint/no-require-imports */
    const backend = {
      getItem: (key: string) => secureStore.getItemAsync(key),
      setItem: (key: string, value: string) => secureStore.setItemAsync(key, value),
      deleteItem: (key: string) => secureStore.deleteItemAsync(key),
    };
    const handle = (url: string | null): void => {
      if (url && qa.isQaCorruptUrl(url)) {
        void qa.corruptStoredSessionForQa(backend).then(() => setCorrupted(true));
      }
    };
    void Linking.getInitialURL().then(handle);
    const subscription = Linking.addEventListener('url', (event) => handle(event.url));
    return () => subscription.remove();
  }, []);
  return corrupted;
}

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
  const qaCorrupted = useDevQaHooks();
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
        {/* QA-only completion acknowledgment (RETURN-3 area 8): rendered
            only in QA dev builds after the corruption write completes, so
            the Maestro flow waits for it before stopping the app. The
            whole expression is dead code in release bundles (__DEV__). */}
        {__DEV__ && process.env.EXPO_PUBLIC_QA_HOOKS === '1' && qaCorrupted ? (
          <AppText variant="caption" testID="qa-corrupt-ack" accessibilityLabel="QA acknowledgment">
            QA: stored session corrupted
          </AppText>
        ) : null}
      </AuthProvider>
    </SafeAreaProvider>
  );
}
