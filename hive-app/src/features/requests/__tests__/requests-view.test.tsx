import { fireEvent, render, screen } from '@testing-library/react-native';

import { SafeError } from '@/core/errors';
import type { RequestSummary, ScopedList } from '@/data/supabase/repositories';

import { RequestsView } from '../RequestsView';

const items: RequestSummary[] = [
  {
    id: 'dddddddd-0000-4000-8000-0000000000a1',
    title: 'Bank statement for the closing month (Synthetic)',
    status: 'OPEN',
    ownerRole: 'client_user',
    requestedOn: '2026-08-10',
    dueOn: '2026-09-10',
  },
  {
    id: 'dddddddd-0000-4000-8000-0000000000a2',
    title: 'Confirm the vehicle expense category (Synthetic)',
    status: 'ANSWERED',
    ownerRole: 'client_user',
    requestedOn: '2026-08-05',
    dueOn: null,
  },
];

const data: ScopedList<RequestSummary> = { items, recordedThrough: '2026-08-10' };

const baseProps = {
  workspaceName: 'Harbor Light Bakery LLC (Synthetic)',
  onRetry: jest.fn(),
  onSwitchScope: jest.fn(),
  onOpenRequest: jest.fn(),
};

describe('RequestsView', () => {
  it('lists requests with status, owner, and server dates', async () => {
    await render(<RequestsView {...baseProps} state="ready" data={data} />);
    expect(screen.getByTestId('requests-list')).toBeTruthy();
    expect(screen.getByText('Bank statement for the closing month (Synthetic)')).toBeTruthy();
    expect(screen.getByText('Requested August 10, 2026')).toBeTruthy();
    expect(screen.getByText('Due September 10, 2026')).toBeTruthy();
    expect(screen.getAllByText('Owner: You').length).toBe(2);
  });

  it('states what the list is recorded through, not a device clock reading', async () => {
    await render(<RequestsView {...baseProps} state="ready" data={data} />);
    expect(screen.getByTestId('requests-recorded-through')).toHaveTextContent(
      'Recorded through August 10, 2026',
    );
  });

  it('opens a request by its id', async () => {
    const onOpenRequest = jest.fn();
    await render(
      <RequestsView {...baseProps} state="ready" data={data} onOpenRequest={onOpenRequest} />,
    );
    fireEvent.press(screen.getByTestId('request-card-dddddddd-0000-4000-8000-0000000000a1'));
    expect(onOpenRequest).toHaveBeenCalledWith('dddddddd-0000-4000-8000-0000000000a1');
  });

  it('carries an accessible label with title, status, and owner', async () => {
    await render(<RequestsView {...baseProps} state="ready" data={data} />);
    expect(
      screen.getByLabelText(
        'Bank statement for the closing month (Synthetic). Needs a response. Owner: You.',
      ),
    ).toBeTruthy();
  });

  it.each([
    ['loading', 'requests-loading'],
    ['offline', 'requests-offline'],
    ['expired', 'requests-expired'],
    ['denied', 'requests-denied'],
    ['stale_scope', 'requests-stale'],
    ['empty', 'requests-empty'],
  ] as const)('shows the %s state explicitly', async (state, testID) => {
    await render(<RequestsView {...baseProps} state={state} />);
    expect(screen.getByTestId(testID)).toBeTruthy();
  });

  it('shows the error state with a safe message', async () => {
    await render(<RequestsView {...baseProps} state="error" error={new SafeError('unknown')} />);
    expect(screen.getByTestId('requests-error')).toBeTruthy();
  });

  it('never shows list content while offline (content is replaced, not aged)', async () => {
    await render(<RequestsView {...baseProps} state="offline" data={data} />);
    expect(screen.queryByTestId('requests-list')).toBeNull();
    expect(screen.queryByText('Bank statement for the closing month (Synthetic)')).toBeNull();
    expect(screen.queryByTestId('requests-recorded-through')).toBeNull();
  });

  it('ships no respond, upload, or edit control anywhere', async () => {
    await render(<RequestsView {...baseProps} state="ready" data={data} />);
    for (const forbidden of ['Respond', 'Reply', 'Upload', 'Attach', 'Edit', 'Send']) {
      expect(screen.queryByText(forbidden)).toBeNull();
    }
  });
});
