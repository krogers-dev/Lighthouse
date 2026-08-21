import { fireEvent, render, screen } from '@testing-library/react-native';

import { SafeError } from '@/core/errors';
import type { DashboardSnapshot } from '@/data/supabase/repositories';

import { DashboardView } from '../DashboardView';

const snapshot: DashboardSnapshot = {
  caseTitle: '2025 books close (Synthetic)',
  caseStatus: 'EVIDENCE_PENDING',
  statusChangedAt: '2026-08-21T00:00:00Z',
  attentionSummary: 'One statement is still needed (Synthetic)',
  nextActionSummary: 'Provide the missing statement (Synthetic)',
  nextActionOwnerRole: 'client_user',
};

const baseProps = {
  workspaceName: 'Harbor Light Bakery LLC (Synthetic)',
  onRetry: jest.fn(),
  onSwitchScope: jest.fn(),
  onOpenSettings: jest.fn(),
};

describe('DashboardView states', () => {
  it('shows loading', async () => {
    await render(<DashboardView {...baseProps} state="loading" />);
    expect(screen.getByTestId('dashboard-loading')).toBeTruthy();
  });

  it('shows the ready card with status, attention, and next action', async () => {
    await render(<DashboardView {...baseProps} state="ready" snapshot={snapshot} />);
    expect(screen.getByTestId('dashboard-ready')).toBeTruthy();
    expect(screen.getByLabelText('Needs attention: Waiting on records')).toBeTruthy();
    expect(screen.getByText('One statement is still needed (Synthetic)')).toBeTruthy();
    expect(screen.getByText('Provide the missing statement (Synthetic)')).toBeTruthy();
    expect(screen.getByText('Owner: You')).toBeTruthy();
  });

  it('shows empty when the workspace has no open work', async () => {
    await render(<DashboardView {...baseProps} state="empty" />);
    expect(screen.getByText('Nothing needs your attention')).toBeTruthy();
  });

  it('shows offline recovery, never stale content', async () => {
    await render(<DashboardView {...baseProps} state="offline" />);
    expect(screen.getByTestId('dashboard-offline')).toBeTruthy();
    expect(screen.queryByTestId('dashboard-ready')).toBeNull();
  });

  it('shows expired-session state', async () => {
    await render(<DashboardView {...baseProps} state="expired" />);
    expect(screen.getByTestId('dashboard-expired')).toBeTruthy();
  });

  it('shows permission-denied with a workspace action', async () => {
    const onSwitchScope = jest.fn();
    await render(<DashboardView {...baseProps} state="denied" onSwitchScope={onSwitchScope} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Choose a workspace' }));
    expect(onSwitchScope).toHaveBeenCalled();
  });

  it('shows stale-scope state', async () => {
    await render(<DashboardView {...baseProps} state="stale_scope" />);
    expect(screen.getByTestId('dashboard-stale')).toBeTruthy();
  });

  it('shows safe error state with retry', async () => {
    const onRetry = jest.fn();
    await render(
      <DashboardView
        {...baseProps}
        state="error"
        error={new SafeError('unknown')}
        onRetry={onRetry}
      />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('never renders financial values or live claims', async () => {
    await render(<DashboardView {...baseProps} state="ready" snapshot={snapshot} />);
    expect(screen.queryByText(/\$\d/)).toBeNull();
  });
});
