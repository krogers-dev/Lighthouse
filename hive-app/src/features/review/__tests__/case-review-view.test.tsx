import { fireEvent, render, screen } from '@testing-library/react-native';

import { SafeError } from '@/core/errors';
import type { RequestSummary } from '@/data/supabase/repositories';
import type { CaseApproval, CaseRecord, CaseReview, ReviewPackage } from '@/data/supabase/reviews';

import { CaseReviewView, type CaseReviewViewProps } from '../CaseReviewView';
import { type ReviewFlowState, initialReviewState } from '../review-flow';

const caseRecord: CaseRecord = {
  id: 'eeeeeeee-0000-4000-8000-0000000000a1',
  title: '2025 books close (Synthetic)',
  status: 'APPROVAL_PENDING',
  statusChangedAt: '2026-09-28T17:00:00Z',
  version: 7,
};

const requests: RequestSummary[] = [
  {
    id: 'dddddddd-0000-4000-8000-0000000000a1',
    title: 'Bank statement for the closing month (Synthetic)',
    status: 'OPEN',
    ownerRole: 'client_user',
    requestedOn: '2026-08-10',
    dueOn: null,
  },
];

const current: ReviewPackage = {
  id: 'pkg-2',
  packageNumber: 2,
  manifest: {
    caseId: caseRecord.id,
    requests: [{ id: requests[0]!.id, status: 'OPEN', version: 2 }],
    answers: [{ id: 'ans-1', requestId: requests[0]!.id, version: 3, bodySha256: 'ab'.repeat(32) }],
    documents: [
      { id: 'doc-1', requestId: requests[0]!.id, clientDigest: 'cd'.repeat(32), byteSize: 184320 },
    ],
  },
  manifestDigest: 'ef'.repeat(32),
  caseVersion: 5,
  frozenRole: 'preparer',
  frozenAt: '2026-09-28T16:00:00Z',
};

const passed: CaseReview = {
  id: 'rev-1',
  reviewerRole: 'reviewer',
  status: 'RECORDED',
  verdict: 'PASS',
  note: 'Looks complete (Synthetic).',
  startedAt: '2026-09-28T16:30:00Z',
  recordedAt: '2026-09-28T16:45:00Z',
};

const approval: CaseApproval = {
  id: 'app-1',
  status: 'ACTIVE',
  packageNumber: 2,
  packageDigest: 'ef'.repeat(32),
  destination: 'hive-record',
  approvedAt: '2026-09-28T17:00:00Z',
  expiresAt: '2026-10-28T17:00:00Z',
  endedAt: null,
  endReason: null,
};

const handlers = {
  onRetry: jest.fn(),
  onSwitchScope: jest.fn(),
  onBack: jest.fn(),
  onChooseVerdict: jest.fn(),
  onChangeNote: jest.fn(),
  onRequestAction: jest.fn(),
  onConfirm: jest.fn(),
  onCancel: jest.fn(),
  onDismiss: jest.fn(),
  onTryAgain: jest.fn(),
};

const base: Omit<CaseReviewViewProps, 'flow'> = {
  state: 'ready',
  caseRecord,
  package: current,
  reviews: [passed],
  approvals: [],
  requests,
  role: 'approver',
  actions: ['approve', 'record_verdict'],
  verdicts: ['RETURN', 'HOLD'],
  ...handlers,
};

function view(flow: ReviewFlowState, overrides: Partial<CaseReviewViewProps> = {}) {
  return <CaseReviewView {...base} {...overrides} flow={flow} />;
}

