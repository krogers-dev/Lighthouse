/** WO-002 A4 — accessibility checks for every screen Milestone 1 adds.
 *
 * These are screen-level, not primitive-level: the primitives already
 * have their own contrast and target-size tests, but a screen can still
 * regress by rendering a bare `Pressable` beside them, by losing the
 * header that a rotor lands on, or by letting a control lose its name.
 * Each assertion below is a property a screen reader or switch-control
 * user depends on, checked against the real views with real props.
 *
 * What is NOT claimed here: device screen-reader behaviour, or the
 * rendered width of a control that stretches to its container. VoiceOver
 * and TalkBack QA and measured target sizes are device-lane items and
 * stay outstanding; this file proves only what a jest render can prove,
 * and the width assertion below is deliberately limited to controls that
 * constrain their own width.
 */
import { render, screen } from '@testing-library/react-native';

import { SafeError } from '@/core/errors';
import type {
  ActivityEntry,
  CaseSummary,
  RequestDetail,
  RequestSummary,
  ScopedList,
} from '@/data/supabase/repositories';
import { ActivityView } from '@/features/activity/ActivityView';
import { DashboardView } from '@/features/dashboard/DashboardView';
import { HelpView } from '@/features/help/HelpView';
import { RequestDetailView } from '@/features/requests/RequestDetailView';
import { RequestsView } from '@/features/requests/RequestsView';
import { SettingsView } from '@/features/settings/SettingsView';
import { touchTarget } from '@/ui/tokens';

const WORKSPACE = 'Harbor Light Bakery LLC (Synthetic)';

const CASES: ScopedList<CaseSummary> = {
  items: [
    {
      id: 'case-a',
      title: '2025 books close (Synthetic)',
      status: 'EVIDENCE_PENDING',
      statusChangedAt: '2026-08-21T00:00:00Z',
      attentionSummary: 'One statement is still needed (Synthetic)',
      nextActionSummary: 'Provide the missing statement (Synthetic)',
      nextActionOwnerRole: 'client_user',
    },
  ],
  recordedThrough: '2026-08-21T00:00:00Z',
};

const REQUESTS: ScopedList<RequestSummary> = {
  items: [
    {
      id: 'req-a',
      title: 'June bank statement (Synthetic)',
      status: 'OPEN',
      ownerRole: 'client_user',
      requestedOn: '2026-08-01',
      dueOn: '2026-08-30',
    },
  ],
  recordedThrough: '2026-08-01',
};

const REQUEST_DETAIL: RequestDetail = {
  id: 'req-a',
  title: 'June bank statement (Synthetic)',
  status: 'OPEN',
  ownerRole: 'client_user',
  requestedOn: '2026-08-01',
  dueOn: '2026-08-30',
  detail: 'Please provide the June statement for the operating account (Synthetic).',
};

const ACTIVITY: ScopedList<ActivityEntry> = {
  items: [
    {
      id: 'evt-a',
      kind: 'request.opened',
      actorRole: 'preparer',
      occurredAt: '2026-08-01T15:00:00Z',
    },
  ],
  recordedThrough: '2026-08-01T15:00:00Z',
};

const noop = (): void => {};

interface ScreenCase {
  /** Name in the test title. */
  name: string;
  /** The header a rotor should land on FIRST. */
  header: string;
  /** Whether this screen ships any interactive control at all. Help is
   * deliberately `false`: it is shipped static content with nothing to
   * reload, so "no control" is the specification, not an oversight, and
   * asserting it stops a stray control from appearing unnoticed. */
  controls: boolean;
  render: () => React.JSX.Element;
}

/** Every Milestone 1 screen in its content-bearing state, plus the two
 * non-ready states that still have to carry a named recovery control. */
