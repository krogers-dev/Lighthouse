import React from 'react';

import { getRuntime } from '@/app-runtime';
import { ActivityScreen } from '@/features/activity/ActivityScreen';
import { AuthorizedScreen } from '@/features/shared/AuthorizedScreen';

export default function ActivityRoute(): React.JSX.Element {
  const runtime = getRuntime();
  return (
    <AuthorizedScreen current="activity" testID="activity-screen">
      {runtime.ok ? <ActivityScreen repository={runtime.services.activityRepository} /> : null}
    </AuthorizedScreen>
  );
}
