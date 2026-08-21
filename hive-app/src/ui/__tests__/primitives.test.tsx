import { fireEvent, render, screen } from '@testing-library/react-native';

import { SafeError } from '@/core/errors';
import { Button } from '../primitives/Button';
import { Notice } from '../primitives/Notice';
import { StatusBadge } from '../primitives/StatusBadge';
import { TextField } from '../primitives/TextField';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  OfflineState,
  QuarantineState,
} from '../primitives/states';

describe('Button', () => {
  it('exposes role, label, and enabled press', async () => {
    const onPress = jest.fn();
    await render(<Button label="Continue" onPress={onPress} />);
    const button = screen.getByRole('button', { name: 'Continue' });
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('blocks press and reports state when disabled', async () => {
    const onPress = jest.fn();
    await render(<Button label="Continue" onPress={onPress} disabled />);
    const button = screen.getByRole('button', { name: 'Continue' });
    expect(button.props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('keeps the label visible and blocks re-press while loading', async () => {
    const onPress = jest.fn();
    await render(<Button label="Send code" onPress={onPress} loading />);
    const button = screen.getByRole('button', { name: 'Send code' });
    expect(button.props.accessibilityState.busy).toBe(true);
    expect(screen.getByText('Send code')).toBeTruthy();
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('TextField', () => {
  it('renders a persistent label wired to the input', async () => {
    await render(<TextField label="Email" value="" onChangeText={() => undefined} />);
    expect(screen.getByText('Email')).toBeTruthy();
    expect(screen.getByLabelText('Email')).toBeTruthy();
  });

  it('announces errors as text, not color alone', async () => {
    await render(
      <TextField
        label="Code"
        value=""
        onChangeText={() => undefined}
        errorText="That code was not accepted"
      />,
    );
    expect(screen.getByText('Error: That code was not accepted')).toBeTruthy();
  });

  it('propagates text changes', async () => {
    const onChange = jest.fn();
    await render(<TextField label="Email" value="" onChangeText={onChange} />);
    await fireEvent.changeText(screen.getByLabelText('Email'), 'person@example.invalid');
    expect(onChange).toHaveBeenCalledWith('person@example.invalid');
  });
});

describe('StatusBadge', () => {
  it('always pairs the status word with the label in the accessible name', async () => {
    await render(<StatusBadge kind="attention" label="One item needs review" />);
    expect(screen.getByLabelText('Needs attention: One item needs review')).toBeTruthy();
    expect(screen.getByText(/Needs attention/)).toBeTruthy();
  });
});

describe('Notice', () => {
  it('exposes danger notices as alerts with tone words in text', async () => {
    await render(<Notice tone="danger" title="Reset needed" body="Details here" />);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Problem: Reset needed')).toBeTruthy();
  });
});

describe('screen states', () => {
  it('LoadingState announces politely', async () => {
    await render(<LoadingState label="Loading requests" />);
    expect(screen.getByText('Loading requests')).toBeTruthy();
  });

  it('EmptyState offers a single optional action', async () => {
    const onAction = jest.fn();
    await render(<EmptyState title="Nothing waiting" actionLabel="Refresh" onAction={onAction} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Refresh' }));
    expect(onAction).toHaveBeenCalled();
  });

  it('ErrorState shows only the safe user message', async () => {
    await render(<ErrorState error={new SafeError('network')} />);
    expect(
      screen.getByText('We could not reach the service. Check your connection and try again.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('OfflineState explains that stale copies are never shown', async () => {
    await render(<OfflineState />);
    expect(screen.getByText(/Nothing is shown from stale copies/)).toBeTruthy();
  });

  it('QuarantineState offers only the scrub action', async () => {
    const onScrub = jest.fn();
    await render(<QuarantineState onScrub={onScrub} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Reset secure sign-in data' }));
    expect(onScrub).toHaveBeenCalled();
  });

  it('QuarantineState hides the action while a scrub runs', async () => {
    await render(<QuarantineState onScrub={() => undefined} scrubInProgress />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Resetting secure sign-in data')).toBeTruthy();
  });
});
