/** The case-transition hook against a fake writer, driven through a
 * probe component; every event awaited inside act (testing-library 14). */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';

import { SafeError } from '@/core/errors';
import type { RandomSource } from '@/core/ids';
import {
  type ApproveInput,
  type CaseTransitionInput,
  ReviewRefusedError,
  type ReviewWriter,
  type TransitionReceipt,
  type VerdictInput,
} from '@/data/supabase/reviews';
import type { ScopeKey } from '@/tenancy/scope-key';

import { type CaseReviewDeps, useCaseReview } from '../useCaseReview';

const scope = {
  environmentId: '11111111-0000-4000-8000-000000000001',
  clientId: 'aaaaaaaa-0000-4000-8000-000000000001',
  entityId: 'aaaaaaaa-1111-4000-8000-000000000001',
  membershipId: 'mmmmmmmm-0000-4000-8000-000000000001',
} as unknown as ScopeKey;

const caseRecord = { id: 'eeeeeeee-0000-4000-8000-0000000000a1', version: 3 };
const currentPackage = { id: 'pkg-2', manifestDigest: 'c'.repeat(64) };

function makeRandom(): RandomSource {
  let calls = 0;
  return {
    fill(bytes) {
      calls += 1;
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = (calls * 13 + i) & 0xff;
    },
  };
}

class FakeWriter implements ReviewWriter {
  calls: { name: string; input: CaseTransitionInput | VerdictInput | ApproveInput }[] = [];
  error: unknown = null;
  private async answer(name: string, input: CaseTransitionInput, status: string) {
    this.calls.push({ name, input });
    if (this.error) throw this.error;
    return { caseStatus: status, caseVersion: input.caseVersion + 1 } as TransitionReceipt;
  }
  freeze(_scope: ScopeKey, input: CaseTransitionInput) {
    return this.answer('freeze', input, 'READY_FOR_REVIEW');
  }
  startReview(_scope: ScopeKey, input: CaseTransitionInput) {
    return this.answer('startReview', input, 'IN_REVIEW');
  }
  recordVerdict(_scope: ScopeKey, input: VerdictInput) {
    return this.answer('recordVerdict', input, 'RETURNED');
  }
  resume(_scope: ScopeKey, input: CaseTransitionInput) {
    return this.answer('resume', input, 'EVIDENCE_PENDING');
  }
  approve(_scope: ScopeKey, input: ApproveInput) {
    return this.answer('approve', input, 'APPROVED');
  }
}