const SCREENS: readonly ScreenCase[] = [
  {
    name: 'Home',
    header: 'Home',
    controls: true,
    render: () => (
      <DashboardView
        state="ready"
        workspaceName={WORKSPACE}
        data={CASES}
        onRetry={noop}
        onSwitchScope={noop}
      />
    ),
  },
  {
    name: 'Requests',
    header: 'Requests',
    controls: true,
    render: () => (
      <RequestsView
        state="ready"
        workspaceName={WORKSPACE}
        data={REQUESTS}
        onRetry={noop}
        onSwitchScope={noop}
        onOpenRequest={noop}
      />
    ),
  },
  {
    name: 'Request detail',
    header: 'Request',
    controls: true,
    render: () => (
      <RequestDetailView state="ready" request={REQUEST_DETAIL} onRetry={noop} onBack={noop} />
    ),
  },
  {
    name: 'Activity',
    header: 'Activity',
    controls: true,
    render: () => (
      <ActivityView
        state="ready"
        workspaceName={WORKSPACE}
        data={ACTIVITY}
        onRetry={noop}
        onSwitchScope={noop}
      />
    ),
  },
  { name: 'Help', header: 'Help', controls: false, render: () => <HelpView /> },
  {
    name: 'Account',
    header: 'Account',
    controls: true,
    render: () => (
      <SettingsView
        workspaceName={WORKSPACE}
        canSwitchScope
        signingOut={false}
        onSwitchScope={noop}
        onSignOut={noop}
        onBack={noop}
      />
    ),
  },
  {
    name: 'Home (error)',
    header: 'Home',
    controls: true,
    render: () => (
      <DashboardView
        state="error"
        workspaceName={WORKSPACE}
        error={new SafeError('unknown')}
        onRetry={noop}
      />
    ),
  },
  {
    name: 'Requests (denied)',
    header: 'Requests',
    controls: true,
    render: () => (
      <RequestsView
        state="denied"
        workspaceName={WORKSPACE}
        onRetry={noop}
        onSwitchScope={noop}
        onOpenRequest={noop}
      />
    ),
  },
];

/** One rendered host element, as the test renderer models it. Taken from
 * the query's own return type so this file does not name the renderer
 * package directly. */
type Rendered = ReturnType<typeof screen.container.queryAll>[number];

/** Flatten a style prop — array, nested array, or object — into one map,
 * the way React Native resolves it. */
function resolveStyle(node: Rendered): Record<string, unknown> {
  const style = node.props.style as unknown;
  if (Array.isArray(style)) return Object.assign({}, ...style.flat(Infinity).filter(Boolean));
  return (style ?? {}) as Record<string, unknown>;
}

/** The accessible name a screen reader would announce: an explicit label
 * if there is one, otherwise the text the element contains. */
function accessibleName(node: Rendered): string {
  const label = node.props.accessibilityLabel as unknown;
  if (typeof label === 'string' && label.trim() !== '') return label.trim();
  const texts: string[] = [];
  const walk = (child: unknown): void => {
    if (typeof child === 'string') {
      texts.push(child);
      return;
    }
    if (Array.isArray(child)) {
      for (const item of child) walk(item);
      return;
    }
    if (child && typeof child === 'object' && 'props' in (child as object)) {
      walk((child as { props: { children?: unknown } }).props?.children);
    }
  };
  walk(node.props.children);
  return texts.join(' ').trim();
}

/** Every rendered element that responds to a touch. Found by the responder
 * handlers React Native attaches to a pressable's host view — NOT by
 * accessibilityRole, which is the whole point: an element that reacts to
 * a tap while carrying no role is exactly the defect being looked for,
 * and a role-based query could never see it. */
function pressableNodes(): Rendered[] {
  return screen.container.queryAll(
    (node) =>
      typeof node.props?.onStartShouldSetResponder === 'function' ||
      typeof node.props?.onClick === 'function',
  );
}

