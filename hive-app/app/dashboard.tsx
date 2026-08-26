import React from 'react';

import { getRuntime } from '@/app-runtime';
import { DashboardScreen } from '@/features/dashboard/DashboardScreen';
import { AuthorizedScreen } from '@/features/shared/AuthorizedScreen';

export default function DashboardRoute(): React.JSX.Element {
  const runtime = getRuntime();
  return (
    <AuthorizedScreen current="home" testID="dashboard-screen">
      {/* Unreachable when config is bad: the root layout refuses to mount
          routes, so there is nothing to render here. */}
      {runtime.ok ? <DashboardScreen repository={runtime.services.dashboardRepository} /> : null}
    </AuthorizedScreen>
  );
}
