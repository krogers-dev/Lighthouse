import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';

import { getRuntime } from '@/app-runtime';
import { RequestDetailScreen } from '@/features/requests/RequestDetailScreen';
import { AuthorizedScreen } from '@/features/shared/AuthorizedScreen';

export default function RequestDetailRoute(): React.JSX.Element {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  // A route param is untrusted input, never scope: it is passed to the
  // repositories as a filter inside the selected scope (threat T5).
  const raw = params.id;
  const requestId = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '');
  const runtime = getRuntime();
  return (
    <AuthorizedScreen current="requests" testID="request-detail-screen">
      {runtime.ok ? (
        <RequestDetailScreen
          repository={runtime.services.requestsRepository}
          documentsRepository={runtime.services.documentsRepository}
          answersRepository={runtime.services.answersRepository}
          requestId={requestId}
          onAddDocument={() => router.push(`/requests/${requestId}/add-document` as never)}
          onAnswer={() => router.push(`/requests/${requestId}/respond` as never)}
          onBack={() => router.push('/requests' as never)}
        />
      ) : null}
    </AuthorizedScreen>
  );
}
