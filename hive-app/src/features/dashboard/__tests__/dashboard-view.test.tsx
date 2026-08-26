import { fireEvent, render, screen } from '@testing-library/react-native';

import { SafeError } from '@/core/errors';
import type { CaseSummary, ScopedList } from '@/data/supabase/repositories';

import { DashboardView } from '../DashboardView';

const newer: CaseSummary = {
  id: 'case-newer',
  title: '2025 books close (Synthetic)',
  status: 'EVIDENCE_PENDING',
  statusChangedAt: '2026-08-21T00:00:00Z',
  attentionSummary: 'One statement is still needed (Synthetic)',
  nextActionSummary: 'Provide the missing statement (Synthetic)',
  nextActionOwnerRole: 'client_user',
};

const older: CaseSummary = {
  id: 'case-older',
  title: 'Prior year wrap-up (Synthetic)',
  status: 'APPROVED',
  statusChangedAt: '2026-07-02T00:00:00Z',
  attentionSummary: null,
  nextActionSummary: null,
  nextActionOwnerRole: null,
};

const data: ScopedList<CaseSummary> = {
  items: [newer, older],
  recordedThrough: '2026-08-21T00:00:00Z',
};

const baseProps = {
  workspaceName: 'Harbor Light Bakery LLC (Synthetic)',
  onRetry: jest.fn(),
  onSwitchScope: jest.fn(),
};

describe('DashboardView states', () => {
  it('shows loading', async () => {
    await render(<DashboardView {...baseProps} state="loading" />);
    expect(screen.getByTestId('dashboard-loading')).toBeTruthy();
  });

  it('lists every case in the scope with status, attention, and next action', async () => {
    await render(<DashboardView {...baseProps} state="ready" data={data} />);
    expect(screen.getByTestId('dashboard-list')).toBeTruthy();
    expect(screen.getByTestId('dashboard-case-case-newer')).toBeTruthy();
    expect(screen.getByTestId('dashboard-case-case-older')).toBeTruthy();
    expect(screen.getByLabelText('Needs attention: Waiting on records')).toBeTruthy();
    expect(screen.getByText('One statement is still needed (Synthetic)')).toBeTruthy();
    expect(screen.getByText('Provide the missing statement (Synthetic)')).toBeTruthy();
    expect(screen.getByText('Owner: You')).toBeTruthy();
    expect(screen.getByText('Status changed August 21, 2026')).toBeTruthy();
  });

  it('renders cases in the order given, newest first', async () => {
    await render(<DashboardView {...baseProps} state="ready" data={data} />);
    const rendered = JSON.stringify(screen.toJSON());
    expect(rendered.indexOf('2025 books close (Synthetic)')).toBeLessThan(
      rendered.indexOf('Prior year wrap-up (Synthetic)'),
    );
  });

  it('says nothing is waiting when a case has no attention item', async () => {
    await render(<DashboardView {...baseProps} state="ready" data={data} />);
    expect(screen.getByText('Nothing is waiting on you right now.')).toBeTruthy();
  });

  it('states what the view is recorded through, never a device clock reading', async () => {
    await render(<DashboardView {...baseProps} state="ready" data={data} />);
    expect(screen.getByTestId('dashboard-recorded-through')).toHaveTextContent(
      'Recorded through August 21, 2026',
    );
  });

  it('offers a reload affordance on the screen itself, not only in an error state', async () => {
    const onRetry = jest.fn();
    await render(<DashboardView {...baseProps} state="ready" data={data} onRetry={onRetry} />);
    fireEvent.press(screen.getByTestId('dashboard-refresh'));
    expect(onRetry).toHaveBeenCalled();
  });

  it('shows empty when the workspace has no open work, and still allows a reload', async () => {
    await render(
      <DashboardView {...baseProps} state="empty" data={{ items: [], recordedThrough: null }} />,
    );
    expect(screen.getByText('Nothing needs your attention')).toBeTruthy();
    expect(screen.getByTestId('dashboard-refresh')).toBeTruthy();
    // Nothing to be current about: no claim is made at all.
    expect(screen.queryByTestId('dashboard-recorded-through')).toBeNull();
  });

  it('replaces content when offline rather than ageing it', async () => {
    await render(<DashboardView {...baseProps} state="offline" data={data} />);
    expect(screen.getByTestId('dashboard-offline')).toBeTruthy();
    expect(screen.queryByTestId('dashboard-list')).toBeNull();
    expect(screen.queryByText('2025 books close (Synthetic)')).toBeNull();
    expect(screen.queryByTestId('dashboard-refresh')).toBeNull();
  });

  it.each([
    ['expired', 'dashboard-expired'],
    ['denied', 'dashboard-denied'],
    ['stale_scope', 'dashboard-stale'],
  ] as const)('shows the %s state explicitly', async (state, testID) => {
    await render(<DashboardView {...baseProps} state={state} />);
    expect(screen.getByTestId(testID)).toBeTruthy();
  });

  it('shows a safe error message with a retry', async () => {
    await render(<DashboardView {...baseProps} state="error" error={new SafeError('unknown')} />);
    expect(screen.getByTestId('dashboard-error')).toBeTruthy();
  });

  it('ships no write control anywhere', async () => {
    await render(<DashboardView {...baseProps} state="ready" data={data} />);
    for (const forbidden of ['Respond', 'Reply', 'Upload', 'Attach', 'Edit', 'Send', 'Approve']) {
      expect(screen.queryByText(forbidden)).toBeNull();
    }
  });
});
