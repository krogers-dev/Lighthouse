import { fireEvent, render, screen } from '@testing-library/react-native';

import { SafeError } from '@/core/errors';
import type { RequestAnswer } from '@/data/supabase/answers';
import type { RequestDetail } from '@/data/supabase/repositories';

import { RequestDetailView } from '../RequestDetailView';

const request: RequestDetail = {
  id: 'dddddddd-0000-4000-8000-0000000000a1',
  title: 'Bank statement for the closing month (Synthetic)',
  detail: 'The final month statement is needed to complete the records (Synthetic).',
  status: 'OPEN',
  ownerRole: 'client_user',
  requestedOn: '2026-08-10',
  dueOn: '2026-09-10',
  version: 1,
  subjectDocumentId: null,
};

const baseProps = { onRetry: jest.fn(), onSwitchScope: jest.fn(), onBack: jest.fn() };

describe('RequestDetailView', () => {
  it('shows the request with its detail, owner, and dates', async () => {
    await render(<RequestDetailView {...baseProps} state="ready" request={request} />);
    expect(screen.getByTestId('request-detail-ready')).toBeTruthy();
    expect(screen.getByText(request.detail)).toBeTruthy();
    // Owner and dates are a small table: each row is one accessible item
    // whose name pairs the label with its value.
    expect(screen.getByLabelText('Owner: You')).toBeTruthy();
    expect(screen.getByLabelText('Requested: August 10, 2026')).toBeTruthy();
    expect(screen.getByLabelText('Due: September 10, 2026')).toBeTruthy();
    expect(screen.getByText('You')).toBeTruthy();
    expect(screen.getByText('August 10, 2026')).toBeTruthy();
  });

  it('says a foreign id is not here, never that it exists elsewhere', async () => {
    await render(<RequestDetailView {...baseProps} state="empty" request={null} />);
    const body = screen.getByTestId('request-detail-empty');
    expect(body).toBeTruthy();
    expect(screen.getByText('Request not found here')).toBeTruthy();
    // Nothing may hint that the request exists in another workspace.
    for (const leak of ['another workspace', 'no permission', 'not authorized', 'exists']) {
      expect(screen.queryByText(new RegExp(leak, 'i'))).toBeNull();
    }
  });

  it('offers a safe way back and no write control', async () => {
    const onBack = jest.fn();
    await render(
      <RequestDetailView {...baseProps} state="ready" request={request} onBack={onBack} />,
    );
    await fireEvent.press(screen.getByTestId('request-detail-back'));
    expect(onBack).toHaveBeenCalled();
    for (const forbidden of ['Respond', 'Reply', 'Upload', 'Attach', 'Edit', 'Send']) {
      expect(screen.queryByText(forbidden)).toBeNull();
    }
  });

  it.each([
    ['loading', 'request-detail-loading'],
    ['offline', 'request-detail-offline'],
    ['denied', 'request-detail-denied'],
    ['stale_scope', 'request-detail-stale'],
  ] as const)('shows the %s state explicitly', async (state, testID) => {
    await render(<RequestDetailView {...baseProps} state={state} />);
    expect(screen.getByTestId(testID)).toBeTruthy();
  });

  it('shows a safe error message', async () => {
    await render(
      <RequestDetailView {...baseProps} state="error" error={new SafeError('unknown')} />,
    );
    expect(screen.getByTestId('request-detail-error')).toBeTruthy();
  });
});

describe('RequestDetailView documents (WO-003)', () => {
  const documents = {
    items: [
      {
        id: 'd0c0d0c0-0000-4000-8000-0000000000a1',
        displayName: 'bank-statement-2026-07 (Synthetic).pdf',
        mimeType: 'application/pdf',
        byteSize: 184320,
        status: 'ACCEPTED' as const,
        receivedAt: '2026-08-11T10:00:00Z',
        checkedAt: '2026-08-11T10:05:00Z',
      },
      {
        id: 'd0c0d0c0-0000-4000-8000-0000000000a2',
        displayName: 'receipt-photo (Synthetic).jpeg',
        mimeType: 'image/jpeg',
        byteSize: 2411520,
        status: 'REJECTED' as const,
        receivedAt: '2026-08-12T09:30:00Z',
        checkedAt: '2026-08-12T09:34:00Z',
      },
      {
        id: 'd0c0d0c0-0000-4000-8000-0000000000a9',
        displayName: 'new-upload (Synthetic).pdf',
        mimeType: 'application/pdf',
        byteSize: 1234,
        status: 'QUARANTINED' as const,
        receivedAt: '2026-09-28T15:00:00Z',
        checkedAt: null,
      },
    ],
    recordedThrough: '2026-09-28T15:00:00Z',
  };

  it('lists every document with its true status and never a word like approved or filed', async () => {
    await render(
      <RequestDetailView {...baseProps} state="ready" request={request} documents={documents} />,
    );
    expect(screen.getByText('bank-statement-2026-07 (Synthetic).pdf')).toBeTruthy();
    expect(screen.getByLabelText('Done: Checked')).toBeTruthy();
    expect(screen.getByLabelText('Needs attention: Not accepted')).toBeTruthy();
    expect(screen.getByLabelText('Status: Received, being checked')).toBeTruthy();
    expect(screen.getByText('180 KB · Checked August 11, 2026')).toBeTruthy();
    expect(screen.getByText('1.2 KB · Received September 28, 2026')).toBeTruthy();
    for (const forbidden of ['Approved', 'Filed', 'Final', 'Upload', 'Attach']) {
      expect(screen.queryByText(new RegExp(`\b${forbidden}\b`))).toBeNull();
    }
  });

  it('says plainly when the request has no documents yet', async () => {
    await render(
      <RequestDetailView
        {...baseProps}
        state="ready"
        request={request}
        documents={{ items: [], recordedThrough: null }}
      />,
    );
    expect(screen.getByTestId('request-detail-documents-empty')).toBeTruthy();
  });

  it('shows the one write control only when the screen decided a document may be added', async () => {
    const onAddDocument = jest.fn();
    await render(
      <RequestDetailView
        {...baseProps}
        state="ready"
        request={request}
        documents={documents}
        canAddDocument
        onAddDocument={onAddDocument}
      />,
    );
    await fireEvent.press(screen.getByTestId('request-detail-add-document'));
    expect(onAddDocument).toHaveBeenCalledTimes(1);
  });

  it('keeps the control absent, not disabled, when the decision is no, even with a handler', async () => {
    const onAddDocument = jest.fn();
    const staff = await render(
      <RequestDetailView
        {...baseProps}
        state="ready"
        request={request}
        documents={documents}
        canAddDocument={false}
        onAddDocument={onAddDocument}
      />,
    );
    expect(staff.queryByTestId('request-detail-add-document')).toBeNull();
    expect(staff.queryByText('Add a document')).toBeNull();
  });
});

