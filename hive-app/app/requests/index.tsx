import { useRouter } from 'expo-router';
import React from 'react';

import { getRuntime } from '@/app-runtime';
import { RequestsScreen } from '@/features/requests/RequestsScreen';
import { AuthorizedScreen } from '@/features/shared/AuthorizedScreen';

export default function RequestsRoute(): React.JSX.Element {
  const router = useRouter();
  const runtime = getRuntime();
  return (
    <AuthorizedScreen current="requests" testID="requests-screen">
      {runtime.ok ? (
        <RequestsScreen
          repository={runtime.services.requestsRepository}
          onOpenRequest={(requestId) => router.push(`/requests/${requestId}` as never)}
        />
      ) : null}
    </AuthorizedScreen>
  );
}
