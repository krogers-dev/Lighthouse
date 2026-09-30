/** The deletion-request hook against a fake account repository, driven
 * through a probe component; every event awaited inside act
 * (testing-library 14). */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';

import type { RandomSource } from '@/core/ids';
import {
  type AccountLoader,
  AccountRefusedError,
  type AccountWriter,
  type DeletionReceipt,
  type DeletionRequest,
} from '@/data/supabase/account';

import { type DeletionRequestDeps, useDeletionRequest } from '../useDeletionRequest';

function makeRandom(): RandomSource {
  let calls = 0;
  return {
    fill(bytes) {
      calls += 1;
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = (calls * 17 + i) & 0xff;
    },
  };
}

class FakeAccount implements AccountLoader, AccountWriter {
  latest: DeletionRequest | null = null;
  calls: { name: string; key: string }[] = [];
  reads = 0;
  error: unknown = null;
  async getLatestDeletionRequest(): Promise<DeletionRequest | null> {
    this.reads += 1;
    return this.latest;
  }
  private async answer(name: string, key: string, status: DeletionReceipt['status']) {
    this.calls.push({ name, key });
    if (this.error) throw this.error;
    this.latest = {
      id: 'req-1',
      status,
      requestedAt: '2026-09-28T20:00:00Z',
      withdrawnAt: status === 'WITHDRAWN' ? '2026-09-28T20:05:00Z' : null,
      completedAt: null,
    };
    return { requestId: 'req-1', status, replayed: false };
  }
  requestDeletion(key: string) {
    return this.answer('request', key, 'REQUESTED');
  }
  withdrawDeletion(key: string) {
    return this.answer('withdraw', key, 'WITHDRAWN');
  }
}

function Probe({ deps }: { deps: DeletionRequestDeps }): React.JSX.Element {
  const c = useDeletionRequest(deps);
  return (
    <>
      <Text testID="load">{c.load.name}</Text>
      <Text testID="latest">
        {c.load.name === 'ready' ? (c.load.latest?.status ?? 'none') : ''}
      </Text>
      <Text testID="flow">{c.flow.name}</Text>
      <Text testID="refusal">{c.flow.name === 'refused' ? c.flow.refusal : ''}</Text>
      <Text testID="request" onPress={() => c.request('request')}>
        request
      </Text>
      <Text testID="withdraw" onPress={() => c.request('withdraw')}>
        withdraw
      </Text>
      <Text testID="confirm" onPress={c.confirm}>
        confirm
      </Text>
      <Text testID="cancel" onPress={c.cancel}>
        cancel
      </Text>
      <Text testID="retry" onPress={c.retry}>
        retry
      </Text>
      <Text testID="dismiss" onPress={c.dismiss}>
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

async function mount(account: FakeAccount, extra: Partial<DeletionRequestDeps> = {}) {
  await render(<Probe deps={{ account, enabled: true, random: makeRandom(), ...extra }} />);
  await waitFor(() => expect(text('load')).not.toBe('loading'));
}

describe('useDeletionRequest', () => {
  it('does nothing when disabled: no read, no state', async () => {
    const account = new FakeAccount();
    await render(<Probe deps={{ account, enabled: false, random: makeRandom() }} />);
    expect(text('load')).toBe('disabled');
    expect(account.reads).toBe(0);
  });

  it('loads the latest request, confirms a request with one key, reloads once it settles', async () => {
    const account = new FakeAccount();
    await mount(account);
    expect(text('latest')).toBe('none');
    await press('request');
    expect(text('flow')).toBe('confirming');
    await press('confirm');
    await waitFor(() => expect(text('flow')).toBe('done'));
    expect(account.calls).toHaveLength(1);
    expect(account.calls[0]!.name).toBe('request');
    expect(account.calls[0]!.key).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => expect(text('latest')).toBe('REQUESTED'));
    expect(account.reads).toBe(2);
  });

  it('reuses the same key after a failure and drops it after a cancel', async () => {
    const account = new FakeAccount();
    await mount(account);
    await press('request');
    await press('cancel');
    expect(text('flow')).toBe('idle');
    account.error = new Error('network');
    await press('request');
    await press('confirm');
    await waitFor(() => expect(text('flow')).toBe('failed'));
    account.error = null;
    await press('retry');
    await waitFor(() => expect(text('flow')).toBe('done'));
    expect(account.calls).toHaveLength(2);
    expect(account.calls[0]!.key).toBe(account.calls[1]!.key);
  });

  it('words a server refusal and returns to idle on dismiss', async () => {
    const account = new FakeAccount();
    account.latest = {
      id: 'req-0',
      status: 'REQUESTED',
      requestedAt: '2026-09-28T19:00:00Z',
      withdrawnAt: null,
      completedAt: null,
    };
    await mount(account);
    expect(text('latest')).toBe('REQUESTED');
    account.error = new AccountRefusedError('no_open_request');
    await press('withdraw');
    await press('confirm');
    await waitFor(() => expect(text('flow')).toBe('refused'));
    expect(text('refusal')).toBe('no_open_request');
    await press('dismiss');
    expect(text('flow')).toBe('idle');
  });
});
