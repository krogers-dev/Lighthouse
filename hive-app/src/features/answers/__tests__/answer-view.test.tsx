import { fireEvent, render, screen } from '@testing-library/react-native';

import { SafeError } from '@/core/errors';
import type { DocumentSummary } from '@/data/supabase/documents';
import type { RequestDetail } from '@/data/supabase/repositories';

import { AnswerView, type AnswerViewProps } from '../AnswerView';
import { type AnswerDraft, type AnswerFlowState, initialAnswerState } from '../answer-flow';

const request: RequestDetail = {
  id: 'dddddddd-0000-4000-8000-0000000000a3',
  caseId: 'eeeeeeee-0000-4000-8000-0000000000a1',
  title: 'Confirm the November statement balance (Synthetic)',
  detail: 'Does the closing balance on the November statement match your records? (Synthetic)',
  status: 'OPEN',
  ownerRole: 'client_user',
  requestedOn: '2026-08-15',
  dueOn: '2026-09-15',
  version: 1,
  subjectDocumentId: 'd0c0d0c0-0000-4000-8000-0000000000a3',
};

const subjectDocument: DocumentSummary = {
  id: 'd0c0d0c0-0000-4000-8000-0000000000a3',
  displayName: 'statement-2025-11 (Synthetic).pdf',
  mimeType: 'application/pdf',
  byteSize: 96256,
  status: 'ACCEPTED',
  receivedAt: '2026-08-06T14:00:00Z',
  checkedAt: '2026-08-06T14:03:00Z',
};

const photo: DocumentSummary = {
  id: 'd0c0d0c0-0000-4000-8000-0000000000a4',
  displayName: 'november-balance-photo (Synthetic).png',
  mimeType: 'image/png',
  byteSize: 512000,
  status: 'ACCEPTED',
  receivedAt: '2026-08-16T09:00:00Z',
  checkedAt: '2026-08-16T09:04:00Z',
};

const typed: AnswerDraft = {
  body: 'Yes, the closing balance matches our records (Synthetic).',
  citedDocumentIds: [photo.id],
  saved: null,
};

const handlers = {
  onRetry: jest.fn(),
  onSwitchScope: jest.fn(),
  onChangeText: jest.fn(),
  onToggleCitation: jest.fn(),
  onSave: jest.fn(),
  onSubmit: jest.fn(),
  onConfirm: jest.fn(),
  onCancel: jest.fn(),
  onDismiss: jest.fn(),
  onTryAgain: jest.fn(),
  onBack: jest.fn(),
};

const base: Omit<AnswerViewProps, 'flow'> = {
  state: 'ready',
  request,
  subjectDocument,
  citable: [photo],
  canAnswer: true,
  ...handlers,
};

function view(flow: AnswerFlowState, overrides: Partial<AnswerViewProps> = {}) {
  return <AnswerView {...base} {...overrides} flow={flow} />;
}