describe('RequestDetailView answer (WO-004)', () => {
  const subjectDocument = {
    id: 'd0c0d0c0-0000-4000-8000-0000000000a3',
    displayName: 'statement-2025-11 (Synthetic).pdf',
    mimeType: 'application/pdf',
    byteSize: 96256,
    status: 'ACCEPTED' as const,
    receivedAt: '2026-08-06T14:00:00Z',
    checkedAt: '2026-08-06T14:03:00Z',
  };
  const documents = {
    items: [
      {
        id: 'd0c0d0c0-0000-4000-8000-0000000000a4',
        displayName: 'november-balance-photo (Synthetic).png',
        mimeType: 'image/png',
        byteSize: 512000,
        status: 'ACCEPTED' as const,
        receivedAt: '2026-08-16T09:00:00Z',
        checkedAt: '2026-08-16T09:04:00Z',
      },
    ],
    recordedThrough: '2026-08-16T09:04:00Z',
  };
  const submitted: RequestAnswer = {
    id: 'ans-1',
    requestId: request.id,
    status: 'SUBMITTED',
    body: 'Yes, the closing balance matches our records (Synthetic).',
    version: 3,
    citedDocumentIds: ['d0c0d0c0-0000-4000-8000-0000000000a4'],
    submittedAt: '2026-09-28T16:05:00Z',
    updatedAt: '2026-09-28T16:05:00Z',
  };

  it('names the document the request is about, resolved inside the scope', async () => {
    await render(
      <RequestDetailView
        {...baseProps}
        state="ready"
        request={request}
        subjectDocument={subjectDocument}
      />,
    );
    expect(screen.getByLabelText('About: statement-2025-11 (Synthetic).pdf')).toBeTruthy();
  });

  it('offers the answer as the primary action of an open request, with add-document beside it', async () => {
    const onAnswer = jest.fn();
    await render(
      <RequestDetailView
        {...baseProps}
        state="ready"
        request={request}
        documents={documents}
        canAnswer
        canAddDocument
        onAnswer={onAnswer}
        onAddDocument={jest.fn()}
      />,
    );
    expect(screen.getByTestId('request-detail-answer-none')).toHaveTextContent('No answer yet.');
    await fireEvent.press(screen.getByTestId('request-detail-answer'));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Answer this request')).toBeTruthy();
    expect(screen.getByText('Add a document')).toBeTruthy();
  });

  it('names a draft and offers to continue it', async () => {
    await render(
      <RequestDetailView
        {...baseProps}
        state="ready"
        request={request}
        answer={{ ...submitted, status: 'DRAFT', submittedAt: null }}
        canAnswer
        onAnswer={jest.fn()}
      />,
    );
    expect(screen.getByTestId('request-detail-answer-draft')).toHaveTextContent(
      'Draft saved September 28, 2026. Not submitted yet.',
    );
    expect(screen.getByText('Continue your answer')).toBeTruthy();
  });

  it('shows a submitted answer with its date and the documents it refers to, and no control', async () => {
    await render(
      <RequestDetailView
        {...baseProps}
        state="ready"
        request={{ ...request, status: 'ANSWERED' }}
        documents={documents}
        answer={submitted}
        viewerRole="client_user"
        onAnswer={jest.fn()}
      />,
    );
    expect(screen.getByTestId('request-detail-answer-body')).toHaveTextContent(submitted.body);
    expect(screen.getByText(/Your answer .* Submitted September 28, 2026/)).toBeTruthy();
    expect(screen.getByText('Refers to: november-balance-photo (Synthetic).png')).toBeTruthy();
    expect(screen.queryByTestId('request-detail-answer')).toBeNull();
  });

  it("names the answer as the client's when staff read it", async () => {
    const staff = await render(
      <RequestDetailView
        {...baseProps}
        state="ready"
        request={{ ...request, status: 'ANSWERED' }}
        documents={documents}
        answer={submitted}
        viewerRole="reviewer"
      />,
    );
    expect(staff.getByText(/The client's answer/)).toBeTruthy();
  });

  it('says no answer is recorded on a settled request without one', async () => {
    await render(
      <RequestDetailView
        {...baseProps}
        state="ready"
        request={{ ...request, status: 'ANSWERED' }}
      />,
    );
    expect(screen.getByTestId('request-detail-answer-none')).toHaveTextContent(
      'No answer is recorded in HIVE.',
    );
  });
});
