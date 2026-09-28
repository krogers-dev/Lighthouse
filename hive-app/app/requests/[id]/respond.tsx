import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';

import { getRuntime } from '@/app-runtime';
import { AnswerScreen } from '@/features/answers/AnswerScreen';
import { AuthorizedScreen } from '@/features/shared/AuthorizedScreen';

export default function RespondRoute(): React.JSX.Element {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  // The request id is a filter inside the selected scope, never scope
  // (threat T5); the screen re-reads the request and decides from
  // server-confirmed facts whether an answer may be written at all.
  const raw = params.id;
  const requestId = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '');
  const runtime = getRuntime();
  return (
    <AuthorizedScreen current="requests" testID="respond-screen">
      {runtime.ok ? (
        <AnswerScreen
          repository={runtime.services.requestsRepository}
          documentsRepository={runtime.services.documentsRepository}
          answersRepository={runtime.services.answersRepository}
          random={runtime.services.random}
          requestId={requestId}
          onBack={() => router.push(`/requests/${requestId}` as never)}
        />
      ) : null}
    </AuthorizedScreen>
  );
}
