import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { Linking } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { getRuntime } from '@/app-runtime';
import { AuthProvider } from '@/auth/provider';
import { AppText, Notice, Screen } from '@/ui';

interface QaHookState {
  /** The corruption write completed (-> storage_quarantined next boot). */
  corrupted: boolean;
  /** The expiry write completed (-> signed_out, reason 'expired', find 20). */
  expired: boolean;
}

/** Development-only QA hooks (RETURN-2 area 7; RETURN-3 area 8; find 20): a
 * QA build (dev build with EXPO_PUBLIC_QA_HOOKS=1) acts on two exact deep
 * links so two otherwise unreachable device states become executable —
 *   hivedev:///?qa=corrupt-storage  -> corrupt the stored session so the
 *                                      next boot quarantines;
 *   hivedev:///?qa=expire-session   -> expire the stored session so the
 *                                      next boot signs out with the
 *                                      "session ended" reason.
 * Each returns its flag once the write has COMPLETED, so Maestro can wait
 * for the on-screen acknowledgment before stopping the app. The `__DEV__`
 * guard drops the entire block from release bundles (Metro dead-code
 * elimination); bundle:inspect proves the marker strings absent from
 * non-development exports and config:check rejects the env flag for
 * candidate/release profiles. */
function useDevQaHooks(): QaHookState {
  const [state, setState] = React.useState<QaHookState>({ corrupted: false, expired: false });
  React.useEffect(() => {
    if (!(__DEV__ && process.env.EXPO_PUBLIC_QA_HOOKS === '1')) return undefined;
    /* eslint-disable @typescript-eslint/no-require-imports */
    const corrupt =
      require('@/dev/qa-corrupt-storage') as typeof import('@/dev/qa-corrupt-storage');
    const expire = require('@/dev/qa-expire-session') as typeof import('@/dev/qa-expire-session');
    const secureStore = require('expo-secure-store') as typeof import('expo-secure-store');
    /* eslint-enable @typescript-eslint/no-require-imports */
    const backend = {
      getItem: (key: string) => secureStore.getItemAsync(key),
      setItem: (key: string, value: string) => secureStore.setItemAsync(key, value),
      deleteItem: (key: string) => secureStore.deleteItemAsync(key),
    };
    const handle = (url: string | null): void => {
      if (!url) return;
      if (corrupt.isQaCorruptUrl(url)) {
        void corrupt
          .corruptStoredSessionForQa(backend)
          .then(() => setState((s) => ({ ...s, corrupted: true })));
      } else if (expire.isQaExpireUrl(url)) {
        void expire.expireStoredSessionForQa(backend).then((ok) => {
          if (ok) setState((s) => ({ ...s, expired: true }));
        });
      }
    };
    void Linking.getInitialURL().then(handle);
    const subscription = Linking.addEventListener('url', (event) => handle(event.url));
    return () => subscription.remove();
  }, []);
  return state;
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

/** QA-build only (RETURN-3 area 8, extended 2026-09-03): React Native's
 * LogBox draws its "open debugger to view warnings" banner across the
 * BOTTOM of the screen, which is exactly where the persistent nav lives.
 * The offline flows provoke a network warning by design, so the banner
 * appeared and swallowed every nav tap after it — `activity-and-help`
 * failed reaching Help with the tap landing on the banner instead (find
 * 23). This suppresses the OVERLAY only: warnings still reach the console
 * and logcat, so nothing is silenced, and the whole call sits behind the
 * same `__DEV__` + QA-flag guard as the storage hook, which config:check
 * forbids outside development and bundle:inspect proves absent from
 * non-development exports. */
function useQaLogBoxSuppression(): void {
  React.useEffect(() => {
    if (!(__DEV__ && process.env.EXPO_PUBLIC_QA_HOOKS === '1')) return;
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { LogBox } = require('react-native') as typeof import('react-native');
    /* eslint-enable @typescript-eslint/no-require-imports */
    LogBox.ignoreAllLogs(true);
  }, []);
}

export default function RootLayout(): React.JSX.Element {
  const qa = useDevQaHooks();
  useQaLogBoxSuppression();
  const runtime = getRuntime();
  if (!runtime.ok) {
    return <ConfigurationFatal problems={runtime.problems} />;
  }
  const qaBuild = __DEV__ && process.env.EXPO_PUBLIC_QA_HOOKS === '1';
  return (
    <SafeAreaProvider>
      <AuthProvider controller={runtime.services.controller}>
        <StatusBar style="auto" />
        {/* Frequent navigation is not animated (motion contract). */}
        <Stack screenOptions={{ headerShown: false, animation: 'none' }} />
        {/* QA-only completion acknowledgments (RETURN-3 area 8; find 20):
            rendered only in QA dev builds after the respective write
            completes, so the Maestro flow waits for the ack before
            stopping the app. Both expressions are dead code in release
            bundles (__DEV__). */}
        {qaBuild && qa.corrupted ? (
          <AppText variant="caption" testID="qa-corrupt-ack" accessibilityLabel="QA acknowledgment">
            QA: stored session corrupted
          </AppText>
        ) : null}
        {qaBuild && qa.expired ? (
          <AppText variant="caption" testID="qa-expired-ack" accessibilityLabel="QA acknowledgment">
            QA: stored session expired
          </AppText>
        ) : null}
      </AuthProvider>
    </SafeAreaProvider>
  );
}
