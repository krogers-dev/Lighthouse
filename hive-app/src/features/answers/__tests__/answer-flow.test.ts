import { SafeError } from '@/core/errors';
import type { DraftReceipt, RequestAnswer } from '@/data/supabase/answers';

import {
  type AnswerFlowEvent,
  type AnswerFlowState,
  answerReducer,
  canKeepEditing,
  canSave,
  canSubmit,
  initialAnswerState,
  isBusy,
  isDirty,
  isStaleRefusal,
  isTerminalRefusal,
  needsSave,
} from '../answer-flow';

const receipt: DraftReceipt = {
  answerId: 'ans-1',
  status: 'DRAFT',
  version: 1,
  updatedAt: '2026-09-28T16:00:00Z',
};

const existing: RequestAnswer = {
  id: 'ans-1',
  requestId: 'dddddddd-0000-4000-8000-0000000000a3',
  status: 'DRAFT',
  body: 'Yes (Synthetic).',
  version: 2,
  citedDocumentIds: ['doc-a'],
  submittedAt: null,
  updatedAt: '2026-09-28T16:00:00Z',
};

function run(events: AnswerFlowEvent[], from: AnswerFlowState = initialAnswerState(null)) {
  return events.reduce(answerReducer, from);
}

describe('initialAnswerState', () => {
  it('starts empty with nothing to save, or from the server draft with nothing dirty', () => {
    const empty = initialAnswerState(null);
    expect(empty).toEqual({
      name: 'editing',
      draft: { body: '', citedDocumentIds: [], saved: null },
      notice: null,
    });
    expect(isDirty(empty.draft)).toBe(false);
    expect(needsSave(empty.draft)).toBe(true);

    const resumed = initialAnswerState(existing);
    expect(resumed.draft.body).toBe('Yes (Synthetic).');
    expect(resumed.draft.saved?.version).toBe(2);
    expect(isDirty(resumed.draft)).toBe(false);
    expect(needsSave(resumed.draft)).toBe(false);
  });

  it('treats a submitted answer as nothing to edit', () => {
    const state = initialAnswerState({
      ...existing,
      status: 'SUBMITTED',
      submittedAt: '2026-09-28T16:05:00Z',
    });
    expect(state.draft.saved).toBeNull();
    expect(state.draft.body).toBe('');
  });
});

describe('answerReducer: editing and saving', () => {
  it('records text and toggles citations, and each edit makes the draft dirty', () => {
    const state = run([
      { type: 'TEXT_CHANGED', body: 'Yes' },
      { type: 'CITATION_TOGGLED', documentId: 'doc-a' },
      { type: 'CITATION_TOGGLED', documentId: 'doc-b' },
      { type: 'CITATION_TOGGLED', documentId: 'doc-a' },
    ]);
    expect(state).toMatchObject({
      name: 'editing',
      draft: { body: 'Yes', citedDocumentIds: ['doc-b'] },
    });
    expect(canSave(state)).toBe(true);
    expect(canSubmit(state)).toBe(true);
  });

  it('saves only a dirty draft, then returns to editing with the receipt and a notice', () => {
    expect(run([{ type: 'SAVE_STARTED' }]).name).toBe('editing');
    const saving = run([{ type: 'TEXT_CHANGED', body: 'Yes' }, { type: 'SAVE_STARTED' }]);
    expect(saving.name).toBe('saving');
    expect(isBusy(saving)).toBe(true);
    const saved = answerReducer(saving, {
      type: 'SAVED',
      receipt,
      body: 'Yes',
      citedDocumentIds: [],
    });
    expect(saved).toMatchObject({
      name: 'editing',
      notice: 'saved',
      draft: { body: 'Yes', saved: { answerId: 'ans-1', version: 1, body: 'Yes' } },
    });
    expect(isDirty(saved.draft)).toBe(false);
    expect(canSave(saved)).toBe(false);
    // The next edit clears the notice and dirties the draft again.
    const edited = answerReducer(saved, { type: 'TEXT_CHANGED', body: 'Yes, it matches' });
    expect(edited).toMatchObject({ name: 'editing', notice: null });
    expect(isDirty(edited.draft)).toBe(true);
  });

  it('a save refusal or failure keeps the draft and says which step it was', () => {
    const saving = run([{ type: 'TEXT_CHANGED', body: 'Yes' }, { type: 'SAVE_STARTED' }]);
    expect(answerReducer(saving, { type: 'SAVE_REFUSED', refusal: 'request_changed' })).toEqual({
      name: 'refused',
      draft: saving.draft,
      refusal: 'request_changed',
      during: 'save',
    });
    const failed = answerReducer(saving, { type: 'SAVE_FAILED', error: new SafeError('network') });
    expect(failed).toMatchObject({ name: 'failed', during: 'save' });
    // A failed save can be tried again as-is, or edited.
    expect(answerReducer(failed, { type: 'SAVE_STARTED' }).name).toBe('saving');
    expect(answerReducer(failed, { type: 'DISMISSED' })).toMatchObject({ name: 'editing' });
  });
});

