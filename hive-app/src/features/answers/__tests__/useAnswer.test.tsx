/** The answer hook against a fake writer. Driven through a probe
 * component the way the other hooks are tested here, so state changes
 * flow through React's own scheduling rather than a hook harness. Every
 * event is awaited inside act: this testing-library version's APIs are
 * asynchronous, and an unawaited event leaks into the next test. */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';

import { SafeError } from '@/core/errors';
import type { RandomSource } from '@/core/ids';
import {
  AnswerRefusedError,
  type AnswerWriter,
  type DraftReceipt,
  type SaveDraftInput,
  type SubmitInput,
  type SubmitReceipt,
} from '@/data/supabase/answers';
import type { ScopeKey } from '@/tenancy/scope-key';

import { type AnswerDeps, useAnswer } from '../useAnswer';

const scope = {
  environmentId: '11111111-0000-4000-8000-000000000001',
  clientId: 'aaaaaaaa-0000-4000-8000-000000000001',
  entityId: 'aaaaaaaa-1111-4000-8000-000000000001',
  membershipId: 'mmmmmmmm-0000-4000-8000-000000000001',
} as unknown as ScopeKey;

const request = { id: 'dddddddd-0000-4000-8000-0000000000a3', version: 2 };

/** Deterministic, distinct bytes per call, so keys differ when they must. */
function makeRandom(): RandomSource {
  let calls = 0;
  return {
    fill(bytes) {
      calls += 1;
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = (calls * 17 + i) & 0xff;
    },
  };
}

class FakeWriter implements AnswerWriter {
  saves: SaveDraftInput[] = [];
  submits: SubmitInput[] = [];
  saveError: unknown = null;
  submitError: unknown = null;
  version = 0;
  async saveDraft(_scope: ScopeKey, input: SaveDraftInput): Promise<DraftReceipt> {
    this.saves.push(input);
    if (this.saveError) throw this.saveError;
    this.version += 1;
    return {
      answerId: 'ans-1',
      status: 'DRAFT',
      version: this.version,
      updatedAt: `2026-09-28T16:0${this.version}:00Z`,
    };
  }
  async submit(input: SubmitInput): Promise<SubmitReceipt> {
    this.submits.push(input);
    if (this.submitError) throw this.submitError;
    return {
      answerId: input.answerId,
      status: 'SUBMITTED',
      version: input.answerVersion + 1,
      submittedAt: '2026-09-28T16:05:00Z',
    };
  }
}

/** Renders every observable fact of the flow as text, and the actions as
 * pressable text. */
function Probe({ deps }: { deps: AnswerDeps }): React.JSX.Element {
  const flow = useAnswer(deps);
  const s = flow.state;
  return (
    <>
      <Text testID="name">{s.name}</Text>
      <Text testID="body">{s.draft.body}</Text>
      <Text testID="cited">{s.draft.citedDocumentIds.join(',')}</Text>
      <Text testID="saved">{s.draft.saved ? String(s.draft.saved.version) : 'none'}</Text>
      <Text testID="refusal">{s.name === 'refused' ? s.refusal : ''}</Text>
      <Text testID="during">{s.name === 'refused' || s.name === 'failed' ? s.during : ''}</Text>
      <Text testID="notice">{s.name === 'editing' ? (s.notice ?? '') : ''}</Text>
      <Text testID="type" onPress={() => flow.setText('Yes, it matches.\u0001 (Synthetic)')}>
        type
      </Text>
      <Text testID="clear" onPress={() => flow.setText('   ')}>
        clear
      </Text>
      <Text testID="cite" onPress={() => flow.toggleCitation('doc-1')}>
        cite
      </Text>
      <Text testID="save" onPress={flow.save}>
        save
      </Text>
      <Text testID="submit" onPress={flow.requestSubmit}>
        submit
      </Text>
      <Text testID="confirm" onPress={flow.confirmSubmit}>
        confirm
      </Text>
      <Text testID="cancel" onPress={flow.cancelSubmit}>
        cancel
      </Text>
      <Text testID="dismiss" onPress={flow.dismiss}>
        dismiss
      </Text>
      <Text testID="retry" onPress={flow.retry}>
        retry
      </Text>
    </>
  );
}

async function press(testID: string): Promise<void> {
  await act(async () => {
    await fireEvent.press(screen.getByTestId(testID));
  });
}

function text(testID: string): string {
  return String(screen.getByTestId(testID).props.children);
}

/** Wait until the flow reaches `name`. */
async function reaches(name: string): Promise<void> {
  await waitFor(() => expect(text('name')).toBe(name), { timeout: 5000 });
}

async function mount(writer: FakeWriter, extra: Partial<AnswerDeps> = {}) {
  const deps: AnswerDeps = {
    scope,
    request,
    existing: null,
    writer,
    random: makeRandom(),
    ...extra,
  };
  await render(<Probe deps={deps} />);
  return deps;
}

