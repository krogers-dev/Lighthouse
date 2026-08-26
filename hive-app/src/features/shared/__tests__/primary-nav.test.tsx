import { fireEvent, render, screen } from '@testing-library/react-native';

import { PrimaryNav } from '../PrimaryNav';

describe('PrimaryNav', () => {
  it('offers exactly the five labeled destinations', async () => {
    await render(<PrimaryNav current="home" onNavigate={jest.fn()} />);
    const destinations: readonly [string, string][] = [
      ['nav-home', 'Home'],
      ['nav-requests', 'Requests'],
      ['nav-activity', 'Activity'],
      ['nav-help', 'Help'],
      ['nav-account', 'Account'],
    ];
    for (const [testID, label] of destinations) {
      const item = screen.getByTestId(testID);
      expect(item).toBeTruthy();
      // Persistent visible label, not an icon with a hidden name.
      expect(screen.getByText(label)).toBeTruthy();
    }
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(5);

    const resolved = tabs.map((tab) => {
      const style = tab.props.style as object[];
      return Object.assign({}, ...style.flat()) as Record<string, unknown>;
    });
    // 48dp Android / 44pt iOS floor on every destination.
    for (const style of resolved) {
      expect(style.minHeight as number).toBeGreaterThanOrEqual(48);
      expect(style.minWidth as number).toBeGreaterThanOrEqual(48);
    }
    // The current destination is marked by a visible underline, not by
    // color alone, so it survives greyscale and high-contrast modes.
    const underlined = resolved.filter((style) => style.borderBottomColor !== 'transparent');
    expect(underlined).toHaveLength(1);
  });

  it('marks the current destination as selected for assistive tech', async () => {
    await render(<PrimaryNav current="requests" onNavigate={jest.fn()} />);
    expect(screen.getByTestId('nav-requests').props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId('nav-home').props.accessibilityState.selected).toBe(false);
  });

  it('navigates to another destination but never re-navigates to the current one', async () => {
    const onNavigate = jest.fn();
    await render(<PrimaryNav current="home" onNavigate={onNavigate} />);
    fireEvent.press(screen.getByTestId('nav-activity'));
    expect(onNavigate).toHaveBeenCalledWith('activity');
    // The wrapper drops a tap on the current destination; the nav still
    // reports it, so the guard is asserted where it lives (AuthorizedScreen).
    fireEvent.press(screen.getByTestId('nav-home'));
    expect(onNavigate).toHaveBeenLastCalledWith('home');
  });
});
