import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { formatServerDate } from '@/features/shared/labels';

import { HELP_CONTENT_UPDATED, HELP_CONTENT_VERSION, HelpView } from '../HelpView';

describe('HelpView', () => {
  it('renders every section from shipped content, with no network read', async () => {
    await render(<HelpView />);
    for (const id of [
      'help-section-what-hive-shows',
      'help-section-requests',
      'help-section-activity',
      'help-section-workspaces',
      'help-section-contact',
    ]) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
  });

  it('records which help text the build shipped, as a plain date with the version behind it', async () => {
    await render(<HelpView />);
    expect(screen.getByTestId('help-version')).toHaveTextContent(
      `Help text updated ${formatServerDate(HELP_CONTENT_UPDATED)} (version ${HELP_CONTENT_VERSION})`,
    );
    expect(HELP_CONTENT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(HELP_CONTENT_UPDATED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('shows the configured support address as a tappable line, and only then', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await render(<HelpView supportEmail="team@example.invalid" />);
    const button = screen.getByRole('button', { name: 'Email team@example.invalid' });
    await fireEvent.press(button);
    expect(open).toHaveBeenCalledWith('mailto:team@example.invalid');
    open.mockRestore();
  });

  it('invents no support channel that has not been approved', async () => {
    await render(<HelpView />);
    const text = JSON.stringify(screen.toJSON());
    // No fabricated address, phone number, or URL may ship as guidance.
    expect(text).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i);
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(/\+?\d[\d\s().-]{7,}\d/);
  });
});
