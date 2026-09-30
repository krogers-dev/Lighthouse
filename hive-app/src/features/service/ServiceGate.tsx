/** The service gate (WO-007): the explicit states for a paused service
 * and an app below the minimum version.
 *
 * Reads the public status before anything else mounts, and again
 * whenever the app returns to the foreground. Until the FIRST read
 * settles it shows a neutral starting screen and mounts nothing, so the
 * auth boot never runs against a paused service (find 65: a cold boot
 * while paused read zero memberships and, fail-closed, signed the person
 * out with the wrong reason). Then: an unknown or open status renders
 * the app (the server refuses on its own while paused); a readable
 * "paused" or an app that is too old replaces it with one explicit,
 * accessible screen. "Try again" reads again; nothing here retains
 * anything or talks to any account. */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus, StyleSheet, View } from 'react-native';

import {
  type ServiceGateDecision,
  type ServiceStatus,
  decideServiceGate,
} from '@/core/service-status';
import { SERVICE_GATE_WORDING } from '@/features/shared/labels';
import { Button, LoadingState, Notice, Screen } from '@/ui';
import { spacing } from '@/ui/tokens';

export interface ServiceGateProps {
  /** The public status read; null when it could not be read. */
  read: () => Promise<ServiceStatus | null>;
  appVersion: string;
  children: React.ReactNode;
}

/** Literal test ids, so the flow validator can see them. */
const SERVICE_GATE_TEST_IDS = {
  paused: 'service-paused',
  update_required: 'service-update-required',
} as const;

const styles = StyleSheet.create({
  container: { gap: spacing.lg },
});

export function ServiceGateView({
  decision,
  checking,
  onRetry,
}: {
  decision: Exclude<ServiceGateDecision, { name: 'open' }>;
  checking: boolean;
  onRetry: () => void;
}): React.JSX.Element {
  const wording =
    decision.name === 'paused'
      ? SERVICE_GATE_WORDING.paused[decision.reason]
      : SERVICE_GATE_WORDING.updateRequired;
  return (
    <Screen testID={SERVICE_GATE_TEST_IDS[decision.name]}>
      <View style={styles.container}>
        <Notice
          tone="warning"
          title={wording.title}
          body={wording.body}
          testID="service-gate-notice"
        />
        {decision.name === 'paused' ? (
          <Button
            label="Try again"
            onPress={onRetry}
            loading={checking}
            accessibilityHint="Checks whether HIVE is open again"
            testID="service-retry"
          />
        ) : null}
      </View>
    </Screen>
  );
}

export function ServiceGate({ read, appVersion, children }: ServiceGateProps): React.JSX.Element {
  // null until the first read settles: nothing underneath mounts before then.
  const [decision, setDecision] = useState<ServiceGateDecision | null>(null);
  const [checking, setChecking] = useState(true);
  const epoch = useRef(0);
  const mounted = useRef(true);

  /** The read: state is written only once it answers. */
  const check = useCallback(() => {
    const started = ++epoch.current;
    void read().then((status) => {
      if (!mounted.current || started !== epoch.current) return;
      setDecision(decideServiceGate(status, appVersion));
      setChecking(false);
    });
  }, [appVersion, read]);

  useEffect(() => {
    mounted.current = true;
    check();
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') check();
    });
    return () => {
      mounted.current = false;
      epoch.current += 1;
      subscription.remove();
    };
  }, [check]);

  const retry = useCallback(() => {
    setChecking(true);
    check();
  }, [check]);

  if (decision === null) {
    return (
      <Screen testID="service-checking">
        <LoadingState label="Starting HIVE" testID="service-checking-state" />
      </Screen>
    );
  }
  if (decision.name === 'open') return <>{children}</>;
  return <ServiceGateView decision={decision} checking={checking} onRetry={retry} />;
}
