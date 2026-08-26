import { render, screen } from '@testing-library/react-native';

import { SafeError } from '@/core/errors';
import type { ActivityEntry, ScopedList } from '@/data/supabase/repositories';

import { ActivityView } from '../ActivityView';

const items: ActivityEntry[] = [
  {
    id: 'cccccccc-1111-4000-8000-0000000000a3',
    kind: 'request.answered',
    actorRole: 'client_user',
    occurredAt: '2026-08-11T09:15:00Z',
  },
  {
    id: 'cccccccc-1111-4000-8000-0000000000a1',
    kind: 'case.status_changed',
    actorRole: 'preparer',
    occurredAt: '2026-08-01T15:00:00Z',
  },
];

const data: ScopedList<ActivityEntry> = { items, recordedThrough: '2026-08-11T09:15:00Z' };

const baseProps = {
  workspaceName: 'Harbor Light Bakery LLC (Synthetic)',
  onRetry: jest.fn(),
  onSwitchScope: jest.fn(),
};

describe('ActivityView', () => {
  it('lists events as kind, role, and server date', async () => {
    await render(<ActivityView {...baseProps} state="ready" data={data} />);
    expect(screen.getByTestId('activity-list')).toBeTruthy();
    expect(screen.getByText('Request answered')).toBeTruthy();
    expect(screen.getByText('Status changed')).toBeTruthy();
    expect(screen.getByText('You · August 11, 2026')).toBeTruthy();
    expect(screen.getByText('Your preparer · August 1, 2026')).toBeTruthy();
  });

  it('never renders a raw event enum to a client', async () => {
    await render(<ActivityView {...baseProps} state="ready" data={data} />);
    expect(screen.queryByText('request.answered')).toBeNull();
    expect(screen.queryByText('case.status_changed')).toBeNull();
  });

  it('states what the trail is recorded through', async () => {
    await render(<ActivityView {...baseProps} state="ready" data={data} />);
    expect(screen.getByTestId('activity-recorded-through')).toHaveTextContent(
      'Recorded through August 11, 2026',
    );
  });

  it('replaces content when offline rather than ageing it', async () => {
    await render(<ActivityView {...baseProps} state="offline" data={data} />);
    expect(screen.queryByTestId('activity-list')).toBeNull();
    expect(screen.queryByText('Request answered')).toBeNull();
    expect(screen.getByTestId('activity-offline')).toBeTruthy();
  });

  it.each([
    ['loading', 'activity-loading'],
    ['expired', 'activity-expired'],
    ['denied', 'activity-denied'],
    ['stale_scope', 'activity-stale'],
    ['empty', 'activity-empty'],
  ] as const)('shows the %s state explicitly', async (state, testID) => {
    await render(<ActivityView {...baseProps} state={state} />);
    expect(screen.getByTestId(testID)).toBeTruthy();
  });

  it('shows a safe error message', async () => {
    await render(<ActivityView {...baseProps} state="error" error={new SafeError('unknown')} />);
    expect(screen.getByTestId('activity-error')).toBeTruthy();
  });
});
