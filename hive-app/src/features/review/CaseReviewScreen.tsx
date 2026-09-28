/** Connected case review screen for staff (WO-005).
 *
 * Loads the case, its current package, the verdicts and approvals on
 * that package, and the scope's requests (to name the ones the package
 * froze) through one scoped read; decides the viewer's actions from the
 * server-confirmed role and the case status; and mounts the transition
 * flow keyed on the case version, so a settled transition reloads the
 * case and starts a fresh flow on the new state. A client user reaching
 * the route sees that the page is for staff and the way back; the
 * server would refuse them everything anyway. */
import React, { useCallback } from 'react';

import { useAuthController } from '@/auth/provider';
import type { RandomSource } from '@/core/ids';
import type { RequestsLoader, RequestSummary } from '@/data/supabase/repositories';
import type {
  CaseApproval,
  CaseRecord,
  CaseReview,
  ReviewLoader,
  ReviewPackage,
  ReviewWriter,
} from '@/data/supabase/reviews';
import { useScopedLoad } from '@/features/shared/useScopedLoad';
import type { ScopeKey } from '@/tenancy/scope-key';
import { type MembershipRole, isStaffRole } from '@/tenancy/types';

import { CaseReviewView, type CaseReviewViewProps } from './CaseReviewView';
import { initialReviewState } from './review-flow';
import { actionsFor, verdictsFor } from './review-rules';
import { useCaseReview } from './useCaseReview';

export interface CaseReviewContext {
  caseRecord: CaseRecord | null;
  package: ReviewPackage | null;
  reviews: readonly CaseReview[];
  approvals: readonly CaseApproval[];
  requests: readonly RequestSummary[];
}

export interface CaseReviewScreenProps {
  reviewRepository: ReviewLoader & ReviewWriter;
  requestsRepository: RequestsLoader;
  random?: RandomSource;
  caseId: string;
  onBack: () => void;
}

const EMPTY: CaseReviewContext = {
  caseRecord: null,
  package: null,
  reviews: [],
  approvals: [],
  requests: [],
};

const isMissing = (value: CaseReviewContext): boolean => value.caseRecord === null;

/** The case id is a filter inside the scope, never scope (threat T5). */
export function loadCaseReviewContext(
  reviewRepository: ReviewLoader,
  requestsRepository: RequestsLoader,
  caseId: string,
): (scope: ScopeKey) => Promise<CaseReviewContext> {
  return async (scope: ScopeKey) => {
    const caseRecord = await reviewRepository.getCase(scope, caseId);
    if (!caseRecord) return EMPTY;
    const current = await reviewRepository.getCurrentPackage(scope, caseId);
    const reviews = current ? await reviewRepository.listReviews(scope, current.id) : [];
    const approvals = current ? await reviewRepository.listApprovals(scope, current.id) : [];
    const requests = (await requestsRepository.list(scope)).items;
    return { caseRecord, package: current, reviews, approvals, requests };
  };
}

type FlowHandlers =
  | 'onChooseVerdict'
  | 'onChangeNote'
  | 'onRequestAction'
  | 'onConfirm'
  | 'onCancel'
  | 'onDismiss'
  | 'onTryAgain';

type FlowViewProps = Omit<CaseReviewViewProps, 'flow' | FlowHandlers>;

function CaseReviewFlow({
  scope,
  caseRecord,
  currentPackage,
  writer,
  random,
  view,
  onSettled,
}: {
  scope: ScopeKey;
  caseRecord: CaseRecord;
  currentPackage: ReviewPackage | null;
  writer: ReviewWriter;
  random: RandomSource | undefined;
  view: FlowViewProps;
  onSettled: () => void;
}): React.JSX.Element {
  const controller = useAuthController();
  const onSessionExpired = useCallback(() => void controller.sessionExpired(), [controller]);
  const flow = useCaseReview({
    scope,
    caseRecord: { id: caseRecord.id, version: caseRecord.version },
    package: currentPackage
      ? { id: currentPackage.id, manifestDigest: currentPackage.manifestDigest }
      : null,
    writer,
    ...(random ? { random } : {}),
    onSessionExpired,
    onSettled,
  });
  return (
    <CaseReviewView
      {...view}
      flow={flow.state}
      onChooseVerdict={flow.chooseVerdict}
      onChangeNote={flow.setNote}
      onRequestAction={flow.request}
      onConfirm={flow.confirm}
      onCancel={flow.cancel}
      onDismiss={flow.dismiss}
      onTryAgain={flow.retry}
    />
  );
}

export function CaseReviewScreen({
  reviewRepository,
  requestsRepository,
  random,
  caseId,
  onBack,
}: CaseReviewScreenProps): React.JSX.Element | null {
  const load = useCallback(
    (scope: ScopeKey) => loadCaseReviewContext(reviewRepository, requestsRepository, caseId)(scope),
    [reviewRepository, requestsRepository, caseId],
  );
  const { scope, state, data, error, role, retry, switchScope } = useScopedLoad(load, isMissing);

  if (!scope) return null;

  const staff: MembershipRole | null = role && isStaffRole(role) ? role : null;
  const caseRecord = data?.caseRecord ?? null;
  const view: FlowViewProps = {
    state,
    caseRecord,
    package: data?.package ?? null,
    reviews: data?.reviews ?? [],
    approvals: data?.approvals ?? [],
    requests: data?.requests ?? [],
    role,
    actions: actionsFor(staff, caseRecord?.status ?? null),
    verdicts: verdictsFor(staff),
    error,
    onRetry: retry,
    onSwitchScope: switchScope,
    onBack,
  };

  if (state === 'ready' && data && caseRecord && staff) {
    return (
      <CaseReviewFlow
        key={`${caseRecord.id}:${caseRecord.version}`}
        scope={scope}
        caseRecord={caseRecord}
        currentPackage={data.package}
        writer={reviewRepository}
        random={random}
        view={view}
        onSettled={retry}
      />
    );
  }

  const noop = (): void => {};
  return (
    <CaseReviewView
      {...view}
      flow={initialReviewState}
      onChooseVerdict={noop}
      onChangeNote={noop}
      onRequestAction={noop}
      onConfirm={noop}
      onCancel={noop}
      onDismiss={noop}
      onTryAgain={noop}
    />
  );
}
