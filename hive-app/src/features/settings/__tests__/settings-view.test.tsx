import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { SettingsView } from '../SettingsView';

const noop = (): void => undefined;

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
