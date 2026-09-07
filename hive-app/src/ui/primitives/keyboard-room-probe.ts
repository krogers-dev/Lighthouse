/** Observation seam for the screen shell's keyboard room (find 49).
 *
 * The shell reports every input of its keyboard-room computation here.
 * Nothing listens unless a development QA hook registers an observer
 * (src/dev/qa-keyboard-hook.ts, QA builds only), so a release build carries
 * no logging and no marker through this file. Samples are geometry only —
 * never content, never identity.
 */
export interface KeyboardRoomSample {
  readonly platform: string;
  readonly windowHeight: number;
  readonly containerBottom: number | null;
  readonly keyboardHeight: number;
  readonly bottomInset: number;
  readonly room: number;
}

export type KeyboardRoomObserver = (sample: KeyboardRoomSample) => void;

let observer: KeyboardRoomObserver | null = null;

/** Registers (or, with null, removes) the single observer. */
export function setKeyboardRoomObserver(next: KeyboardRoomObserver | null): void {
  observer = next;
}

export function reportKeyboardRoom(sample: KeyboardRoomSample): void {
  observer?.(sample);
}