describe('CaseReviewView for staff', () => {
  it('shows the case, the package with its digest and contents, and the recorded verdict', async () => {
    await render(view(initialReviewState));
    expect(screen.getByTestId('case-review-ready')).toBeTruthy();
    expect(screen.getByText('2025 books close (Synthetic)')).toBeTruthy();
    expect(screen.getByLabelText('Status: Awaiting approval')).toBeTruthy();
    expect(screen.getByText('Review package 2')).toBeTruthy();
    expect(screen.getByTestId('case-review-package-digest')).toHaveTextContent(
      new RegExp('ef'.repeat(32)),
    );
    expect(screen.getByText('Bank statement for the closing month (Synthetic)')).toBeTruthy();
    expect(screen.getByText('Submitted answers (1)')).toBeTruthy();
    expect(screen.getByText('Checked documents (1)')).toBeTruthy();
    expect(screen.getByText(/180 KB, digest cdcdcdcdcdcdcdcd/)).toBeTruthy();
    expect(screen.getByText('Reviewer')).toBeTruthy();
    expect(screen.getByLabelText('Done: Pass')).toBeTruthy();
    expect(screen.getByText('Looks complete (Synthetic).')).toBeTruthy();
    expect(screen.getByTestId('case-review-no-approval')).toBeTruthy();
  });

  it('offers the approval as the primary action and the verdict form beside it', async () => {
    await render(view(initialReviewState));
    await fireEvent.press(screen.getByTestId('case-review-action-approve'));
    expect(handlers.onRequestAction).toHaveBeenCalledWith('approve');
    expect(screen.getByTestId('case-review-verdict-form')).toBeTruthy();
    expect(screen.queryByTestId('case-review-verdict-pass')).toBeNull();
    await fireEvent.press(screen.getByTestId('case-review-verdict-hold'));
    expect(handlers.onChooseVerdict).toHaveBeenCalledWith('HOLD');
    await fireEvent.changeText(
      screen.getByTestId('case-review-note'),
      'Authority open (Synthetic).',
    );
    expect(handlers.onChangeNote).toHaveBeenCalledWith('Authority open (Synthetic).');
    await fireEvent.press(screen.getByTestId('case-review-action-record-verdict'));
    expect(handlers.onRequestAction).toHaveBeenCalledWith('record_verdict');
  });

  it('confirms an approval with the exact binding and says what it is not', async () => {
    await render(view({ name: 'confirming', action: 'approve', draft: initialReviewState.draft }));
    expect(screen.getByTestId('case-review-confirm-binding')).toHaveTextContent(
      /Package 2, case version 7/,
    );
    expect(
      screen.getByText(/not a release, a reconciliation, a completion, or a filing/),
    ).toBeTruthy();
    await fireEvent.press(screen.getByTestId('case-review-confirm'));
    expect(handlers.onConfirm).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('case-review-cancel'));
    expect(handlers.onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('case-review-action-approve')).toBeNull();
  });

  it('confirms a verdict with the chosen verdict and note on screen', async () => {
    await render(
      view({
        name: 'confirming',
        action: 'record_verdict',
        draft: { verdict: 'RETURN', note: 'Missing page (Synthetic)' },
      }),
    );
    expect(screen.getByTestId('case-review-confirm-verdict')).toHaveTextContent(/Verdict: Return/);
    expect(screen.getByText('Missing page (Synthetic)')).toBeTruthy();
    expect(screen.getByText(/A recorded verdict cannot be changed/)).toBeTruthy();
  });

  it('while running, shows the step and offers no control at all, including back', async () => {
    await render(view({ name: 'running', action: 'approve', draft: initialReviewState.draft }));
    expect(screen.getByText('Recording the approval')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('shows the active approval with its binding, destination, and expiry', async () => {
    await render(
      view(initialReviewState, {
        caseRecord: { ...caseRecord, status: 'APPROVED' },
        approvals: [approval],
        actions: [],
      }),
    );
    expect(screen.getByLabelText('Done: Active approval')).toBeTruthy();
    expect(screen.getByText(/Approved September 28, 2026 for package 2/)).toBeTruthy();
    expect(screen.getByText(/Destination: the HIVE record. Expires October 28, 2026/)).toBeTruthy();
    expect(screen.getByTestId('case-review-no-action')).toBeTruthy();
  });

  it('sends a stale screen to refresh and lets an editable refusal be dismissed', async () => {
    await render(
      view({
        name: 'refused',
        action: 'approve',
        refusal: 'digest_mismatch',
        draft: initialReviewState.draft,
      }),
    );
    expect(screen.getByText(/not the current one/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('case-review-refresh'));
    expect(handlers.onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('case-review-dismiss')).toBeNull();
  });

  it('words a conflict of interest and offers to keep editing', async () => {
    await render(
      view({
        name: 'refused',
        action: 'approve',
        refusal: 'conflict_of_interest',
        draft: initialReviewState.draft,
      }),
    );
    expect(screen.getByText(/does not review or approve it/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('case-review-dismiss'));
    expect(handlers.onDismiss).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed action ready to try again', async () => {
    await render(
      view({
        name: 'failed',
        action: 'freeze',
        error: new SafeError('network'),
        draft: initialReviewState.draft,
      }),
    );
    expect(screen.getByText(/We could not reach HIVE/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('case-review-retry'));
    expect(handlers.onTryAgain).toHaveBeenCalledTimes(1);
  });

  it('names the preparer and reviewer actions for their statuses', async () => {
    await render(
      view(initialReviewState, {
        caseRecord: { ...caseRecord, status: 'EVIDENCE_PENDING' },
        role: 'preparer',
        actions: ['freeze'],
        verdicts: [],
        package: null,
        reviews: [],
      }),
    );
    expect(screen.getByText('Send for review')).toBeTruthy();
    expect(screen.getByTestId('case-review-no-package')).toBeTruthy();
    const reopened = await render(
      view(initialReviewState, {
        caseRecord: { ...caseRecord, status: 'HOLD' },
        role: 'approver',
        actions: ['resume'],
        verdicts: [],
      }),
    );
    expect(reopened.getByText('Lift the hold')).toBeTruthy();
  });
});

describe('CaseReviewView outside staff', () => {
  it('tells a client user the page is for staff and shows nothing of the workflow', async () => {
    await render(view(initialReviewState, { role: 'client_user', actions: [], verdicts: [] }));
    expect(screen.getByTestId('case-review-staff-only')).toBeTruthy();
    expect(screen.queryByText('Review package 2')).toBeNull();
    expect(screen.queryByText(/Verdicts/)).toBeNull();
    expect(screen.getByTestId('case-review-back')).toBeTruthy();
  });

  it.each([
    ['loading', 'case-review-loading'],
    ['offline', 'case-review-offline'],
    ['denied', 'case-review-denied'],
    ['stale_scope', 'case-review-stale'],
  ] as const)('shows the %s state explicitly', async (state, testID) => {
    await render(view(initialReviewState, { state, caseRecord: undefined }));
    expect(screen.getByTestId(testID)).toBeTruthy();
  });

  it('says a foreign id is not here, never that it exists elsewhere', async () => {
    await render(view(initialReviewState, { state: 'empty', caseRecord: null }));
    expect(screen.getByTestId('case-review-empty')).toBeTruthy();
    for (const leak of ['another workspace', 'no permission', 'not authorized', 'exists']) {
      expect(screen.queryByText(new RegExp(leak, 'i'))).toBeNull();
    }
  });
});
