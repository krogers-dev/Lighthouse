import { SafeError } from '@/core/errors';

import {
  type DeletionFlowEvent,
  type DeletionFlowState,
  deletionReducer,
  initialDeletionState,
  isStaleDeletionRefusal,
} from '../deletion-flow';

function run(events: DeletionFlowEvent[], from: DeletionFlowState = initialDeletionState) {
  return events.reduce(deletionReducer, from);
}

describe('deletionReducer', () => {
  it('confirms, runs, and settles a request; done is dismissed by the person', () => {
    const confirming = run([{ type: 'ACTION_REQUESTED', action: 'request' }]);
    expect(confirming).toEqual({ name: 'confirming', action: 'request' });
    const running = deletionReducer(confirming, { type: 'STARTED' });
    expect(running).toEqual({ name: 'running', action: 'request' });
    const done = deletionReducer(running, {
      type: 'SUCCEEDED',
      receipt: { requestId: 'r1', status: 'REQUESTED', replayed: false },
    });
    expect(done).toMatchObject({ name: 'done', action: 'request' });
    expect(deletionReducer(done, { type: 'DISMISSED' })).toEqual({ name: 'idle' });
    expect(deletionReducer(done, { type: 'STARTED' })).toBe(done);
  });

  it('cancels back to idle, and keeps a failure ready to try again or dismiss', () => {
    const confirming = run([{ type: 'ACTION_REQUESTED', action: 'withdraw' }]);
    expect(deletionReducer(confirming, { type: 'CANCELED' })).toEqual({ name: 'idle' });
    const failed = run(
      [{ type: 'STARTED' }, { type: 'FAILED', error: new SafeError('network') }],
      confirming,
    );
    expect(failed).toMatchObject({ name: 'failed', action: 'withdraw' });
    expect(deletionReducer(failed, { type: 'STARTED' })).toEqual({
      name: 'running',
      action: 'withdraw',
    });
    expect(deletionReducer(failed, { type: 'DISMISSED' })).toEqual({ name: 'idle' });
  });

  it('words a refusal and returns to idle on dismiss', () => {
    const refused = run([
      { type: 'ACTION_REQUESTED', action: 'request' },
      { type: 'STARTED' },
      { type: 'REFUSED', refusal: 'already_requested' },
    ]);
    expect(refused).toEqual({ name: 'refused', action: 'request', refusal: 'already_requested' });
    expect(deletionReducer(refused, { type: 'DISMISSED' })).toEqual({ name: 'idle' });
  });

  it('ignores events without meaning in the current state', () => {
    expect(deletionReducer(initialDeletionState, { type: 'STARTED' })).toBe(initialDeletionState);
    const running = run([{ type: 'ACTION_REQUESTED', action: 'request' }, { type: 'STARTED' }]);
    expect(deletionReducer(running, { type: 'CANCELED' })).toBe(running);
  });
});

describe('isStaleDeletionRefusal', () => {
  it('sends the two server-state refusals to a reload and the rest to a dismiss', () => {
    expect(isStaleDeletionRefusal('already_requested')).toBe(true);
    expect(isStaleDeletionRefusal('no_open_request')).toBe(true);
    expect(isStaleDeletionRefusal('invalid_idempotency_key')).toBe(false);
  });
});
