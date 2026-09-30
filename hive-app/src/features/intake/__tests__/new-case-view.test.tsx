import { fireEvent, render, screen } from '@testing-library/react-native';

import { SafeError } from '@/core/errors';

import { type NewCaseFlowState, NewCaseView, type NewCaseViewProps } from '../NewCaseView';

const handlers = {
  onRetry: jest.fn(),
  onSwitchScope: jest.fn(),
  onChangeTitle: jest.fn(),
  onRequest: jest.fn(),
  onConfirm: jest.fn(),
  onCancel: jest.fn(),
  onDismiss: jest.fn(),
  onTryAgain: jest.fn(),
  onOpened: jest.fn(),
  onBack: jest.fn(),
};

const base: Omit<NewCaseViewProps, 'flow'> = {
  state: 'ready',
  workspaceName: 'Harbor Light Bakery LLC (Synthetic)',
  allowed: true,
  ...handlers,
};

const idle: NewCaseFlowState = { name: 'idle', draft: { title: '' } };

function view(flow: NewCaseFlowState, overrides: Partial<NewCaseViewProps> = {}) {
  return <NewCaseView {...base} {...overrides} flow={flow} />;
}

describe('NewCaseView', () => {
  it('shows the workspace, the title field with its bound, and one primary action', async () => {
    await render(view({ name: 'idle', draft: { title: 'Books close 2026 (Synthetic)' } }));
    expect(screen.getByTestId('new-case-form')).toBeTruthy();
    expect(screen.getByText('For Harbor Light Bakery LLC (Synthetic).')).toBeTruthy();
    expect(screen.getByTestId('new-case-title-label')).toHaveTextContent('Case title');
    expect(screen.getByText(/28 of 120 characters/)).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('new-case-title'), 'Books');
    expect(handlers.onChangeTitle).toHaveBeenCalledWith('Books');
    await fireEvent.press(screen.getByTestId('new-case-open'));
    expect(handlers.onRequest).toHaveBeenCalledTimes(1);
  });

  it('confirms with the cleaned title and says what the client sees', async () => {
    await render(
      view({ name: 'confirming', draft: { title: '  Books   close 2026 (Synthetic) ' } }),
    );
    expect(screen.getByTestId('new-case-confirm-panel')).toHaveTextContent(
      /Books close 2026 \(Synthetic\)/,
    );
    expect(screen.getByTestId('new-case-confirm-panel')).toHaveTextContent(/Being set up/);
    expect(screen.queryByTestId('new-case-title')).toBeNull();
    await fireEvent.press(screen.getByTestId('new-case-confirm'));
    expect(handlers.onConfirm).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('new-case-cancel'));
    expect(handlers.onCancel).toHaveBeenCalledTimes(1);
  });

  it('goes to the case once it is opened, and offers no other way on', async () => {
    await render(
      view({
        name: 'done',
        draft: { title: 'Books (Synthetic)' },
        result: { caseId: 'case-1', caseStatus: 'DRAFT', caseVersion: 1 },
      }),
    );
    expect(screen.getByTestId('new-case-done')).toHaveTextContent(/Case opened/);
    expect(screen.queryByTestId('new-case-back')).toBeNull();
    await fireEvent.press(screen.getByTestId('new-case-go'));
    expect(handlers.onOpened).toHaveBeenCalledWith('case-1');
  });

  it('words a refusal, sends a stale one home and an editable one back to the field', async () => {
    await render(view({ name: 'refused', draft: { title: '' }, refusal: 'title_missing' }));
    expect(screen.getByTestId('new-case-refused')).toHaveTextContent(/Give it a title first/);
    expect(screen.getByTestId('new-case-dismiss')).toBeTruthy();
    await render(
      view({ name: 'refused', draft: { title: 'x'.repeat(5) }, refusal: 'too_many_drafts' }),
    );
    expect(screen.getByTestId('new-case-refused')).toHaveTextContent(/Too many drafts/);
    expect(screen.getByTestId('new-case-back-stale')).toBeTruthy();
  });

  it('shows a failure with retry, and the busy state with no way back', async () => {
    await render(
      view({ name: 'failed', draft: { title: 'Books' }, error: new SafeError('network') }),
    );
    expect(screen.getByTestId('new-case-failed')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('new-case-retry'));
    expect(handlers.onTryAgain).toHaveBeenCalledTimes(1);
    await render(view({ name: 'running', draft: { title: 'Books' } }));
    expect(screen.getByTestId('new-case-running')).toBeTruthy();
    expect(screen.queryByTestId('new-case-back')).toBeNull();
  });

  it('tells anyone who is not intake that the page is for intake, with the way back', async () => {
    await render(view(idle, { allowed: false }));
    expect(screen.getByTestId('new-case-not-allowed')).toBeTruthy();
    expect(screen.queryByTestId('new-case-form')).toBeNull();
    await fireEvent.press(screen.getByTestId('new-case-back'));
    expect(handlers.onBack).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['loading', 'new-case-loading'],
    ['offline', 'new-case-offline'],
    ['denied', 'new-case-denied'],
    ['stale_scope', 'new-case-stale'],
  ] as const)('shows the %s state explicitly', async (state, testID) => {
    await render(view(idle, { state }));
    expect(screen.getByTestId(testID)).toBeTruthy();
    expect(screen.queryByTestId('new-case-form')).toBeNull();
  });
});
