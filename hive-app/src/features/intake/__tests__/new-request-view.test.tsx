import { fireEvent, render, screen } from '@testing-library/react-native';

import type { DocumentSummary } from '@/data/supabase/documents';
import type { CaseRecord } from '@/data/supabase/reviews';

import { initialRequestDraft } from '../intake-rules';
import {
  type NewRequestFlowState,
  NewRequestView,
  type NewRequestViewProps,
} from '../NewRequestView';

const caseRecord: CaseRecord = {
  id: 'eeeeeeee-0000-4000-8000-0000000000a1',
  title: '2025 books close (Synthetic)',
  status: 'INTAKE_RECORDED',
  statusChangedAt: '2026-09-15T16:00:00Z',
  version: 2,
};

const checked = {
  id: 'd0c0d0c0-0000-4000-8000-0000000000a1',
  status: 'ACCEPTED',
  displayName: 'bank-statement-2026-07 (Synthetic).pdf',
} as DocumentSummary;
const rejected = {
  id: 'd0c0d0c0-0000-4000-8000-0000000000a2',
  status: 'REJECTED',
  displayName: 'receipt-photo (Synthetic).jpeg',
} as DocumentSummary;

const handlers = {
  onRetry: jest.fn(),
  onSwitchScope: jest.fn(),
  onChangeTitle: jest.fn(),
  onChangeDetail: jest.fn(),
  onChooseDue: jest.fn(),
  onChooseDocument: jest.fn(),
  onRequest: jest.fn(),
  onConfirm: jest.fn(),
  onCancel: jest.fn(),
  onDismiss: jest.fn(),
  onTryAgain: jest.fn(),
  onBack: jest.fn(),
};

const base: Omit<NewRequestViewProps, 'flow'> = {
  state: 'ready',
  caseRecord,
  documents: [checked, rejected],
  allowed: true,
  ...handlers,
};

const idle: NewRequestFlowState = { name: 'idle', draft: initialRequestDraft };

function view(flow: NewRequestFlowState, overrides: Partial<NewRequestViewProps> = {}) {
  return <NewRequestView {...base} {...overrides} flow={flow} />;
}

describe('NewRequestView', () => {
  it('shows the case, the two fields, four due choices, and only checked documents as subjects', async () => {
    await render(view(idle));
    expect(screen.getByText('2025 books close (Synthetic)')).toBeTruthy();
    expect(screen.getByTestId('new-request-title-label')).toHaveTextContent(
      /What you are asking for/,
    );
    expect(screen.getByTestId('new-request-detail-label')).toHaveTextContent(/Detail/);
    expect(screen.getByText('No due date (chosen)')).toBeTruthy();
    for (const testID of ['new-request-due-7', 'new-request-due-14', 'new-request-due-30']) {
      expect(screen.getByTestId(testID)).toBeTruthy();
    }
    expect(screen.getByTestId(`new-request-subject-${checked.id}`)).toBeTruthy();
    expect(screen.queryByTestId(`new-request-subject-${rejected.id}`)).toBeNull();
    await fireEvent.press(screen.getByTestId('new-request-due-14'));
    expect(handlers.onChooseDue).toHaveBeenCalledWith(14);
    await fireEvent.press(screen.getByTestId(`new-request-subject-${checked.id}`));
    expect(handlers.onChooseDocument).toHaveBeenCalledWith(checked.id);
    await fireEvent.press(screen.getByTestId('new-request-subject-none'));
    expect(handlers.onChooseDocument).toHaveBeenCalledWith(null);
    await fireEvent.changeText(screen.getByTestId('new-request-detail'), 'Every month.');
    expect(handlers.onChangeDetail).toHaveBeenCalledWith('Every month.');
    await fireEvent.press(screen.getByTestId('new-request-open'));
    expect(handlers.onRequest).toHaveBeenCalledTimes(1);
  });

  it('hides the subject choice when the case has no checked document', async () => {
    await render(view(idle, { documents: [rejected] }));
    expect(screen.queryByTestId('new-request-subject')).toBeNull();
  });

  it('confirms with the cleaned title, the detail, the due date, and the subject, and says the case moves on a received case', async () => {
    await render(
      view({
        name: 'confirming',
        draft: {
          title: ' Bank  statements (Synthetic) ',
          detail: 'Every month of 2026.',
          dueInDays: 14,
          subjectDocumentId: checked.id,
        },
      }),
    );
    const panel = screen.getByTestId('new-request-confirm-panel');
    expect(panel).toHaveTextContent(/Bank statements \(Synthetic\)/);
    expect(panel).toHaveTextContent(/Every month of 2026\./);
    expect(panel).toHaveTextContent(/In 14 days · about bank-statement-2026-07 \(Synthetic\)\.pdf/);
    expect(screen.getByTestId('new-request-confirm-notice')).toHaveTextContent(
      /moves to waiting on documents/,
    );
    await fireEvent.press(screen.getByTestId('new-request-confirm'));
    expect(handlers.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('says the case stays where it is when evidence is already being gathered', async () => {
    await render(
      view(
        { name: 'confirming', draft: { ...initialRequestDraft, title: 'Payroll (Synthetic)' } },
        { caseRecord: { ...caseRecord, status: 'EVIDENCE_PENDING' } },
      ),
    );
    expect(screen.getByTestId('new-request-confirm-notice')).toHaveTextContent(/stays where it is/);
  });

  it('offers the way back to the case once the request is opened', async () => {
    await render(
      view({
        name: 'done',
        draft: { ...initialRequestDraft, title: 'Payroll (Synthetic)' },
        result: {
          requestId: 'r-1',
          requestVersion: 1,
          caseStatus: 'EVIDENCE_PENDING',
          caseVersion: 3,
        },
      }),
    );
    expect(screen.getByTestId('new-request-done')).toHaveTextContent(/Request opened/);
    await fireEvent.press(screen.getByTestId('new-request-done-back'));
    expect(handlers.onBack).toHaveBeenCalledTimes(1);
  });

  it('words refusals: a stale case goes back to the case, an empty title back to the field', async () => {
    await render(
      view({ name: 'refused', draft: initialRequestDraft, refusal: 'case_not_open_for_requests' }),
    );
    expect(screen.getByTestId('new-request-refused')).toHaveTextContent(/not taking requests/);
    expect(screen.getByTestId('new-request-back-stale')).toBeTruthy();
    await render(view({ name: 'refused', draft: initialRequestDraft, refusal: 'title_missing' }));
    expect(screen.getByTestId('new-request-dismiss')).toBeTruthy();
  });

  it('tells a viewer who may not ask here why, and a foreign id that the case is not here', async () => {
    await render(view(idle, { allowed: false, caseRecord: { ...caseRecord, status: 'DRAFT' } }));
    expect(screen.getByTestId('new-request-not-allowed')).toBeTruthy();
    expect(screen.queryByTestId('new-request-open')).toBeNull();
    await render(view(idle, { state: 'empty', caseRecord: null, allowed: false }));
    expect(screen.getByTestId('new-request-empty')).toBeTruthy();
  });
});
