import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Keyboard, Platform, type KeyboardEvent } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppText } from '../primitives/AppText';
import { Screen, keyboardRoomFor } from '../primitives/Screen';
import {
  type KeyboardRoomSample,
  setKeyboardRoomObserver,
} from '../primitives/keyboard-room-probe';

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
  // scroll. The shell's container measures its own bottom and pads by the
  // part of it the keyboard covers, computed from the keyboard's reported
  // HEIGHT (the event's screenY is wrong under edge-to-edge, see the
  // primitive). The arithmetic is pure and tested first; the wiring second.
  const flatten = (style: unknown): Record<string, unknown> =>
    Array.isArray(style)
      ? Object.assign({}, ...style.flat(Infinity).filter(Boolean))
      : ((style ?? {}) as Record<string, unknown>);

  describe('keyboardRoomFor', () => {
    it('pads by the covered part of the container on Android, adding the bar inset the height excludes', () => {
      // Pixel 8 emulator, 914-unit window, 336-unit keyboard reported as 312
      // above a 24-unit navigation bar; the container ends at the window bottom.
      expect(
        keyboardRoomFor({
          containerBottom: 914,
          windowHeight: 914,
          keyboardHeight: 312,
          bottomInset: 24,
          platform: 'android',
        }),
      ).toBe(336);
    });

    it('pads only by the overlap when a footer sits below the container', () => {
      expect(
        keyboardRoomFor({
          containerBottom: 834,
          windowHeight: 914,
          keyboardHeight: 312,
          bottomInset: 24,
          platform: 'android',
        }),
      ).toBe(256);
    });

    it('is zero when the keyboard is hidden, the container is unmeasured, or the window resized', () => {
      const base = {
        windowHeight: 914,
        keyboardHeight: 312,
        bottomInset: 24,
        platform: 'android' as const,
      };
      expect(keyboardRoomFor({ ...base, containerBottom: 914, keyboardHeight: 0 })).toBe(0);
      expect(keyboardRoomFor({ ...base, containerBottom: null })).toBe(0);
      // A window that shrank already ends at the keyboard's top edge.
      expect(keyboardRoomFor({ ...base, containerBottom: 578 })).toBe(0);
    });

    it('uses the full reported height on iOS, whose keyboard height includes the home-indicator area', () => {
      expect(
        keyboardRoomFor({
          containerBottom: 844,
          windowHeight: 844,
          keyboardHeight: 336,
          bottomInset: 34,
          platform: 'ios',
        }),
      ).toBe(336);
    });
  });

  it('pads the container from the keyboard events and clears it when the keyboard hides', async () => {
    const listeners: Record<string, (event: KeyboardEvent) => void> = {};
    const addListener = jest
      .spyOn(Keyboard, 'addListener')
      .mockImplementation((name: string, handler: (event: KeyboardEvent) => void) => {
        listeners[name] = handler;
        return { remove: jest.fn() } as unknown as ReturnType<typeof Keyboard.addListener>;
      });
    try {
      await render(
        <SafeAreaProvider initialMetrics={INSETS}>
          <Screen testID="s">
            <AppText>content</AppText>
          </Screen>
        </SafeAreaProvider>,
      );
      const room = screen.getByTestId('screen-keyboard-room');
      expect(flatten(room.props.style).paddingBottom).toBe(0);
      // The container reports where it ends: here, at the jest window's
      // bottom (1334 units), below a 100-unit header band.
      await act(async () => {
        fireEvent(room, 'layout', {
          nativeEvent: { layout: { x: 0, y: 100, width: 750, height: 1234 } },
        });
      });
      const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
      const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
      expect(typeof listeners[showEvent]).toBe('function');
      expect(typeof listeners[hideEvent]).toBe('function');
      await act(async () => {
        listeners[showEvent]!({
          endCoordinates: { height: 312, screenY: 1334, screenX: 0, width: 750 },
          startCoordinates: { height: 0, screenY: 1334, screenX: 0, width: 750 },
          duration: 0,
          easing: 'keyboard',
          isEventFromThisApp: true,
        } as KeyboardEvent);
      });
      const expected = keyboardRoomFor({
        containerBottom: 1334,
        windowHeight: 1334,
        keyboardHeight: 312,
        bottomInset: INSETS.insets.bottom,
        platform: Platform.OS,
      });
      expect(expected).toBeGreaterThan(0);
      expect(flatten(screen.getByTestId('screen-keyboard-room').props.style).paddingBottom).toBe(
        expected,
      );
      await act(async () => {
        listeners[hideEvent]!({
          endCoordinates: { height: 0, screenY: 1334, screenX: 0, width: 750 },
          startCoordinates: { height: 312, screenY: 1022, screenX: 0, width: 750 },
          duration: 0,
          easing: 'keyboard',
          isEventFromThisApp: true,
        } as KeyboardEvent);
      });
      expect(flatten(screen.getByTestId('screen-keyboard-room').props.style).paddingBottom).toBe(0);
    } finally {
      addListener.mockRestore();
    }
  });

  it('reports every input of the computation through the observation seam (find 49, third iteration)', async () => {
    const listeners: Record<string, (event: KeyboardEvent) => void> = {};
    const addListener = jest
      .spyOn(Keyboard, 'addListener')
      .mockImplementation((name: string, handler: (event: KeyboardEvent) => void) => {
        listeners[name] = handler;
        return { remove: jest.fn() } as unknown as ReturnType<typeof Keyboard.addListener>;
      });
    const samples: KeyboardRoomSample[] = [];
    setKeyboardRoomObserver((sample) => samples.push(sample));
    try {
      await render(
        <SafeAreaProvider initialMetrics={INSETS}>
          <Screen testID="s">
            <AppText>content</AppText>
          </Screen>
        </SafeAreaProvider>,
      );
      // Mounted: nothing measured, no keyboard, zero room.
      expect(samples[samples.length - 1]).toMatchObject({
        platform: Platform.OS,
        containerBottom: null,
        keyboardHeight: 0,
        bottomInset: INSETS.insets.bottom,
        room: 0,
      });
      await act(async () => {
        fireEvent(screen.getByTestId('screen-keyboard-room'), 'layout', {
          nativeEvent: { layout: { x: 0, y: 100, width: 750, height: 1234 } },
        });
      });
      const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
      await act(async () => {
        listeners[showEvent]!({
          endCoordinates: { height: 312, screenY: 1334, screenX: 0, width: 750 },
          startCoordinates: { height: 0, screenY: 1334, screenX: 0, width: 750 },
          duration: 0,
          easing: 'keyboard',
          isEventFromThisApp: true,
        } as KeyboardEvent);
      });
      const last = samples[samples.length - 1];
      expect(last).toMatchObject({
        platform: Platform.OS,
        windowHeight: 1334,
        containerBottom: 1334,
        keyboardHeight: 312,
        bottomInset: INSETS.insets.bottom,
      });
      expect(last?.room).toBe(
        keyboardRoomFor({
          containerBottom: 1334,
          windowHeight: 1334,
          keyboardHeight: 312,
          bottomInset: INSETS.insets.bottom,
          platform: Platform.OS,
        }),
      );
      expect(last?.room).toBeGreaterThan(0);
    } finally {
      setKeyboardRoomObserver(null);
      addListener.mockRestore();
    }
  });

  it('keeps the scroll view inside the room and the lockup outside it', async () => {
    await render(
      <SafeAreaProvider initialMetrics={INSETS}>
        <Screen testID="s">
          <AppText>content</AppText>
        </Screen>
      </SafeAreaProvider>,
    );
    const tree = screen.toJSON() as unknown as Json;
    const roomNode = collect(tree, (n) => n.props?.['testID'] === 'screen-keyboard-room');
    expect(roomNode).toHaveLength(1);
    expect(
      collect(
        roomNode[0] as Json,
        (n) => typeof n.type === 'string' && n.type.includes('ScrollView'),
      ),
    ).toHaveLength(1);
    expect(
      collect(roomNode[0] as Json, (n) =>
        JSON.stringify(n.children ?? []).includes('by Honeybee Accounting'),
      ),
    ).toHaveLength(0);
  });

  it('keeps the non-scrolling variant inside the same room', async () => {
    await render(
      <SafeAreaProvider initialMetrics={INSETS}>
        <Screen testID="s" scroll={false}>
          <AppText>content</AppText>
        </Screen>
      </SafeAreaProvider>,
    );
    expect(screen.getByTestId('screen-keyboard-room')).toBeTruthy();
    expect(screen.getByText('content')).toBeTruthy();
  });
});
