import { useRouter } from 'expo-router';
import React from 'react';

import { getRuntime } from '@/app-runtime';
import { useAuthState } from '@/auth/provider';
import { guardRedirect } from '@/auth/route-guard';
import { DashboardScreen } from '@/features/dashboard/DashboardScreen';
import { Screen } from '@/ui';

export default function DashboardRoute(): React.JSX.Element {
  const state = useAuthState();
  const router = useRouter();
  const redirect = guardRedirect(state, 'authorized');
  if (redirect) return redirect;
  const runtime = getRuntime();
  if (!runtime.ok) {
    // Unreachable: the root layout refuses to mount routes on bad config.
    return <Screen testID="dashboard-screen">{null}</Screen>;
  }
  return (
    <Screen testID="dashboard-screen">
      <DashboardScreen
        repository={runtime.services.dashboardRepository}
        onOpenSettings={() => router.push('/settings' as never)}
      />
    </Screen>
  );
}
