import { fireEvent, render, screen } from '@testing-library/react-native';

import { SafeError } from '@/core/errors';
import type { DocumentSummary } from '@/data/supabase/documents';
import type { RequestSummary } from '@/data/supabase/repositories';
import type {
  CaseApproval,
  CaseRecord,
  CaseReview,
  FilingReceipt,
  LedgerReference,
  ReviewPackage,
} from '@/data/supabase/reviews';

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
    caseId: 'eeeeeeee-0000-4000-8000-0000000000a1',
    title: 'Bank statement for the closing month (Synthetic)',
    status: 'OPEN',
    ownerRole: 'client_user',
    requestedOn: '2026-08-10',
    dueOn: null,
    version: 1,
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

const filedDocument: DocumentSummary = {
  id: 'd0c0d0c0-0000-4000-8000-0000000000a1',
  displayName: 'statement-2025-12 (Synthetic).pdf',
  mimeType: 'application/pdf',
  byteSize: 184320,
  status: 'ACCEPTED',
  receivedAt: '2026-08-06T14:00:00Z',
  checkedAt: '2026-08-06T14:03:00Z',
};
const FILING_DOC_BUTTON = 'case-review-filing-doc-d0c0d0c0-0000-4000-8000-0000000000a1';

const reference: LedgerReference = {
  id: 'ref-1',
  source: 'qbo',
  realmId: 'realm-synthetic-a1',
  objectType: 'JournalEntry',
  objectId: 'je-synthetic-2025-close',
  objectVersion: '2',
  displayName: 'Year-end close entry (Synthetic)',
  asOf: '2026-09-28T12:00:00Z',
  objectDigest: '12'.repeat(32),
  adapterName: 'HiveSyntheticLedger',
  recordedAt: '2026-09-28T12:05:00Z',
};

const receipt: FilingReceipt = {
  id: 'rcpt-1',
  documentId: filedDocument.id,
  packageId: current.id,
  driveFileId: 'drv-synthetic-0001',
  drivePath: '/Clients/Harbor Light Bakery LLC (Synthetic)/2025 books close (Synthetic)',
  claimedDigest: 'cd'.repeat(32),
  filedRole: 'intake',
  filedAt: '2026-09-28T18:00:00Z',
  status: 'VERIFIED',
  verifiedAt: '2026-09-28T18:10:00Z',
  foundDigest: 'cd'.repeat(32),
  adapterName: 'HiveSyntheticDrive',
};

const EMPTY_FILING = { documentId: null, driveFileId: '', drivePath: '' };

const handlers = {
  onRetry: jest.fn(),
  onSwitchScope: jest.fn(),
  onBack: jest.fn(),
  onChooseVerdict: jest.fn(),
  onChangeNote: jest.fn(),
  onChooseFilingDocument: jest.fn(),
  onChangeFileId: jest.fn(),
  onChangePath: jest.fn(),
  onRequestAction: jest.fn(),
  onConfirm: jest.fn(),
  onCancel: jest.fn(),
  onDismiss: jest.fn(),
  onTryAgain: jest.fn(),
  onCloseRequest: jest.fn(),
};

