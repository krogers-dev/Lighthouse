import { SafeError } from '@/core/errors';

import {
  type ReviewFlowEvent,
  type ReviewFlowState,
  canAct,
  initialReviewState,
  isBusy,
  isStaleRefusal,
  reviewReducer,
} from '../review-flow';

function run(events: ReviewFlowEvent[], from: ReviewFlowState = initialReviewState) {
  return events.reduce(reviewReducer, from);
}

const EMPTY_FILING = { documentId: null, driveFileId: '', drivePath: '' };

describe('reviewReducer', () => {
  it('collects a verdict and a note while idle, then confirms, runs, and settles', () => {
    const chosen = run([
      { type: 'VERDICT_CHOSEN', verdict: 'RETURN' },
      { type: 'NOTE_CHANGED', note: 'Missing page (Synthetic)' },
    ]);
    expect(chosen).toEqual({
      name: 'idle',
      draft: { verdict: 'RETURN', note: 'Missing page (Synthetic)', filing: EMPTY_FILING },
    });
    expect(canAct(chosen)).toBe(true);
    const confirming = reviewReducer(chosen, {
      type: 'ACTION_REQUESTED',
      action: 'record_verdict',
    });
    expect(confirming).toMatchObject({ name: 'confirming', action: 'record_verdict' });
    expect(canAct(confirming)).toBe(false);
    const running = reviewReducer(confirming, { type: 'STARTED' });
    expect(isBusy(running)).toBe(true);
    const done = reviewReducer(running, {
      type: 'SUCCEEDED',
      receipt: { caseStatus: 'RETURNED', caseVersion: 4 },
    });
    expect(done).toMatchObject({ name: 'done', receipt: { caseStatus: 'RETURNED' } });
    // Settled: the screen reloads; nothing moves this flow again.
    expect(reviewReducer(done, { type: 'DISMISSED' })).toBe(done);
  });

  it('cancels back to idle with the draft intact', () => {
    const confirming = run([
      { type: 'NOTE_CHANGED', note: 'kept' },
      { type: 'ACTION_REQUESTED', action: 'freeze' },
    ]);
    expect(reviewReducer(confirming, { type: 'CANCELED' })).toEqual({
      name: 'idle',
      draft: { verdict: null, note: 'kept', filing: EMPTY_FILING },
    });
  });

  it('keeps the draft through a refusal or a failure, and lets a failure be tried again', () => {
    const running = run([
      { type: 'VERDICT_CHOSEN', verdict: 'HOLD' },
      { type: 'ACTION_REQUESTED', action: 'record_verdict' },
      { type: 'STARTED' },
    ]);
    const refused = reviewReducer(running, { type: 'REFUSED', refusal: 'conflict_of_interest' });
    expect(refused).toMatchObject({ name: 'refused', draft: { verdict: 'HOLD' } });
    expect(reviewReducer(refused, { type: 'DISMISSED' })).toMatchObject({ name: 'idle' });
    const failed = reviewReducer(running, { type: 'FAILED', error: new SafeError('network') });
    expect(failed).toMatchObject({ name: 'failed', action: 'record_verdict' });
    expect(reviewReducer(failed, { type: 'STARTED' })).toMatchObject({ name: 'running' });
    expect(reviewReducer(failed, { type: 'DISMISSED' })).toMatchObject({ name: 'idle' });
  });

  it('records a local refusal from idle without any round trip', () => {
    const refused = run([
      { type: 'LOCALLY_REFUSED', action: 'record_verdict', refusal: 'verdict_missing' },
    ]);
    expect(refused).toMatchObject({ name: 'refused', refusal: 'verdict_missing' });
  });

  it('collects the filing receipt fields while idle and keeps them through a confirmation', () => {
    const drafted = run([
      { type: 'FILING_DOCUMENT_CHOSEN', documentId: 'doc-1' },
      { type: 'FILING_FILE_ID_CHANGED', driveFileId: 'drv-synthetic-0001' },
      { type: 'FILING_PATH_CHANGED', drivePath: '/Clients/Harbor Light Bakery LLC (Synthetic)' },
    ]);
    expect(drafted).toEqual({
      name: 'idle',
      draft: {
        verdict: null,
        note: '',
        filing: {
          documentId: 'doc-1',
          driveFileId: 'drv-synthetic-0001',
          drivePath: '/Clients/Harbor Light Bakery LLC (Synthetic)',
        },
      },
    });
    const confirming = reviewReducer(drafted, {
      type: 'ACTION_REQUESTED',
      action: 'record_filing',
    });
    expect(confirming).toMatchObject({ name: 'confirming', action: 'record_filing' });
    expect(reviewReducer(confirming, { type: 'CANCELED' })).toEqual(drafted);
    expect(reviewReducer(confirming, { type: 'FILING_PATH_CHANGED', drivePath: 'x' })).toBe(
      confirming,
    );
  });

  it('ignores events without meaning in the current state', () => {
    const running = run([{ type: 'ACTION_REQUESTED', action: 'approve' }, { type: 'STARTED' }]);
    expect(reviewReducer(running, { type: 'VERDICT_CHOSEN', verdict: 'PASS' })).toBe(running);
    expect(reviewReducer(running, { type: 'CANCELED' })).toBe(running);
  });
});

describe('isStaleRefusal', () => {
  it('names the refusals a reload resolves, and leaves the rest to editing', () => {
    for (const refusal of [
      'case_changed',
      'package_changed',
      'digest_mismatch',
      'not_your_review',
      'case_not_approved',
      'document_not_approved',
      'receipt_exists',
    ] as const) {
      expect(isStaleRefusal(refusal)).toBe(true);
    }
    for (const refusal of [
      'conflict_of_interest',
      'note_too_long',
      'verdict_missing',
      'invalid_text',
      'document_missing',
      'document_not_filable',
      'invalid_file_id',
      'invalid_path',
    ] as const) {
      expect(isStaleRefusal(refusal)).toBe(false);
    }
  });
});