describe('AnswerView while editing', () => {
  it('opens on the request, names what it is about, and offers the text and the documents to refer to', async () => {
    await render(view(initialAnswerState(null)));
    expect(screen.getByTestId('respond-request-title')).toHaveTextContent(request.title);
    expect(screen.getByTestId('respond-subject')).toHaveTextContent(
      'About: statement-2025-11 (Synthetic).pdf',
    );
    expect(screen.getByTestId('respond-text')).toBeTruthy();
    expect(screen.getByText('0 of 4,000 characters')).toBeTruthy();
    const box = screen.getByRole('checkbox');
    expect(box).not.toBeChecked();
    await fireEvent.press(box);
    expect(handlers.onToggleCitation).toHaveBeenCalledWith(photo.id);
    await fireEvent.changeText(screen.getByTestId('respond-text'), 'Yes');
    expect(handlers.onChangeText).toHaveBeenCalledWith('Yes');
    // Clean and empty: submit is the one primary action; nothing to save.
    await fireEvent.press(screen.getByTestId('respond-submit'));
    expect(handlers.onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('respond-save')).toBeNull();
    expect(screen.getByTestId('respond-back')).toBeTruthy();
  });

  it('shows the count, the referred-to state, and the save control once the draft is dirty', async () => {
    await render(view({ name: 'editing', draft: typed, notice: null }));
    expect(screen.getByText('57 of 4,000 characters')).toBeTruthy();
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.getByText(/Referred to in your answer/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('respond-save'));
    expect(handlers.onSave).toHaveBeenCalledTimes(1);
  });

  it('says plainly when there is no document to refer to', async () => {
    await render(view(initialAnswerState(null), { citable: [] }));
    expect(screen.getByTestId('respond-citations-empty')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('confirms a saved draft without claiming anything was submitted', async () => {
    await render(
      view({
        name: 'editing',
        draft: {
          ...typed,
          saved: {
            answerId: 'ans-1',
            version: 1,
            updatedAt: '2026-09-28T16:00:00Z',
            body: typed.body,
            citedDocumentIds: typed.citedDocumentIds,
          },
        },
        notice: 'saved',
      }),
    );
    expect(screen.getByTestId('respond-saved')).toBeTruthy();
    expect(screen.getByText(/Nothing has been submitted/)).toBeTruthy();
    expect(screen.queryByTestId('respond-save')).toBeNull();
  });
});

describe('AnswerView while confirming and submitting', () => {
  it('shows the answer as it will be submitted, says what submitting means, and offers submit or keep editing', async () => {
    await render(view({ name: 'confirming', draft: typed }));
    expect(screen.getByTestId('respond-review')).toBeTruthy();
    expect(screen.getByText(typed.body)).toBeTruthy();
    expect(screen.getByText('Refers to: november-balance-photo (Synthetic).png')).toBeTruthy();
    expect(screen.getByText(/cannot be changed/)).toBeTruthy();
    expect(screen.queryByTestId('respond-text')).toBeNull();
    await fireEvent.press(screen.getByTestId('respond-confirm'));
    expect(handlers.onConfirm).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('respond-cancel'));
    expect(handlers.onCancel).toHaveBeenCalledTimes(1);
  });

  it('while submitting, shows the step and offers no control at all, including back', async () => {
    await render(view({ name: 'submitting', draft: typed, step: 'submitting' }));
    expect(screen.getByText('Submitting your answer')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByTestId('respond-back')).toBeNull();
  });

  it('says submitted and answered, never approved, reviewed, or decided', async () => {
    await render(view({ name: 'submitted', draft: typed, submittedAt: '2026-09-28T16:05:00Z' }));
    expect(screen.getByTestId('respond-submitted')).toBeTruthy();
    expect(screen.getByText(/shows as answered/)).toBeTruthy();
    for (const forbidden of ['Approved', 'Reviewed', 'Decided', 'Final']) {
      expect(screen.queryByText(new RegExp(forbidden, 'i'))).toBeNull();
    }
    expect(screen.queryByTestId('respond-submit')).toBeNull();
    expect(screen.getByTestId('respond-back')).toBeTruthy();
  });
});

describe('AnswerView refusals and failures', () => {
  it('words a refusal the person can edit past, with the text beside it', async () => {
    await render(
      view({ name: 'refused', draft: typed, refusal: 'invalid_document', during: 'submit' }),
    );
    expect(screen.getByText(/A document can no longer be referred to/)).toBeTruthy();
    expect(screen.getByTestId('respond-refused-answer')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('respond-dismiss'));
    expect(handlers.onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/invalid_document/)).toBeNull();
  });

  it('offers only the way back after a terminal refusal', async () => {
    await render(
      view({ name: 'refused', draft: typed, refusal: 'already_submitted', during: 'submit' }),
    );
    expect(screen.getByText(/already been answered/)).toBeTruthy();
    expect(screen.queryByTestId('respond-dismiss')).toBeNull();
    expect(screen.queryByTestId('respond-submit')).toBeNull();
    expect(screen.getByTestId('respond-back')).toBeTruthy();
  });

  it('keeps a failed submission ready to try again with the safe message', async () => {
    await render(
      view({ name: 'failed', draft: typed, error: new SafeError('network'), during: 'submit' }),
    );
    expect(screen.getByText(/The answer was not submitted/)).toBeTruthy();
    expect(screen.getByText(/We could not reach HIVE/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('respond-retry'));
    expect(handlers.onTryAgain).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('respond-dismiss'));
    expect(handlers.onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('AnswerView outside the flow', () => {
  it('explains, with no field or control, when an answer may not be written here', async () => {
    await render(view(initialAnswerState(null), { canAnswer: false }));
    expect(screen.getByTestId('respond-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('respond-text')).toBeNull();
    expect(screen.queryByTestId('respond-submit')).toBeNull();
    expect(screen.getByTestId('respond-back')).toBeTruthy();
  });

  it.each([
    ['loading', 'respond-loading'],
    ['offline', 'respond-offline'],
    ['denied', 'respond-denied'],
    ['stale_scope', 'respond-stale'],
  ] as const)('shows the %s state explicitly', async (state, testID) => {
    await render(view(initialAnswerState(null), { state, request: undefined }));
    expect(screen.getByTestId(testID)).toBeTruthy();
  });

  it('says a foreign id is not here, never that it exists elsewhere', async () => {
    await render(view(initialAnswerState(null), { state: 'empty', request: null }));
    expect(screen.getByTestId('respond-empty')).toBeTruthy();
    for (const leak of ['another workspace', 'no permission', 'not authorized', 'exists']) {
      expect(screen.queryByText(new RegExp(leak, 'i'))).toBeNull();
    }
  });
});