const base: Omit<CaseReviewViewProps, 'flow'> = {
  state: 'ready',
  caseRecord,
  package: current,
  reviews: [passed],
  approvals: [],
  requests,
  documents: [],
  references: [],
  receipts: [],
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
    // Named in the package and listed under the case's requests (WO-013).
    expect(screen.getAllByText('Bank statement for the closing month (Synthetic)').length).toBe(2);
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
        draft: {
          verdict: 'RETURN',
          note: 'Missing page (Synthetic)',
          filing: EMPTY_FILING,
          closing: null,
        },
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

  it('shows the sources and the permanent record as identifiers, versions, and digests, never values', async () => {
    await render(
      view(initialReviewState, {
        references: [reference],
        receipts: [
          receipt,
          {
            ...receipt,
            id: 'rcpt-2',
            driveFileId: 'drv-synthetic-wrong',
            status: 'MISMATCH',
            foundDigest: '00'.repeat(32),
          },
        ],
        documents: [filedDocument],
      }),
    );
    const source = screen.getByTestId('case-review-source-ref-1');
    expect(source).toHaveTextContent(/Year-end close entry \(Synthetic\)/);
    expect(source).toHaveTextContent(/Journal entry · version 2/);
    expect(source).toHaveTextContent(/read by HiveSyntheticLedger/);
    const verified = screen.getByTestId('case-review-receipt-rcpt-1');
    expect(verified).toHaveTextContent(/statement-2025-12 \(Synthetic\)\.pdf/);
    expect(verified).toHaveTextContent(/Verified in the record/);
    expect(verified).toHaveTextContent(/file drv-synthetic-0001/);
    expect(verified).toHaveTextContent(/Filed .* by Honeybee team/);
    const mismatched = screen.getByTestId('case-review-receipt-rcpt-2');
    expect(mismatched).toHaveTextContent(/Did not match the record/);
    expect(mismatched).toHaveTextContent(/found 0000000000000000…/);
    expect(screen.queryByTestId('case-review-no-source')).toBeNull();
    expect(screen.queryByTestId('case-review-no-receipt')).toBeNull();
  });

  it('says when nothing is referenced or filed', async () => {
    await render(view(initialReviewState));
    expect(screen.getByTestId('case-review-no-source')).toBeTruthy();
    expect(screen.getByTestId('case-review-no-receipt')).toBeTruthy();
  });

  it('offers intake the filing receipt on an approved case, with only checked documents to choose from', async () => {
    await render(
      view(initialReviewState, {
        caseRecord: { ...caseRecord, status: 'APPROVED' },
        role: 'intake',
        actions: ['record_filing'],
        verdicts: [],
        approvals: [approval],
        documents: [
          filedDocument,
          {
            ...filedDocument,
            id: 'doc-validating',
            status: 'VALIDATING',
            displayName: 'later (Synthetic).pdf',
          },
        ],
      }),
    );
    expect(screen.getByTestId('case-review-filing-form')).toBeTruthy();
    expect(screen.getByTestId(FILING_DOC_BUTTON)).toBeTruthy();
    expect(screen.queryByTestId('case-review-filing-doc-doc-validating')).toBeNull();
    expect(screen.queryByTestId('case-review-verdict-form')).toBeNull();
    await fireEvent.press(screen.getByTestId(FILING_DOC_BUTTON));
    expect(handlers.onChooseFilingDocument).toHaveBeenCalledWith(filedDocument.id);
    await fireEvent.changeText(
      screen.getByTestId('case-review-filing-file-id'),
      'drv-synthetic-0001',
    );
    expect(handlers.onChangeFileId).toHaveBeenCalledWith('drv-synthetic-0001');
    await fireEvent.changeText(screen.getByTestId('case-review-filing-path'), '/Clients');
    expect(handlers.onChangePath).toHaveBeenCalledWith('/Clients');
    expect(screen.getByText('Record filing receipt')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('case-review-action-record-filing'));
    expect(handlers.onRequestAction).toHaveBeenCalledWith('record_filing');
  });

  it('confirms a filing receipt with the exact document and Drive object, and says HIVE writes nothing to Drive', async () => {
    const confirming: ReviewFlowState = {
      name: 'confirming',
      action: 'record_filing',
      draft: {
        verdict: null,
        note: '',
        closing: null,
        filing: {
          documentId: filedDocument.id,
          driveFileId: 'drv-synthetic-0001',
          drivePath: receipt.drivePath,
        },
      },
    };
    await render(
      view(confirming, {
        caseRecord: { ...caseRecord, status: 'APPROVED' },
        role: 'intake',
        actions: ['record_filing'],
        verdicts: [],
        documents: [filedDocument],
      }),
    );
    const panel = screen.getByTestId('case-review-confirm-filing');
    expect(panel).toHaveTextContent(/statement-2025-12 \(Synthetic\)\.pdf/);
    expect(panel).toHaveTextContent(/Drive file drv-synthetic-0001/);
    expect(panel).toHaveTextContent(/Case version 7/);
    expect(screen.getByTestId('case-review-confirm-notice')).toHaveTextContent(
      /HIVE writes nothing to Drive/,
    );
    expect(screen.queryByTestId('case-review-filing-form')).toBeNull();
    expect(screen.queryByTestId('case-review-action-record-filing')).toBeNull();
  });

  it('sends a receipt the approval does not cover to refresh, and a bad file id back to editing', async () => {
    const refused = (refusal: 'document_not_approved' | 'invalid_file_id'): ReviewFlowState => ({
      name: 'refused',
      action: 'record_filing',
      refusal,
      draft: initialReviewState.draft,
    });
    const intake = { role: 'intake' as const, actions: ['record_filing' as const], verdicts: [] };
    await render(view(refused('document_not_approved'), intake));
    expect(screen.getByTestId('case-review-refused')).toHaveTextContent(
      /The approval does not cover that document/,
    );
    expect(screen.getByTestId('case-review-refresh')).toBeTruthy();
    const editable = await render(view(refused('invalid_file_id'), intake));
    expect(editable.getByTestId('case-review-refused')).toHaveTextContent(
      /Drive file id could not be used/,
    );
    expect(editable.getByTestId('case-review-dismiss')).toBeTruthy();
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

describe('CaseReviewView for intake (WO-013)', () => {
  const draftCase = { ...caseRecord, status: 'DRAFT' as const, version: 1 };

  it('offers intake the draft steps on a draft, records first, and confirms what the client sees', async () => {
    const onRequestAction = jest.fn();
    await render(
      view(initialReviewState, {
        caseRecord: draftCase,
        package: null,
        reviews: [],
        role: 'intake',
        actions: ['record_intake', 'discard_draft'],
        verdicts: [],
        onRequestAction,
      }),
    );
    expect(screen.getByTestId('case-review-no-package')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('case-review-action-record-intake'));
    expect(onRequestAction).toHaveBeenCalledWith('record_intake');
    await fireEvent.press(screen.getByTestId('case-review-action-discard-draft'));
    expect(onRequestAction).toHaveBeenCalledWith('discard_draft');
    expect(screen.getByText('Record intake')).toBeTruthy();
    expect(screen.getByText('Discard this draft')).toBeTruthy();
  });

  it('opens the request screen for "ask the client for something" instead of confirming', async () => {
    const onAddRequest = jest.fn();
    const onRequestAction = jest.fn();
    await render(
      view(initialReviewState, {
        caseRecord: { ...caseRecord, status: 'INTAKE_RECORDED' },
        package: null,
        reviews: [],
        role: 'intake',
        actions: ['add_request'],
        verdicts: [],
        onAddRequest,
        onRequestAction,
      }),
    );
    await fireEvent.press(screen.getByTestId('case-review-action-add-request'));
    expect(onAddRequest).toHaveBeenCalledTimes(1);
    expect(onRequestAction).not.toHaveBeenCalled();
  });

  it("lists the case's own requests and lets intake close an open one, naming it in the confirmation", async () => {
    const onCloseRequest = jest.fn();
    const foreign: RequestSummary = {
      ...requests[0]!,
      id: 'dddddddd-0000-4000-8000-0000000000b9',
      caseId: 'eeeeeeee-0000-4000-8000-0000000000b1',
      title: "Another case's request (Synthetic)",
    };
    await render(
      view(initialReviewState, {
        role: 'intake',
        actions: ['add_request'],
        verdicts: [],
        requests: [...requests, foreign],
        onCloseRequest,
      }),
    );
    expect(screen.getByTestId('case-review-requests')).toBeTruthy();
    expect(screen.queryByText("Another case's request (Synthetic)")).toBeNull();
    await fireEvent.press(screen.getByTestId(`case-review-close-request-${requests[0]!.id}`));
    expect(onCloseRequest).toHaveBeenCalledWith(requests[0]!.id, 1);
    await render(
      view(
        {
          name: 'confirming',
          action: 'close_request',
          draft: {
            ...initialReviewState.draft,
            closing: { requestId: requests[0]!.id, requestVersion: 1 },
          },
        },
        { role: 'intake', actions: ['add_request'], verdicts: [] },
      ),
    );
    expect(screen.getByTestId('case-review-confirm-close')).toHaveTextContent(
      'Bank statement for the closing month (Synthetic)',
    );
    expect(screen.getByTestId('case-review-confirm-notice')).toHaveTextContent(
      /Close this request/,
    );
  });

  it('offers no close to a reviewer and none while a transition is under way', async () => {
    await render(view(initialReviewState, { role: 'reviewer', actions: [], verdicts: [] }));
    expect(screen.queryByTestId(`case-review-close-request-${requests[0]!.id}`)).toBeNull();
    await render(
      view(
        { name: 'running', action: 'record_intake', draft: initialReviewState.draft },
        { role: 'intake', actions: ['record_intake', 'discard_draft'], verdicts: [] },
      ),
    );
    expect(screen.queryByTestId(`case-review-close-request-${requests[0]!.id}`)).toBeNull();
    expect(screen.getByTestId('case-review-running')).toHaveTextContent('Recording the intake');
  });

  it('words the intake refusals: a draft past its draft goes to refresh, an empty title back to editing', async () => {
    await render(
      view(
        {
          name: 'refused',
          action: 'record_intake',
          refusal: 'case_not_draft',
          draft: initialReviewState.draft,
        },
        { role: 'intake', actions: ['record_intake', 'discard_draft'], verdicts: [] },
      ),
    );
    expect(screen.getByTestId('case-review-refused')).toHaveTextContent(/past its draft/);
    expect(screen.getByTestId('case-review-refresh')).toBeTruthy();
    await render(
      view(
        {
          name: 'refused',
          action: 'close_request',
          refusal: 'request_missing',
          draft: initialReviewState.draft,
        },
        { role: 'intake', actions: ['add_request'], verdicts: [] },
      ),
    );
    expect(screen.getByTestId('case-review-dismiss')).toBeTruthy();
  });
});
