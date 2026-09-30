import { SafeError } from '@/core/errors';

import {
  type CreationEvent,
  type CreationState,
  canEdit,
  creationReducer,
  initialCreationState,
  isCreationBusy,
  isStaleCreationRefusal,
} from '../intake-flow';

type Draft = { title: string };
type Result = { caseId: string };

function run(
  start: CreationState<Draft, Result>,
  events: CreationEvent<Draft, Result>[],
): CreationState<Draft, Result> {
  return events.reduce(creationReducer<Draft, Result>, start);
}

const idle = initialCreationState<Draft, Result>({ title: '' });

describe('creationReducer', () => {
  it('collects the draft while idle, then confirms, runs, and settles with the result', () => {
    const drafted = run(idle, [{ type: 'DRAFT_CHANGED', draft: { title: 'Books (Synthetic)' } }]);
    expect(drafted).toEqual({ name: 'idle', draft: { title: 'Books (Synthetic)' } });
    expect(canEdit(drafted)).toBe(true);
    const confirming = creationReducer(drafted, { type: 'CONFIRM_REQUESTED' });
    expect(confirming.name).toBe('confirming');
    expect(canEdit(confirming)).toBe(false);
    const running = creationReducer(confirming, { type: 'STARTED' });
    expect(isCreationBusy(running)).toBe(true);
    const done = creationReducer(running, { type: 'SUCCEEDED', result: { caseId: 'c-1' } });
    expect(done).toEqual({
      name: 'done',
      draft: { title: 'Books (Synthetic)' },
      result: { caseId: 'c-1' },
    });
    // Terminal: nothing moves a settled creation.
    expect(creationReducer(done, { type: 'DISMISSED' })).toBe(done);
    expect(creationReducer(done, { type: 'STARTED' })).toBe(done);
  });

  it('cancels back to idle with the draft intact, and refuses locally without a round trip', () => {
    const drafted = run(idle, [{ type: 'DRAFT_CHANGED', draft: { title: 'kept' } }]);
    const canceled = run(drafted, [{ type: 'CONFIRM_REQUESTED' }, { type: 'CANCELED' }]);
    expect(canceled).toEqual({ name: 'idle', draft: { title: 'kept' } });
    const refused = creationReducer(drafted, { type: 'LOCALLY_REFUSED', refusal: 'title_missing' });
    expect(refused).toEqual({
      name: 'refused',
      draft: { title: 'kept' },
      refusal: 'title_missing',
    });
    expect(creationReducer(refused, { type: 'DISMISSED' })).toEqual({
      name: 'idle',
      draft: { title: 'kept' },
    });
  });

  it('keeps the draft through a server refusal and a failure, and a failure can be retried', () => {
    const running = run(idle, [
      { type: 'DRAFT_CHANGED', draft: { title: 'Books (Synthetic)' } },
      { type: 'CONFIRM_REQUESTED' },
      { type: 'STARTED' },
    ]);
    const refused = creationReducer(running, { type: 'REFUSED', refusal: 'too_many_drafts' });
    expect(refused).toMatchObject({ name: 'refused', refusal: 'too_many_drafts' });
    expect(refused.draft).toEqual({ title: 'Books (Synthetic)' });
    const failed = creationReducer(running, { type: 'FAILED', error: new SafeError('network') });
    expect(failed).toMatchObject({ name: 'failed', draft: { title: 'Books (Synthetic)' } });
    expect(creationReducer(failed, { type: 'STARTED' }).name).toBe('running');
    expect(creationReducer(failed, { type: 'DISMISSED' })).toEqual({
      name: 'idle',
      draft: { title: 'Books (Synthetic)' },
    });
  });

  it('ignores an event without meaning in the current state: the flow fails closed', () => {
    expect(creationReducer(idle, { type: 'STARTED' })).toBe(idle);
    expect(creationReducer(idle, { type: 'SUCCEEDED', result: { caseId: 'c' } })).toBe(idle);
    const confirming = creationReducer(idle, { type: 'CONFIRM_REQUESTED' });
    expect(creationReducer(confirming, { type: 'DRAFT_CHANGED', draft: { title: 'x' } })).toBe(
      confirming,
    );
  });

  it('names the refusals after which the screen is behind the server', () => {
    expect(isStaleCreationRefusal('case_changed')).toBe(true);
    expect(isStaleCreationRefusal('case_not_open_for_requests')).toBe(true);
    expect(isStaleCreationRefusal('too_many_drafts')).toBe(true);
    expect(isStaleCreationRefusal('invalid_title')).toBe(false);
    expect(isStaleCreationRefusal('title_missing')).toBe(false);
  });
});
