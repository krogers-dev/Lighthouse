/** The service gate: renders the app until a readable pause or an old
 * version interrupts it; re-reads on "Try again"; every event awaited
 * inside act (testing-library 14). */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { ServiceStatus } from '@/core/service-status';

import { ServiceGate } from '../ServiceGate';

const paused: ServiceStatus = {
  state: 'paused',
  reasonCode: 'maintenance',
  minAppVersion: '0.0.0',
  version: 2,
};
const open: ServiceStatus = {
  state: 'open',
  reasonCode: 'none',
  minAppVersion: '0.0.0',
  version: 3,
};

const INSETS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function gate(read: () => Promise<ServiceStatus | null>, appVersion: string) {
  return (
    <SafeAreaProvider initialMetrics={INSETS}>
      <ServiceGate read={read} appVersion={appVersion}>
        <Text testID="app">app</Text>
      </ServiceGate>
    </SafeAreaProvider>
  );
}

function sequence(...answers: (ServiceStatus | null)[]) {
  let calls = 0;
  const read = jest.fn(async () => {
    const answer = answers[Math.min(calls, answers.length - 1)] ?? null;
    calls += 1;
    return answer;
  });
  return read;
}

describe('ServiceGate', () => {
  it('mounts nothing until the first read settles, then renders the app on an unknown status', async () => {
    let settle: (value: ServiceStatus | null) => void = () => undefined;
    const read = jest.fn(
      () =>
        new Promise<ServiceStatus | null>((resolve) => {
          settle = resolve;
        }),
    );
    await render(gate(read, '0.1.0'));
    expect(screen.getByTestId('service-checking')).toBeTruthy();
    expect(screen.queryByTestId('app')).toBeNull();
    await act(async () => {
      settle(null);
    });
    await waitFor(() => expect(screen.getByTestId('app')).toBeTruthy());
    expect(screen.queryByTestId('service-checking')).toBeNull();
  });

  it('renders the app while the status is unknown or open', async () => {
    const read = sequence(null);
    await render(gate(read, '0.1.0'));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('app')).toBeTruthy();
    expect(screen.queryByTestId('service-paused')).toBeNull();
  });

  it('replaces the app with the paused screen, worded for the reason, and reads again on try again', async () => {
    const read = sequence(paused, paused, open);
    await render(gate(read, '0.1.0'));
    await waitFor(() => expect(screen.getByTestId('service-paused')).toBeTruthy());
    expect(screen.queryByTestId('app')).toBeNull();
    expect(screen.getByTestId('service-gate-notice')).toHaveTextContent(/paused for maintenance/);
    expect(screen.getByTestId('service-gate-notice')).toHaveTextContent(
      /Your information is safe and nothing has changed/,
    );
    await act(async () => {
      await fireEvent.press(screen.getByTestId('service-retry'));
    });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('service-paused')).toBeTruthy();
    await act(async () => {
      await fireEvent.press(screen.getByTestId('service-retry'));
    });
    await waitFor(() => expect(screen.getByTestId('app')).toBeTruthy());
    expect(screen.queryByTestId('service-paused')).toBeNull();
  });

  it('tells an app below the minimum version to update, with no way through', async () => {
    const read = sequence({ ...open, minAppVersion: '1.0.0' });
    await render(gate(read, '0.1.0'));
    await waitFor(() => expect(screen.getByTestId('service-update-required')).toBeTruthy());
    expect(screen.getByTestId('service-gate-notice')).toHaveTextContent(/Update HIVE to continue/);
    expect(screen.queryByTestId('service-retry')).toBeNull();
    expect(screen.queryByTestId('app')).toBeNull();
  });
});
