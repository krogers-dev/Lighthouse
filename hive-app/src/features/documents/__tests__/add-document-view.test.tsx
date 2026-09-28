import { fireEvent, render, screen } from '@testing-library/react-native';

import { SafeError } from '@/core/errors';
import type { RequestDetail } from '@/data/supabase/repositories';

import { AddDocumentView, type AddDocumentViewProps } from '../AddDocumentView';
import type { AddDocumentState } from '../add-document-flow';
import type { CheckedDocument } from '../document-rules';

const request: RequestDetail = {
  id: 'dddddddd-0000-4000-8000-0000000000a1',
  title: 'Bank statement for the closing month (Synthetic)',
  detail: 'The final month statement is needed to complete the records (Synthetic).',
  status: 'OPEN',
  ownerRole: 'client_user',
  requestedOn: '2026-08-10',
  dueOn: '2026-09-10',
  version: 1,
};

const document: CheckedDocument = {
  uri: 'file:///cache/statement.pdf',
  displayName: 'statement (Synthetic).pdf',
  byteSize: 184320,
  mimeType: 'application/pdf',
};

const base: Omit<AddDocumentViewProps, 'flow'> = {
  state: 'ready',
  request,
  canAdd: true,
  onRetry: jest.fn(),
  onSwitchScope: jest.fn(),
  onChoose: jest.fn(),
  onSend: jest.fn(),
  onBack: jest.fn(),
};

function view(flow: AddDocumentState, overrides: Partial<AddDocumentViewProps> = {}) {
  return <AddDocumentView {...base} {...overrides} flow={flow} />;
}

describe('AddDocumentView', () => {
  it('opens on the request with the rules stated and one primary action: choose a file', async () => {
    const onChoose = jest.fn();
    await render(view({ name: 'idle' }, { onChoose }));
    expect(screen.getByTestId('add-document-request-title')).toHaveTextContent(request.title);
    expect(screen.getByText(/PDF, PNG, JPEG or CSV, up to 20 MB/)).toBeTruthy();
    fireEvent.press(screen.getByTestId('add-document-choose'));
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('add-document-send')).toBeNull();
    expect(screen.getByTestId('add-document-back')).toBeTruthy();
  });

  it('shows the checked file with name, type and size, and says nothing was sent yet', async () => {
    const onSend = jest.fn();
    await render(view({ name: 'checked', document, digest: 'ab'.repeat(32) }, { onSend }));
    expect(
      screen.getByLabelText(
        'statement (Synthetic).pdf. PDF, 180 KB. Checked on this phone. Nothing has been sent yet.',
      ),
    ).toBeTruthy();
    fireEvent.press(screen.getByTestId('add-document-send'));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Choose a different file')).toBeTruthy();
  });

  it('while transferring, shows the step and offers no control at all, including back', async () => {
    await render(
      view({ name: 'sending', document, digest: 'ab'.repeat(32), step: 'transferring' }),
    );
    expect(screen.getByTestId('add-document-sending')).toBeTruthy();
    expect(screen.getByText('Transferring to Honeybee')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('says received, being checked, and never approved or filed', async () => {
    await render(view({ name: 'received', document, receivedAt: '2026-09-28T15:00:00Z' }));
    expect(screen.getByTestId('add-document-received')).toBeTruthy();
    expect(screen.getByText(/received, being checked/)).toBeTruthy();
    for (const forbidden of ['Approved', 'Filed', 'Final']) {
      expect(screen.queryByText(new RegExp(`\\b${forbidden}\\b`))).toBeNull();
    }
    expect(screen.queryByTestId('add-document-send')).toBeNull();
    expect(screen.getByTestId('add-document-back')).toBeTruthy();
  });

  it('words a server refusal for the person, with the checked file beside it', async () => {
    await render(view({ name: 'refused', refusal: 'request_closed', document }));
    expect(screen.getByTestId('add-document-refused')).toBeTruthy();
    expect(screen.getByText(/This request is no longer taking documents/)).toBeTruthy();
    expect(screen.getByTestId('add-document-refused-document')).toBeTruthy();
    expect(screen.queryByTestId('add-document-send')).toBeNull();
    expect(screen.getByText('Choose a different file')).toBeTruthy();
    expect(screen.queryByText(/request_closed/)).toBeNull();
  });

  it('words a local refusal without a file to re-send', async () => {
    await render(view({ name: 'refused', refusal: 'file_too_large', document: null }));
    expect(screen.getByText(/That file is too large/)).toBeTruthy();
    expect(screen.queryByTestId('add-document-refused-document')).toBeNull();
  });

  it('keeps a failed transfer sendable again with the safe message', async () => {
    await render(
      view({ name: 'failed', error: new SafeError('network'), document, digest: 'ab'.repeat(32) }),
    );
    expect(screen.getByTestId('add-document-failed')).toBeTruthy();
    expect(screen.getByText(/We could not reach HIVE/)).toBeTruthy();
    expect(screen.getByText('Send again')).toBeTruthy();
    expect(screen.getByTestId('add-document-failed-document')).toBeTruthy();
  });

  it('explains, with no control, when a document may not be added here', async () => {
    await render(view({ name: 'idle' }, { canAdd: false }));
    expect(screen.getByTestId('add-document-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('add-document-choose')).toBeNull();
    expect(screen.getByTestId('add-document-back')).toBeTruthy();
  });

  it.each([
    ['loading', 'add-document-loading'],
    ['offline', 'add-document-offline'],
    ['denied', 'add-document-denied'],
    ['stale_scope', 'add-document-stale'],
  ] as const)('shows the %s state explicitly', async (state, testID) => {
    await render(view({ name: 'idle' }, { state, request: undefined }));
    expect(screen.getByTestId(testID)).toBeTruthy();
  });

  it('says a foreign id is not here, never that it exists elsewhere', async () => {
    await render(view({ name: 'idle' }, { state: 'empty', request: null }));
    expect(screen.getByTestId('add-document-empty')).toBeTruthy();
    for (const leak of ['another workspace', 'no permission', 'not authorized', 'exists']) {
      expect(screen.queryByText(new RegExp(leak, 'i'))).toBeNull();
    }
  });
});