describe.each(SCREENS)(
  '$name accessibility',
  ({ name, header: expectedHeader, controls, render: renderScreen }) => {
    it('opens with a header naming the screen, so the rotor has somewhere to land', async () => {
      await render(renderScreen());
      const headers = screen.queryAllByRole('header');
      expect(headers.length).toBeGreaterThanOrEqual(1);
      // The FIRST header is the screen's own title. A section heading that
      // drifted above it would leave a reader unsure which screen they are on.
      expect(accessibleName(headers[0]!)).toBe(expectedHeader);
      for (const header of headers) expect(accessibleName(header)).not.toBe('');
    });

    it('gives every element that handles a press a role and a non-empty name', async () => {
      await render(renderScreen());
      const nodes = pressableNodes();
      // Pinned per screen so this can never pass vacuously: a screen that
      // should offer a control but silently rendered none fails here, and
      // a control appearing on the static Help screen fails here too.
      expect({ screen: name, hasControls: nodes.length > 0 }).toEqual({
        screen: name,
        hasControls: controls,
      });
      for (const node of nodes) {
        expect({
          screen: name,
          role: (node.props.accessibilityRole as string | undefined) ?? '',
          name: accessibleName(node),
        }).toEqual({
          screen: name,
          role: expect.stringMatching(/\S/),
          name: expect.stringMatching(/\S/),
        });
      }
    });

    it('meets the 44pt iOS / 48dp Android height floor on every control', async () => {
      await render(renderScreen());
      for (const node of pressableNodes()) {
        const style = resolveStyle(node);
        expect({ screen: name, minHeight: Number(style.minHeight ?? 0) }).toEqual({
          screen: name,
          minHeight: expect.any(Number),
        });
        expect(Number(style.minHeight ?? 0)).toBeGreaterThanOrEqual(touchTarget.minHeight);
      }
    });

    it('meets the width floor on any control that constrains its own width', async () => {
      await render(renderScreen());
      for (const node of pressableNodes()) {
        const style = resolveStyle(node);
        // A control stretched by its column parent is as wide as the
        // screen; only one that opts out of that stretch, or sets its own
        // width, can be too narrow in a way a jest render can see.
        const constrains =
          style.alignSelf === 'flex-start' ||
          style.alignSelf === 'flex-end' ||
          style.alignSelf === 'center' ||
          typeof style.width === 'number' ||
          typeof style.maxWidth === 'number';
        if (!constrains) continue;
        const widest = Math.max(
          Number(style.width ?? 0),
          Number(style.minWidth ?? 0),
          Number(style.maxWidth ?? 0),
        );
        expect({ screen: name, widest }).toEqual({ screen: name, widest: expect.any(Number) });
        expect(widest).toBeGreaterThanOrEqual(touchTarget.minWidth);
      }
    });
  },
);

describe('read-surface accessibility properties that span the screens', () => {
  it('never conveys status by colour alone: every badge speaks and prints its kind', async () => {
    await render(
      <RequestsView
        state="ready"
        workspaceName={WORKSPACE}
        data={REQUESTS}
        onRetry={noop}
        onOpenRequest={noop}
      />,
    );
    // The badge's accessible name carries the kind word, and the visible
    // text carries a glyph + the kind word, so status survives greyscale,
    // high contrast, and a screen reader alike.
    expect(screen.getByLabelText('Needs attention: Needs a response')).toBeTruthy();
    expect(screen.getByText('! Needs attention')).toBeTruthy();
  });

  it('keeps a named recovery control in every recoverable non-ready state', async () => {
    const states: readonly ['offline' | 'error', string][] = [
      ['offline', 'activity-offline'],
      ['error', 'activity-error'],
    ];
    for (const [state, testID] of states) {
      const view = await render(
        <ActivityView
          state={state}
          workspaceName={WORKSPACE}
          error={new SafeError('network')}
          onRetry={noop}
        />,
      );
      expect(screen.getByTestId(testID)).toBeTruthy();
      const buttons = screen.queryAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
      // Named in words, never an unlabelled icon.
      for (const button of buttons) expect(accessibleName(button)).not.toBe('');
      await view.unmount();
    }
  });

  it('marks every help section heading as a header, so sections are navigable', async () => {
    await render(<HelpView />);
    // The screen title plus one header per section: a reader can move
    // section to section instead of listening to the whole page.
    const headers = screen.queryAllByRole('header');
    expect(headers.map((header) => accessibleName(header))).toEqual([
      'Help',
      'What this app shows',
      'Requests',
      'Activity',
      'Workspaces',
      'Getting help from a person',
    ]);
  });

  it('names each case card region without repeating the whole card as one string', async () => {
    await render(
      <DashboardView state="ready" workspaceName={WORKSPACE} data={CASES} onRetry={noop} />,
    );
    // The case card is not pressable in Milestone 1 (nothing to open
    // yet), so its content must stay individually reachable rather than
    // being collapsed behind a single accessible label.
    expect(screen.getByTestId('dashboard-case-case-a').props.accessible).not.toBe(true);
    expect(screen.getByText('2025 books close (Synthetic)')).toBeTruthy();
    expect(screen.getByLabelText('Needs attention: Waiting on records')).toBeTruthy();
  });
});