describe('answerReducer: submitting', () => {
  const typed = run([{ type: 'TEXT_CHANGED', body: 'Yes' }]);

  it('walks request -> confirm -> save -> submit -> submitted', () => {
    const confirming = answerReducer(typed, { type: 'SUBMIT_REQUESTED' });
    expect(confirming.name).toBe('confirming');
    expect(canSubmit(confirming)).toBe(false);
    const submitting = answerReducer(confirming, { type: 'SUBMIT_STARTED', step: 'saving' });
    expect(submitting).toMatchObject({ name: 'submitting', step: 'saving' });
    expect(isBusy(submitting)).toBe(true);
    const savedFirst = answerReducer(submitting, {
      type: 'SAVED',
      receipt,
      body: 'Yes',
      citedDocumentIds: [],
    });
    expect(savedFirst).toMatchObject({
      name: 'submitting',
      step: 'submitting',
      draft: { saved: { answerId: 'ans-1', version: 1 } },
    });
    const submitted = answerReducer(savedFirst, {
      type: 'SUBMITTED',
      submittedAt: '2026-09-28T16:05:00Z',
    });
    expect(submitted).toMatchObject({ name: 'submitted', submittedAt: '2026-09-28T16:05:00Z' });
    // Settled: nothing moves it.
    expect(answerReducer(submitted, { type: 'TEXT_CHANGED', body: 'again' })).toBe(submitted);
    expect(answerReducer(submitted, { type: 'DISMISSED' })).toBe(submitted);
  });

  it('cancels back to editing with the draft intact', () => {
    const confirming = answerReducer(typed, { type: 'SUBMIT_REQUESTED' });
    expect(answerReducer(confirming, { type: 'SUBMIT_CANCELED' })).toEqual({
      name: 'editing',
      draft: typed.draft,
      notice: null,
    });
  });

  it('a local refusal from editing, and a server refusal or failure while submitting, keep the draft', () => {
    const local = answerReducer(typed, { type: 'SUBMIT_REFUSED', refusal: 'empty_answer' });
    expect(local).toMatchObject({ name: 'refused', refusal: 'empty_answer', during: 'submit' });
    expect(answerReducer(local, { type: 'DISMISSED' })).toMatchObject({ name: 'editing' });

    const submitting = run(
      [{ type: 'SUBMIT_REQUESTED' }, { type: 'SUBMIT_STARTED', step: 'submitting' }],
      typed,
    );
    const refused = answerReducer(submitting, {
      type: 'SUBMIT_REFUSED',
      refusal: 'already_submitted',
    });
    expect(refused).toMatchObject({ name: 'refused', refusal: 'already_submitted' });
    // Terminal: keep editing is not offered and not honored.
    expect(answerReducer(refused, { type: 'DISMISSED' })).toBe(refused);

    const failed = answerReducer(submitting, {
      type: 'SUBMIT_FAILED',
      error: new SafeError('network'),
    });
    expect(failed).toMatchObject({ name: 'failed', during: 'submit' });
    expect(answerReducer(failed, { type: 'SUBMIT_STARTED', step: 'submitting' }).name).toBe(
      'submitting',
    );
    // The wrong retry for the step is ignored, never invented.
    expect(answerReducer(failed, { type: 'SAVE_STARTED' })).toBe(failed);
  });
});

describe('refusal classes', () => {
  it('names which refusals end the screen, which need a refresh, and which can be edited past', () => {
    for (const refusal of ['request_not_found', 'request_closed', 'already_submitted'] as const) {
      expect(isTerminalRefusal(refusal)).toBe(true);
      expect(canKeepEditing(refusal)).toBe(false);
    }
    for (const refusal of ['request_changed', 'answer_changed'] as const) {
      expect(isStaleRefusal(refusal)).toBe(true);
      expect(canKeepEditing(refusal)).toBe(false);
    }
    for (const refusal of [
      'invalid_text',
      'answer_too_long',
      'too_many_citations',
      'invalid_document',
      'empty_answer',
      'invalid_idempotency_key',
    ] as const) {
      expect(canKeepEditing(refusal)).toBe(true);
    }
  });
});
