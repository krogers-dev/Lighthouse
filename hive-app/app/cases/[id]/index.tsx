import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';

import { getRuntime } from '@/app-runtime';
import { CaseReviewScreen } from '@/features/review/CaseReviewScreen';
import { AuthorizedScreen } from '@/features/shared/AuthorizedScreen';

/** The staff case review (WO-005). Reachable from Home for a staff
 * membership; a client user who lands here by deep link is told the page
 * is for staff, and the server refuses them every row and every
 * transition regardless of what the route says. */
export default function CaseReviewRoute(): React.JSX.Element {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  // A route param is untrusted input, never scope (threat T5).
  const raw = params.id;
  const caseId = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '');
  const runtime = getRuntime();
  return (
    <AuthorizedScreen current="home" testID="case-review-screen">
      {runtime.ok ? (
        <CaseReviewScreen
          reviewRepository={runtime.services.reviewRepository}
          requestsRepository={runtime.services.requestsRepository}
          documentsRepository={runtime.services.documentsRepository}
          random={runtime.services.random}
          caseId={caseId}
          onBack={() => router.push('/dashboard' as never)}
          onAddRequest={(id) => router.push(`/cases/${id}/requests/new` as never)}
        />
      ) : null}
    </AuthorizedScreen>
  );
}
