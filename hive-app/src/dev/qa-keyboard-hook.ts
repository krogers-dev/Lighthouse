/** HIVE_QA_KEYBOARD_HOOK — development-only keyboard geometry log (find 49,
 * third iteration).
 *
 * Two iterations of the screen shell's keyboard room were derived from
 * React Native's Android source and both produced zero room on the
 * device, where the soft keyboard measurably covers the lower 883 px of
 * the window (desktop 2, runs 7 and 8). Nothing outside the app can tell
 * whether the `keyboardDidShow` event reaches JavaScript at all, or with
 * what numbers, so this hook writes exactly that to the console — which a
 * development build forwards to logcat under `ReactNativeJS` — together
 * with every input of the shell's own computation, reported through the
 * production-inert seam in src/ui/primitives/keyboard-room-probe.ts.
 *
 * Geometry only: heights, offsets, and window sizes in density-independent
 * units. No content, identity, or session value can reach these lines.
 *
 * Ship-safety, proven by gates rather than promised, exactly as the other
 * QA hooks:
 *  - reachable only behind `__DEV__ && EXPO_PUBLIC_QA_HOOKS === '1'`
 *    (app/_layout.tsx); metro.config.js resolves this import to the inert
 *    stub unless QA hooks are enabled at build time, so the marker string
 *    below never enters a non-QA dependency graph;
 *  - `bundle:inspect` proves that marker absent from every
 *    non-development export (qa-hook-marker pattern);
 *  - `config:check` rejects EXPO_PUBLIC_QA_HOOKS for candidate/release.
 */
import { Dimensions, Keyboard, Platform, type KeyboardEvent } from 'react-native';

import {
  type KeyboardRoomSample,
  setKeyboardRoomObserver,
} from '@/ui/primitives/keyboard-room-probe';

export const QA_KEYBOARD_HOOK_MARKER = 'HIVE_QA_KEYBOARD_HOOK';

export type QaKeyboardLog = (line: string) => void;

const KEYBOARD_EVENTS = [
  'keyboardWillShow',
  'keyboardDidShow',
  'keyboardWillHide',
  'keyboardDidHide',
] as const;

interface Size {
  readonly width: number;
  readonly height: number;
}

function size(value: Size): string {
  return `${Math.round(value.width)}x${Math.round(value.height)}`;
}

/** One line per keyboard event: its end coordinates and the window and
 * screen sizes at that moment. */
export function formatKeyboardEventLine(
  name: string,
  event: KeyboardEvent,
  window: Size,
  screen: Size,
  platform: string,
): string {
  const end = event.endCoordinates;
  return [
    QA_KEYBOARD_HOOK_MARKER,
    `event=${name}`,
    `platform=${platform}`,
    `height=${Math.round(end.height)}`,
    `screenY=${Math.round(end.screenY)}`,
    `screenX=${Math.round(end.screenX)}`,
    `width=${Math.round(end.width)}`,
    `window=${size(window)}`,
    `screen=${size(screen)}`,
  ].join(' ');
}

/** One line per shell computation: every input and the room it produced. */
export function formatKeyboardRoomLine(sample: KeyboardRoomSample): string {
  return [
    QA_KEYBOARD_HOOK_MARKER,
    'room',
    `platform=${sample.platform}`,
    `windowHeight=${Math.round(sample.windowHeight)}`,
    `containerBottom=${sample.containerBottom === null ? 'null' : Math.round(sample.containerBottom)}`,
    `keyboardHeight=${Math.round(sample.keyboardHeight)}`,
    `bottomInset=${Math.round(sample.bottomInset)}`,
    `room=${Math.round(sample.room)}`,
  ].join(' ');
}

/** Installs the log on the keyboard events and the shell's seam; returns
 * the remover. The default sink is the console, which a development build
 * forwards to logcat (`adb logcat -s ReactNativeJS`). */
export function installQaKeyboardHook(
  log: QaKeyboardLog = (line) => {
    // eslint-disable-next-line no-console
    console.log(line);
  },
): () => void {
  const subscriptions = KEYBOARD_EVENTS.map((name) =>
    Keyboard.addListener(name, (event: KeyboardEvent) =>
      log(
        formatKeyboardEventLine(
          name,
          event,
          Dimensions.get('window'),
          Dimensions.get('screen'),
          Platform.OS,
        ),
      ),
    ),
  );
  setKeyboardRoomObserver((sample) => log(formatKeyboardRoomLine(sample)));
  log(
    [
      QA_KEYBOARD_HOOK_MARKER,
      'installed',
      `platform=${Platform.OS}`,
      `window=${size(Dimensions.get('window'))}`,
      `screen=${size(Dimensions.get('screen'))}`,
    ].join(' '),
  );
  return () => {
    for (const subscription of subscriptions) subscription.remove();
    setKeyboardRoomObserver(null);
  };
}