describe('useAnswer: drafts', () => {
  it('saves the sanitized text with the request version and no answer version, then names the version it was given', async () => {
    const writer = new FakeWriter();
    await mount(writer);
    await press('type');
    await press('cite');
    expect(text('body')).toBe('Yes, it matches. (Synthetic)');
    expect(text('cited')).toBe('doc-1');

    await press('save');
    await reaches('editing');
    await waitFor(() => expect(text('notice')).toBe('saved'));
    expect(writer.saves[0]).toEqual({
      requestId: request.id,
      requestVersion: 2,
      body: 'Yes, it matches. (Synthetic)',
      citedDocumentIds: ['doc-1'],
      answerVersion: null,
    });
    expect(text('saved')).toBe('1');

    // Clean now: a second save is a no-op until something changes.
    await press('save');
    expect(writer.saves).toHaveLength(1);
    await press('cite');
    await press('save');
    await waitFor(() => expect(writer.saves).toHaveLength(2));
    expect(writer.saves[1]).toMatchObject({ answerVersion: 1, citedDocumentIds: [] });
  });

  it('starts from the server draft and saves against its version', async () => {
    const writer = new FakeWriter();
    writer.version = 4;
    await mount(writer, {
      existing: {
        id: 'ans-1',
        requestId: request.id,
        status: 'DRAFT',
        body: 'Earlier (Synthetic).',
        version: 4,
        citedDocumentIds: ['doc-1'],
        submittedAt: null,
        updatedAt: '2026-09-28T15:00:00Z',
      },
    });
    expect(text('body')).toBe('Earlier (Synthetic).');
    expect(text('cited')).toBe('doc-1');
    expect(text('saved')).toBe('4');
    await press('type');
    await press('save');
    await waitFor(() => expect(writer.saves).toHaveLength(1));
    expect(writer.saves[0]).toMatchObject({ answerVersion: 4 });
  });

  it('words a stale refusal and offers no way past it but back', async () => {
    const writer = new FakeWriter();
    await mount(writer);
    await press('type');
    writer.saveError = new AnswerRefusedError('request_changed');
    await press('save');
    await reaches('refused');
    expect(text('refusal')).toBe('request_changed');
    expect(text('during')).toBe('save');
    // Stale: dismiss does nothing; the way back is the screen's. The
    // text is still there.
    await press('dismiss');
    expect(text('name')).toBe('refused');
    expect(text('body')).toBe('Yes, it matches. (Synthetic)');
  });

  it('a failed save keeps the text, routes an expired session, and is tried again on request', async () => {
    const writer = new FakeWriter();
    const onSessionExpired = jest.fn();
    await mount(writer, { onSessionExpired });
    await press('type');
    writer.saveError = new SafeError('auth_expired');
    await press('save');
    await reaches('failed');
    expect(text('during')).toBe('save');
    expect(onSessionExpired).toHaveBeenCalledTimes(1);

    writer.saveError = null;
    await press('retry');
    await reaches('editing');
    expect(text('saved')).toBe('1');
    expect(writer.saves).toHaveLength(2);
  });
});

describe('useAnswer: submission', () => {
  it('refuses a blank answer locally, before any round trip', async () => {
    const writer = new FakeWriter();
    await mount(writer);
    await press('clear');
    await press('submit');
    expect(text('name')).toBe('refused');
    expect(text('refusal')).toBe('empty_answer');
    expect(writer.saves).toHaveLength(0);
    expect(writer.submits).toHaveLength(0);
    await press('dismiss');
    expect(text('name')).toBe('editing');
  });

  it('saves first when the draft is dirty, submits with the saved id and version, and one key', async () => {
    const writer = new FakeWriter();
    await mount(writer);
    await press('type');
    await press('submit');
    expect(text('name')).toBe('confirming');
    await press('confirm');
    await reaches('submitted');
    expect(writer.saves).toHaveLength(1);
    expect(writer.submits).toEqual([
      { answerId: 'ans-1', answerVersion: 1, idempotencyKey: expect.any(String) },
    ]);
    expect(writer.submits[0]?.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('skips the save when the draft is already on the server unchanged', async () => {
    const writer = new FakeWriter();
    await mount(writer);
    await press('type');
    await press('save');
    await waitFor(() => expect(text('saved')).toBe('1'));
    await press('submit');
    await press('confirm');
    await reaches('submitted');
    expect(writer.saves).toHaveLength(1);
    expect(writer.submits).toHaveLength(1);
  });

  it('reuses the same key after a lost response, and never saves twice for one submission', async () => {
    const writer = new FakeWriter();
    await mount(writer);
    await press('type');
    await press('submit');
    await press('cancel');
    expect(text('name')).toBe('editing');
    await press('submit');

    writer.submitError = new SafeError('network');
    await press('confirm');
    await reaches('failed');
    expect(text('during')).toBe('submit');
    const first = writer.submits[0]?.idempotencyKey;
    expect(first).toBeTruthy();

    writer.submitError = null;
    await press('retry');
    await reaches('submitted');
    // The save happened once; the retry went straight to the submission
    // with the SAME key, so the server could only ever settle it once.
    expect(writer.saves).toHaveLength(1);
    expect(writer.submits).toHaveLength(2);
    expect(writer.submits[1]?.idempotencyKey).toBe(first);
  });

  it('words a server refusal met while submitting', async () => {
    const writer = new FakeWriter();
    await mount(writer);
    await press('type');
    writer.submitError = new AnswerRefusedError('already_submitted');
    await press('submit');
    await press('confirm');
    await reaches('refused');
    expect(text('refusal')).toBe('already_submitted');
    expect(text('during')).toBe('submit');
  });
});
