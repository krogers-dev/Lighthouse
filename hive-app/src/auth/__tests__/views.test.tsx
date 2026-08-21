import { fireEvent, render, screen } from '@testing-library/react-native';

import { MfaView } from '../views/MfaView';
import { OtpView } from '../views/OtpView';
import { SignInView } from '../views/SignInView';

describe('SignInView', () => {
  it('submits a trimmed email and disables submit when empty', async () => {
    const onSubmit = jest.fn();
    await render(<SignInView onSubmitEmail={onSubmit} busy={false} />);
    const submit = screen.getByTestId('sign-in-submit');
    expect(submit.props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(
      screen.getByLabelText('Email'),
      '  client.owner@example.invalid  ',
    );
    await fireEvent.press(screen.getByTestId('sign-in-submit'));
    expect(onSubmit).toHaveBeenCalledWith('client.owner@example.invalid');
  });

  it('shows safe notices and signed-out reasons as text', async () => {
    await render(
      <SignInView
        onSubmitEmail={() => undefined}
        busy={false}
        notice="network"
        signedOutReason="expired"
      />,
    );
    expect(screen.getByText(/could not reach the service/)).toBeTruthy();
    expect(screen.getByText(/Your session ended/)).toBeTruthy();
  });
});

describe('OtpView', () => {
  const baseProps = {
    email: 'client.owner@example.invalid',
    otpSent: true,
    verifying: false,
    onSubmitCode: jest.fn(),
    onResend: jest.fn(),
    onCancel: jest.fn(),
  };

  it('submits the entered code', async () => {
    const onSubmitCode = jest.fn();
    await render(<OtpView {...baseProps} onSubmitCode={onSubmitCode} />);
    await fireEvent.changeText(screen.getByLabelText('One-time code'), '123456');
    await fireEvent.press(screen.getByTestId('otp-submit'));
    expect(onSubmitCode).toHaveBeenCalledWith('123456');
  });

  it('offers a safe back action and resend', async () => {
    const onCancel = jest.fn();
    const onResend = jest.fn();
    await render(<OtpView {...baseProps} onCancel={onCancel} onResend={onResend} />);
    await fireEvent.press(screen.getByTestId('otp-cancel'));
    await fireEvent.press(screen.getByTestId('otp-resend'));
    expect(onCancel).toHaveBeenCalled();
    expect(onResend).toHaveBeenCalled();
  });

  it('shows a rejected-code notice as text', async () => {
    await render(<OtpView {...baseProps} notice="auth_invalid" />);
    expect(screen.getByText(/code was not accepted/)).toBeTruthy();
  });
});

describe('MfaView', () => {
  it('submits the TOTP code and allows sign-out', async () => {
    const onSubmitCode = jest.fn();
    const onSignOut = jest.fn();
    await render(
      <MfaView verifying={false} onSubmitCode={onSubmitCode} onSignOut={onSignOut} />,
    );
    await fireEvent.changeText(screen.getByLabelText('Authenticator code'), '654321');
    await fireEvent.press(screen.getByTestId('mfa-submit'));
    expect(onSubmitCode).toHaveBeenCalledWith('654321');
    await fireEvent.press(screen.getByTestId('mfa-sign-out'));
    expect(onSignOut).toHaveBeenCalled();
  });
});
