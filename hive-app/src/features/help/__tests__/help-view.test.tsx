import { render, screen } from '@testing-library/react-native';

import { HELP_CONTENT_VERSION, HelpView } from '../HelpView';

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

  it('records which help text the build shipped', async () => {
    await render(<HelpView />);
    expect(screen.getByTestId('help-version')).toHaveTextContent(
      `Help content version ${HELP_CONTENT_VERSION}`,
    );
    expect(HELP_CONTENT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
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
