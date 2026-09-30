import { SafeError } from '@/core/errors';

import {
  type AddDocumentState,
  addDocumentReducer,
  canChoose,
  canSend,
  initialAddDocumentState,
  isBusy,
} from '../add-document-flow';
import type { CheckedDocument, PickedDocument } from '../document-rules';

const picked: PickedDocument = {
  uri: 'file:///cache/a.pdf',
  name: 'a (Synthetic).pdf',
  byteSize: 10,
  mimeType: 'application/pdf',
};

const document: CheckedDocument = {
  uri: picked.uri,
  displayName: picked.name,
  byteSize: 10,
  mimeType: 'application/pdf',
};

const digest = 'ab'.repeat(32);

function run(events: Parameters<typeof addDocumentReducer>[1][]): AddDocumentState {
  return events.reduce(addDocumentReducer, initialAddDocumentState);
}

describe('addDocumentReducer', () => {
  it('walks the happy path from the picker to quarantine', () => {
    const checked = run([
      { type: 'PICK_STARTED' },
      { type: 'PICKED', picked },
      { type: 'CHECKED', document, digest },
    ]);
    expect(checked).toEqual({ name: 'checked', document, digest });
    expect(canSend(checked)).toBe(true);
    const sending = addDocumentReducer(checked, { type: 'SEND_STARTED' });
    expect(sending).toEqual({ name: 'sending', document, digest, step: 'reserving' });
    expect(isBusy(sending)).toBe(true);
    const transferring = addDocumentReducer(sending, { type: 'SEND_STEP', step: 'transferring' });
    expect(transferring).toMatchObject({ step: 'transferring' });
    const received = addDocumentReducer(transferring, {
      type: 'SENT',
      receivedAt: '2026-09-28T15:00:00Z',
    });
    expect(received).toEqual({ name: 'received', document, receivedAt: '2026-09-28T15:00:00Z' });
    expect(canChoose(received)).toBe(true);
    expect(canSend(received)).toBe(false);
  });

  it('returns to idle when the picker is canceled, with nothing kept', () => {
    expect(run([{ type: 'PICK_STARTED' }, { type: 'PICK_CANCELED' }])).toEqual({ name: 'idle' });
  });

  it('refuses at the local check without a document to re-send', () => {
    const refused = run([
      { type: 'PICK_STARTED' },
      { type: 'PICKED', picked },
      { type: 'CHECK_REFUSED', refusal: 'file_too_large' },
    ]);
    expect(refused).toEqual({ name: 'refused', refusal: 'file_too_large', document: null });
    expect(canSend(refused)).toBe(false);
    // A refused document is never re-sent as-is: only a new choice moves on.
    expect(addDocumentReducer(refused, { type: 'SEND_STARTED' })).toBe(refused);
    expect(addDocumentReducer(refused, { type: 'PICK_STARTED' })).toEqual({ name: 'picking' });
  });

  it('keeps the checked document on a server refusal, so the reason is readable beside it', () => {
    const refused = run([
      { type: 'PICK_STARTED' },
      { type: 'PICKED', picked },
      { type: 'CHECKED', document, digest },
      { type: 'SEND_STARTED' },
      { type: 'SEND_REFUSED', refusal: 'request_closed' },
    ]);
    expect(refused).toEqual({ name: 'refused', refusal: 'request_closed', document });
    expect(canSend(refused)).toBe(false);
  });

  it('keeps document and digest on a transient failure so the same attempt can be re-sent', () => {
    const failed = run([
      { type: 'PICK_STARTED' },
      { type: 'PICKED', picked },
      { type: 'CHECKED', document, digest },
      { type: 'SEND_STARTED' },
      { type: 'SEND_FAILED', error: new SafeError('network') },
    ]);
    expect(failed).toMatchObject({ name: 'failed', document, digest });
    expect(canSend(failed)).toBe(true);
    expect(addDocumentReducer(failed, { type: 'SEND_STARTED' })).toEqual({
      name: 'sending',
      document,
      digest,
      step: 'reserving',
    });
  });

  it('a failure before any document was checked offers only a new choice', () => {
    const failed = run([
      { type: 'PICK_STARTED' },
      { type: 'PICK_FAILED', error: new SafeError('unknown') },
    ]);
    expect(failed).toEqual({
      name: 'failed',
      error: expect.any(SafeError),
      document: null,
      digest: null,
    });
    expect(canSend(failed)).toBe(false);
    expect(canChoose(failed)).toBe(true);
  });

  it('ignores events that have no meaning in the current state (fail closed)', () => {
    const idle = initialAddDocumentState;
    expect(addDocumentReducer(idle, { type: 'SENT', receivedAt: null })).toBe(idle);
    expect(addDocumentReducer(idle, { type: 'CHECKED', document, digest })).toBe(idle);
    const sending = run([
      { type: 'PICK_STARTED' },
      { type: 'PICKED', picked },
      { type: 'CHECKED', document, digest },
      { type: 'SEND_STARTED' },
    ]);
    expect(addDocumentReducer(sending, { type: 'PICK_STARTED' })).toBe(sending);
    expect(canChoose(sending)).toBe(false);
  });

  it('RESET returns to idle from anywhere', () => {
    const received = run([
      { type: 'PICK_STARTED' },
      { type: 'PICKED', picked },
      { type: 'CHECKED', document, digest },
      { type: 'SEND_STARTED' },
      { type: 'SENT', receivedAt: null },
    ]);
    expect(addDocumentReducer(received, { type: 'RESET' })).toEqual({ name: 'idle' });
  });
});
