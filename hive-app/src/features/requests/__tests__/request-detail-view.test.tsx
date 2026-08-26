import { fireEvent, render, screen } from '@testing-library/react-native';

import { SafeError } from '@/core/errors';
import type { RequestDetail } from '@/data/supabase/repositories';

import { RequestDetailView } from '../RequestDetailView';

const request: RequestDetail = {
  id: 'dddddddd-0000-4000-8000-0000000000a1',
  title: 'Bank statement for the closing month (Synthetic)',
  detail: 'The final month statement is needed to complete the records (Synthetic).',
  status: 'OPEN',
  ownerRole: 'client_user',
  requestedOn: '2026-08-10',
  dueOn: '2026-09-10',
};

const baseProps = { onRetry: jest.fn(), onSwitchScope: jest.fn(), onBack: jest.fn() };

describe('RequestDetailView', () => {
  it('shows the request with its detail, owner, and dates', async () => {
    await render(<RequestDetailView {...baseProps} state="ready" request={request} />);
    expect(screen.getByTestId('request-detail-ready')).toBeTruthy();
    expect(screen.getByText(request.detail)).toBeTruthy();
    expect(screen.getByText('Owner: You')).toBeTruthy();
    expect(screen.getByText('Requested August 10, 2026')).toBeTruthy();
  });

  it('says a foreign id is not here, never that it exists elsewhere', async () => {
    await render(<RequestDetailView {...baseProps} state="empty" request={null} />);
    const body = screen.getByTestId('request-detail-empty');
    expect(body).toBeTruthy();
    expect(screen.getByText('Request not found here')).toBeTruthy();
    // Nothing may hint that the request exists in another workspace.
    for (const leak of ['another workspace', 'no permission', 'not authorized', 'exists']) {
      expect(screen.queryByText(new RegExp(leak, 'i'))).toBeNull();
    }
  });

  it('offers a safe way back and no write control', async () => {
    const onBack = jest.fn();
    await render(
      <RequestDetailView {...baseProps} state="ready" request={request} onBack={onBack} />,
    );
    fireEvent.press(screen.getByTestId('request-detail-back'));
    expect(onBack).toHaveBeenCalled();
    for (const forbidden of ['Respond', 'Reply', 'Upload', 'Attach', 'Edit', 'Send']) {
      expect(screen.queryByText(forbidden)).toBeNull();
    }
  });

  it.each([
    ['loading', 'request-detail-loading'],
    ['offline', 'request-detail-offline'],
    ['denied', 'request-detail-denied'],
    ['stale_scope', 'request-detail-stale'],
  ] as const)('shows the %s state explicitly', async (state, testID) => {
    await render(<RequestDetailView {...baseProps} state={state} />);
    expect(screen.getByTestId(testID)).toBeTruthy();
  });

  it('shows a safe error message', async () => {
    await render(
      <RequestDetailView {...baseProps} state="error" error={new SafeError('unknown')} />,
    );
    expect(screen.getByTestId('request-detail-error')).toBeTruthy();
  });
});
