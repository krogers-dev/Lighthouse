/** The creation hook against a fake round trip, driven through a probe
 * component; every event awaited inside act. */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';

import { SafeError } from '@/core/errors';
import type { RandomSource } from '@/core/ids';
import { ReviewRefusedError } from '@/data/supabase/reviews';

import { type CreationDeps, useCreation } from '../useCreation';

type Draft = { title: string };
type Result = { caseId: string };

function makeRandom(): RandomSource {
  let calls = 0;
  return {
    fill(bytes) {
      calls += 1;
      bytes.fill(calls);
      return bytes;
    },
  };
}

function Probe({ deps }: { deps: CreationDeps<Draft, Result> }): React.JSX.Element {
  const flow = useCreation<Draft, Result>(deps);
  const s = flow.state;
  return (
    <>
      <Text testID="name">{s.name}</Text>
      <Text testID="title">{s.draft.title}</Text>
      <Text testID="refusal">{s.name === 'refused' ? s.refusal : ''}</Text>
      <Text testID="result">{s.name === 'done' ? s.result.caseId : ''}</Text>
      <Text testID="type" onPress={() => flow.setDraft({ title: 'Books (Synthetic)' })}>
        type
      </Text>
      <Text testID="request" onPress={flow.request}>
        request
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

function press(testID: string): Promise<void> {
  return act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

interface Call {
  draft: Draft;
  key: string;
}

function makeDeps(overrides: Partial<CreationDeps<Draft, Result>> = {}): {
  deps: CreationDeps<Draft, Result>;
  calls: Call[];
  fail: { error: unknown };
} {
  const calls: Call[] = [];
  const fail: { error: unknown } = { error: null };
  const deps: CreationDeps<Draft, Result> = {
    initialDraft: { title: '' },
    check: (draft) => (draft.title.trim() === '' ? 'title_missing' : null),
    create: async (draft, key) => {
      calls.push({ draft, key });
      if (fail.error) throw fail.error;
      return { caseId: `case-for-${draft.title}` };
    },
    random: makeRandom(),
    ...overrides,
  };
  return { deps, calls, fail };
}

describe('useCreation', () => {
  it('refuses an empty draft before any round trip, then confirms with one key and settles', async () => {
    const { deps, calls } = makeDeps();
    const onCreated = jest.fn();
    await render(<Probe deps={{ ...deps, onCreated }} />);
    await press('request');
    expect(screen.getByTestId('name')).toHaveTextContent('refused');
    expect(screen.getByTestId('refusal')).toHaveTextContent('title_missing');
    expect(calls).toHaveLength(0);
    await press('dismiss');
    await press('type');
    await press('request');
    expect(screen.getByTestId('name')).toHaveTextContent('confirming');
    await press('confirm');
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('done'));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.draft).toEqual({ title: 'Books (Synthetic)' });
    expect(calls[0]?.key).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getByTestId('result')).toHaveTextContent('case-for-Books (Synthetic)');
    expect(onCreated).toHaveBeenCalledWith({ caseId: 'case-for-Books (Synthetic)' });
  });

  it('keeps the key through a failure so a retry cannot create twice, and drops it on cancel', async () => {
    const { deps, calls, fail } = makeDeps();
    await render(<Probe deps={deps} />);
    await press('type');
    await press('request');
    await press('cancel');
    expect(screen.getByTestId('name')).toHaveTextContent('idle');
    await press('request');
    fail.error = new SafeError('network');
    await press('confirm');
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('failed'));
    fail.error = null;
    await press('retry');
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('done'));
    expect(calls).toHaveLength(2);
    expect(calls[0]?.key).toBe(calls[1]?.key);
  });

  it('words a server refusal and keeps the draft, and reports an expired session', async () => {
    const { deps, fail } = makeDeps();
    const onSessionExpired = jest.fn();
    await render(<Probe deps={{ ...deps, onSessionExpired }} />);
    await press('type');
    await press('request');
    fail.error = new ReviewRefusedError('too_many_drafts');
    await press('confirm');
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('refused'));
    expect(screen.getByTestId('refusal')).toHaveTextContent('too_many_drafts');
    expect(screen.getByTestId('title')).toHaveTextContent('Books (Synthetic)');
    await press('dismiss');
    await press('request');
    fail.error = new SafeError('auth_expired');
    await press('confirm');
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('failed'));
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });
});
