import { Keyboard, type KeyboardEvent } from 'react-native';

import { reportKeyboardRoom, setKeyboardRoomObserver } from '@/ui/primitives/keyboard-room-probe';

import {
  QA_KEYBOARD_HOOK_MARKER,
  formatKeyboardEventLine,
  formatKeyboardRoomLine,
  installQaKeyboardHook,
} from '../qa-keyboard-hook';

const SHOW: KeyboardEvent = {
  endCoordinates: { height: 312.4, screenY: 578, screenX: 0, width: 411.4 },
  startCoordinates: { height: 0, screenY: 914, screenX: 0, width: 411.4 },
  duration: 0,
  easing: 'keyboard',
  isEventFromThisApp: true,
} as KeyboardEvent;

/** Find 49, third iteration: the hook writes geometry, and only geometry. */
describe('dev-only QA keyboard geometry hook', () => {
  afterEach(() => {
    setKeyboardRoomObserver(null);
  });

  it('formats a keyboard event as rounded geometry behind the provable marker', () => {
    const line = formatKeyboardEventLine(
      'keyboardDidShow',
      SHOW,
      { width: 411.4, height: 914.3 },
      { width: 411.4, height: 914.3 },
      'android',
    );
    expect(line).toBe(
      `${QA_KEYBOARD_HOOK_MARKER} event=keyboardDidShow platform=android height=312 screenY=578 screenX=0 width=411 window=411x914 screen=411x914`,
    );
    expect(QA_KEYBOARD_HOOK_MARKER).toBe(['HIVE_QA', 'KEYBOARD_HOOK'].join('_'));
  });

  it('formats a shell sample with every input and the room it produced', () => {
    expect(
      formatKeyboardRoomLine({
        platform: 'android',
        windowHeight: 914.3,
        containerBottom: null,
        keyboardHeight: 0,
        bottomInset: 24,
        room: 0,
      }),
    ).toBe(
      `${QA_KEYBOARD_HOOK_MARKER} room platform=android windowHeight=914 containerBottom=null keyboardHeight=0 bottomInset=24 room=0`,
    );
    expect(
      formatKeyboardRoomLine({
        platform: 'android',
        windowHeight: 914,
        containerBottom: 914,
        keyboardHeight: 312,
        bottomInset: 24,
        room: 336,
      }),
    ).toMatch(/containerBottom=914 keyboardHeight=312 bottomInset=24 room=336$/);
  });

  it('logs every keyboard event and every shell sample once installed, and stops when removed', () => {
    const handlers: Record<string, (event: KeyboardEvent) => void> = {};
    const removed: string[] = [];
    const addListener = jest
      .spyOn(Keyboard, 'addListener')
      .mockImplementation((name: string, handler: (event: KeyboardEvent) => void) => {
        handlers[name] = handler;
        return { remove: () => removed.push(name) } as unknown as ReturnType<
          typeof Keyboard.addListener
        >;
      });
    try {
      const lines: string[] = [];
      const remove = installQaKeyboardHook((line) => lines.push(line));
      expect(Object.keys(handlers).sort()).toEqual([
        'keyboardDidHide',
        'keyboardDidShow',
        'keyboardWillHide',
        'keyboardWillShow',
      ]);
      expect(lines[0]).toMatch(new RegExp(`^${QA_KEYBOARD_HOOK_MARKER} installed platform=`));

      handlers['keyboardDidShow']!(SHOW);
      expect(lines[1]).toMatch(/ event=keyboardDidShow .* height=312 screenY=578 /);

      reportKeyboardRoom({
        platform: 'android',
        windowHeight: 914,
        containerBottom: 914,
        keyboardHeight: 312,
        bottomInset: 24,
        room: 336,
      });
      expect(lines[2]).toMatch(/ room platform=android .* room=336$/);

      remove();
      expect(removed).toHaveLength(4);
      reportKeyboardRoom({
        platform: 'android',
        windowHeight: 914,
        containerBottom: 914,
        keyboardHeight: 0,
        bottomInset: 24,
        room: 0,
      });
      expect(lines).toHaveLength(3);
      // Geometry only: every line is the marker followed by key=value
      // numbers and event or platform names.
      for (const line of lines) {
        expect(line).toMatch(/^HIVE_QA_KEYBOARD_HOOK( [a-zA-Z]+(=[a-zA-Z0-9x.-]+)?)+$/);
      }
    } finally {
      addListener.mockRestore();
    }
  });
});
