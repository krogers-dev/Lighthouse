import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppText } from '../primitives/AppText';
import { Screen } from '../primitives/Screen';

const INSETS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

type Json = { type?: string; props?: Record<string, unknown>; children?: Json[] | null };

const collect = (node: Json | null, hit: (n: Json) => boolean, into: Json[] = []): Json[] => {
  if (!node || typeof node !== 'object') return into;
  if (hit(node)) into.push(node);
  for (const child of node.children ?? []) collect(child, hit, into);
  return into;
};

describe('Screen', () => {
  it('carries the HIVE lockup on the header band above the scroll area by default', async () => {
    await render(
      <SafeAreaProvider initialMetrics={INSETS}>
        <Screen testID="s">
          <AppText>content</AppText>
        </Screen>
      </SafeAreaProvider>,
    );
    expect(screen.getByText('HIVE')).toBeTruthy();
    expect(screen.getByText('by Honeybee Accounting')).toBeTruthy();
    const tree = screen.toJSON() as unknown as Json;
    const scrollers = collect(
      tree,
      (n) => typeof n.type === 'string' && n.type.includes('ScrollView'),
    );
    expect(scrollers).toHaveLength(1);
    // The lockup is chrome, not content: it must not be inside the scroller.
    const lockupInside = collect(scrollers[0] as Json, (n) =>
      JSON.stringify(n.children ?? []).includes('by Honeybee Accounting'),
    );
    expect(lockupInside).toHaveLength(0);
  });

  it('omits the header when a screen passes null', async () => {
    await render(
      <SafeAreaProvider initialMetrics={INSETS}>
        <Screen testID="s" header={null}>
          <AppText>content</AppText>
        </Screen>
      </SafeAreaProvider>,
    );
    expect(screen.queryByText('by Honeybee Accounting')).toBeNull();
  });

  // Find 49: under Android edge-to-edge the window is not resized for the
  // keyboard, so the scroll area must make room itself or controls below
  // the focused field on a long screen stay under the keyboard at maximum
  // scroll. The shell wraps the content in a keyboard-avoiding container in
  // padding mode: React Native renders that as a view that measures itself
  // (onLayout) and carries a paddingBottom it grows by the measured overlap.
  const flatten = (style: unknown): Record<string, unknown> =>
    Array.isArray(style)
      ? Object.assign({}, ...style.flat(Infinity).filter(Boolean))
      : ((style ?? {}) as Record<string, unknown>);

  it('wraps the scroll area in a keyboard-avoiding container that pads by the overlap', async () => {
    await render(
      <SafeAreaProvider initialMetrics={INSETS}>
        <Screen testID="s">
          <AppText>content</AppText>
        </Screen>
      </SafeAreaProvider>,
    );
    const room = screen.getByTestId('screen-keyboard-room');
    expect(typeof room.props.onLayout).toBe('function');
    expect(flatten(room.props.style).paddingBottom).toBe(0);
    const tree = screen.toJSON() as unknown as Json;
    const roomNode = collect(tree, (n) => n.props?.['testID'] === 'screen-keyboard-room');
    expect(roomNode).toHaveLength(1);
    const scrollersInside = collect(
      roomNode[0] as Json,
      (n) => typeof n.type === 'string' && n.type.includes('ScrollView'),
    );
    expect(scrollersInside).toHaveLength(1);
    // The header band stays outside the container: it is chrome, not content.
    const lockupInside = collect(roomNode[0] as Json, (n) =>
      JSON.stringify(n.children ?? []).includes('by Honeybee Accounting'),
    );
    expect(lockupInside).toHaveLength(0);
  });

  it('keeps the non-scrolling variant inside the same keyboard-avoiding container', async () => {
    await render(
      <SafeAreaProvider initialMetrics={INSETS}>
        <Screen testID="s" scroll={false}>
          <AppText>content</AppText>
        </Screen>
      </SafeAreaProvider>,
    );
    const room = screen.getByTestId('screen-keyboard-room');
    expect(typeof room.props.onLayout).toBe('function');
    expect(flatten(room.props.style).paddingBottom).toBe(0);
    expect(screen.getByText('content')).toBeTruthy();
  });
});
