import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { SafeError } from '@/core/errors';

import { type DeletionSectionProps, SettingsView } from '../SettingsView';

const noop = (): void => undefined;

const deletionHandlers = {
  onReload: jest.fn(),
  onRequest: jest.fn(),
  onWithdraw: jest.fn(),
  onConfirm: jest.fn(),
  onCancel: jest.fn(),
  onDismiss: jest.fn(),
  onTryAgain: jest.fn(),
};

function deletion(overrides: Partial<DeletionSectionProps> = {}): DeletionSectionProps {
  return {
    infoUrl: 'https://example.invalid/hive/delete-account',
    load: { name: 'ready', latest: null },
    flow: { name: 'idle' },
    ...deletionHandlers,
    ...overrides,
  };
}

describe('SettingsView', () => {
  it('names the current workspace and offers only sign out and back without a second workspace', async () => {
    await render(
      <SettingsView
        workspaceName="Harbor Light Bakery LLC (Synthetic)"
        canSwitchScope={false}
        signingOut={false}
        onSwitchScope={noop}
        onSignOut={noop}
        onBack={noop}
      />,
    );
    expect(screen.getByText('Current workspace: Harbor Light Bakery LLC (Synthetic)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Switch workspace' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });

  it('invents no support channel when none is configured', async () => {
    await render(
      <SettingsView
        canSwitchScope={true}
        signingOut={false}
        onSwitchScope={noop}
        onSignOut={noop}
        onBack={noop}
      />,
    );
    const text = JSON.stringify(screen.toJSON());
    expect(text).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i);
    expect(screen.queryByTestId('settings-support-email')).toBeNull();
  });

  it('shows the configured support address as a tappable line that opens the mail app', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await render(
      <SettingsView
        supportEmail="team@example.invalid"
        canSwitchScope={false}
        signingOut={false}
        onSwitchScope={noop}
        onSignOut={noop}
        onBack={noop}
      />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Email team@example.invalid' }));
    expect(open).toHaveBeenCalledWith('mailto:team@example.invalid');
    open.mockRestore();
  });
});

describe('SettingsView account deletion (WO-007)', () => {
  it('renders no deletion control at all when the public deletion page is not configured', async () => {
    await render(
      <SettingsView
        canSwitchScope={false}
        signingOut={false}
        onSwitchScope={noop}
        onSignOut={noop}
        onBack={noop}
      />,
    );
    expect(screen.queryByTestId('settings-deletion-section')).toBeNull();
    expect(screen.queryByText(/delet/i)).toBeNull();
  });

  it('explains what deletion removes and what is kept, links the page, and offers the request through a confirmation', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await render(
      <SettingsView
        canSwitchScope={false}
        signingOut={false}
        deletion={deletion()}
        onSwitchScope={noop}
        onSignOut={noop}
        onBack={noop}
      />,
    );
    const section = screen.getByTestId('settings-deletion-section');
    expect(section).toHaveTextContent(
      /removes your access to HIVE and the account you sign in with/,
    );
    expect(section).toHaveTextContent(/are kept under its record-keeping policy/);
    await fireEvent.press(screen.getByTestId('settings-deletion-info'));
    expect(open).toHaveBeenCalledWith('https://example.invalid/hive/delete-account');
    await fireEvent.press(screen.getByTestId('settings-deletion-request'));
    expect(deletionHandlers.onRequest).toHaveBeenCalled();
    expect(screen.queryByTestId('settings-deletion-withdraw')).toBeNull();
    open.mockRestore();
  });

  it('shows the confirmation with confirm and cancel, and nothing else to press', async () => {
    await render(
      <SettingsView
        canSwitchScope={false}
        signingOut={false}
        deletion={deletion({ flow: { name: 'confirming', action: 'request' } })}
        onSwitchScope={noop}
        onSignOut={noop}
        onBack={noop}
      />,
    );
    expect(screen.getByTestId('settings-deletion-confirm-notice')).toHaveTextContent(
      /Request account deletion\?/,
    );
    expect(screen.getByTestId('settings-deletion-confirm')).toBeTruthy();
    expect(screen.getByTestId('settings-deletion-cancel')).toBeTruthy();
    expect(screen.queryByTestId('settings-deletion-request')).toBeNull();
  });

  it('shows an open request with its date and the way to withdraw it', async () => {
    await render(
      <SettingsView
        canSwitchScope={false}
        signingOut={false}
        deletion={deletion({
          load: {
            name: 'ready',
            latest: {
              id: 'req-1',
              status: 'REQUESTED',
              requestedAt: '2026-09-28T20:00:00Z',
              withdrawnAt: null,
              completedAt: null,
            },
          },
        })}
        onSwitchScope={noop}
        onSignOut={noop}
        onBack={noop}
      />,
    );
    expect(screen.getByTestId('settings-deletion-requested')).toHaveTextContent(
      /Requested September 28, 2026/,
    );
    await fireEvent.press(screen.getByTestId('settings-deletion-withdraw'));
    expect(deletionHandlers.onWithdraw).toHaveBeenCalled();
    expect(screen.queryByTestId('settings-deletion-request')).toBeNull();
  });

  it('sends a stale refusal to refresh, keeps a failure ready to try again, and reports a settled action', async () => {
    await render(
      <SettingsView
        canSwitchScope={false}
        signingOut={false}
        deletion={deletion({
          flow: { name: 'refused', action: 'request', refusal: 'already_requested' },
        })}
        onSwitchScope={noop}
        onSignOut={noop}
        onBack={noop}
      />,
    );
    expect(screen.getByTestId('settings-deletion-refused')).toHaveTextContent(/already open/);
    await fireEvent.press(screen.getByTestId('settings-deletion-refresh'));
    expect(deletionHandlers.onReload).toHaveBeenCalled();
    const failed = await render(
      <SettingsView
        canSwitchScope={false}
        signingOut={false}
        deletion={deletion({
          flow: { name: 'failed', action: 'withdraw', error: new SafeError('network') },
        })}
        onSwitchScope={noop}
        onSignOut={noop}
        onBack={noop}
      />,
    );
    expect(failed.getByTestId('settings-deletion-retry')).toBeTruthy();
    expect(failed.getByTestId('settings-deletion-dismiss')).toBeTruthy();
    const done = await render(
      <SettingsView
        canSwitchScope={false}
        signingOut={false}
        deletion={deletion({
          flow: {
            name: 'done',
            action: 'request',
            receipt: { requestId: 'req-1', status: 'REQUESTED', replayed: false },
          },
        })}
        onSwitchScope={noop}
        onSignOut={noop}
        onBack={noop}
      />,
    );
    expect(done.getByTestId('settings-deletion-done')).toHaveTextContent(/Deletion requested/);
  });
});
