/** Inert stand-in for the QA keyboard geometry hook. metro.config.js
 * resolves `@/dev/qa-keyboard-hook` to THIS file whenever
 * EXPO_PUBLIC_QA_HOOKS is not '1' at build time, so the real module — and
 * its provable marker string — never enters the dependency graph of a
 * non-QA bundle. This stub carries no marker and does nothing. */
export const QA_KEYBOARD_HOOK_MARKER = '';

export type QaKeyboardLog = (line: string) => void;

export function installQaKeyboardHook(_log?: QaKeyboardLog): () => void {
  // Intentionally inert: QA hooks are not compiled into this build.
  return () => undefined;
}