function Probe({ deps }: { deps: CaseReviewDeps }): React.JSX.Element {
  const flow = useCaseReview(deps);
  const s = flow.state;
  return (
    <>
      <Text testID="name">{s.name}</Text>
      <Text testID="action">{s.name === 'idle' ? '' : s.action}</Text>
      <Text testID="verdict">{s.draft.verdict ?? ''}</Text>
      <Text testID="note">{s.draft.note}</Text>
      <Text testID="refusal">{s.name === 'refused' ? s.refusal : ''}</Text>
      <Text testID="choose-return" onPress={() => flow.chooseVerdict('RETURN')}>
        return
      </Text>
      <Text testID="type" onPress={() => flow.setNote('Missing page\u0001 (Synthetic)')}>
        type
      </Text>
      <Text testID="freeze" onPress={() => flow.request('freeze')}>
        freeze
      </Text>
      <Text testID="verdict-request" onPress={() => flow.request('record_verdict')}>
        verdict
      </Text>
      <Text testID="approve" onPress={() => flow.request('approve')}>
        approve
      </Text>
      <Text testID="confirm" onPress={flow.confirm}>
        confirm
      </Text>
      <Text testID="cancel" onPress={flow.cancel}>
        cancel
      </Text>
      <Text testID="retry" onPress={flow.retry}>
        retry
      </Text>
      <Text testID="dismiss" onPress={flow.dismiss}>
        dismiss
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

async function mount(writer: FakeWriter, extra: Partial<CaseReviewDeps> = {}) {
  const deps: CaseReviewDeps = {
    scope,
    caseRecord,
    package: currentPackage,
    writer,
    random: makeRandom(),
    ...extra,
  };
  await render(<Probe deps={deps} />);
  return deps;
}

describe('useCaseReview', () => {
  it('confirms a freeze with the case version and one key, then reports it settled', async () => {
    const writer = new FakeWriter();
    const onSettled = jest.fn();
    await mount(writer, { onSettled });
    await press('freeze');
    expect(text('name')).toBe('confirming');
    await press('confirm');
    await waitFor(() => expect(text('name')).toBe('done'));
    expect(writer.calls).toEqual([
      {
        name: 'freeze',
        input: { caseId: caseRecord.id, caseVersion: 3, idempotencyKey: expect.any(String) },
      },
    ]);
    expect(onSettled).toHaveBeenCalledWith({ caseStatus: 'READY_FOR_REVIEW', caseVersion: 4 });
  });

  it('refuses a verdict without a choice before any round trip, then records it with the sanitized note', async () => {
    const writer = new FakeWriter();
    await mount(writer);
    await press('verdict-request');
    expect(text('name')).toBe('refused');
    expect(text('refusal')).toBe('verdict_missing');
    expect(writer.calls).toHaveLength(0);
    await press('dismiss');
    await press('choose-return');
    await press('type');
    expect(text('note')).toBe('Missing page (Synthetic)');
    await press('verdict-request');
    await press('confirm');
    await waitFor(() => expect(text('name')).toBe('done'));
    expect(writer.calls[0]).toMatchObject({
      name: 'recordVerdict',
      input: { verdict: 'RETURN', note: 'Missing page (Synthetic)', caseVersion: 3 },
    });
  });

  it('binds an approval to the package id and digest the screen showed and the HIVE record', async () => {
    const writer = new FakeWriter();
    await mount(writer);
    await press('approve');
    await press('confirm');
    await waitFor(() => expect(text('name')).toBe('done'));
    expect(writer.calls[0]).toMatchObject({
      name: 'approve',
      input: {
        packageId: 'pkg-2',
        packageDigest: 'c'.repeat(64),
        destination: 'hive-record',
        caseVersion: 3,
      },
    });
  });

  it('refuses an approval locally when no package is on screen', async () => {
    const writer = new FakeWriter();
    await mount(writer, { package: null });
    await press('approve');
    await press('confirm');
    await waitFor(() => expect(text('name')).toBe('refused'));
    expect(text('refusal')).toBe('package_missing');
    expect(writer.calls).toHaveLength(0);
  });

  it('reuses the same key after a failure and drops it after a cancel', async () => {
    const writer = new FakeWriter();
    const onSessionExpired = jest.fn();
    await mount(writer, { onSessionExpired });
    await press('freeze');
    await press('cancel');
    expect(text('name')).toBe('idle');
    await press('freeze');
    writer.error = new SafeError('auth_expired');
    await press('confirm');
    await waitFor(() => expect(text('name')).toBe('failed'));
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    const first = writer.calls[0]?.input.idempotencyKey;
    writer.error = null;
    await press('retry');
    await waitFor(() => expect(text('name')).toBe('done'));
    expect(writer.calls).toHaveLength(2);
    expect(writer.calls[1]?.input.idempotencyKey).toBe(first);
  });

  it('words a server refusal and returns to editing on dismiss', async () => {
    const writer = new FakeWriter();
    await mount(writer);
    writer.error = new ReviewRefusedError('conflict_of_interest');
    await press('freeze');
    await press('confirm');
    await waitFor(() => expect(text('name')).toBe('refused'));
    expect(text('refusal')).toBe('conflict_of_interest');
    await press('dismiss');
    expect(text('name')).toBe('idle');
  });
});
