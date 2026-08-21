/** Safe error mapping.
 *
 * Every failure that reaches UI, diagnostics, or a route boundary goes
 * through this module first. The mapping is one-way: internals (messages,
 * stacks, response bodies, storage keys) never survive into a SafeError's
 * user-facing text.
 */

export type SafeErrorCode =
  | 'network'
  | 'offline'
  | 'auth_invalid'
  | 'auth_expired'
  | 'denied'
  | 'stale_scope'
  | 'storage'
  | 'quarantine'
  | 'config'
  | 'conflict'
  | 'unknown';

const USER_MESSAGES: Record<SafeErrorCode, string> = {
  network: 'We could not reach the service. Check your connection and try again.',
  offline: 'You appear to be offline. Reconnect to continue.',
  auth_invalid: 'That sign-in code was not accepted. Request a new code and try again.',
  auth_expired: 'Your session has ended. Sign in again to continue.',
  denied: 'You do not have access to this record.',
  stale_scope: 'Your access changed. Choose a workspace again to continue.',
  storage: 'Secure storage on this device reported a problem.',
  quarantine:
    'Secure sign-in data on this device could not be verified. Reset secure sign-in data to continue.',
  config: 'The app is not configured correctly for this build.',
  conflict: 'This record changed while you were viewing it. Refresh to continue.',
  unknown: 'Something went wrong. Try again in a moment.',
};

export class SafeError extends Error {
  constructor(
    readonly code: SafeErrorCode,
    /** Optional short machine detail; must already be free of sensitive values. */
    readonly detail?: string,
  ) {
    super(USER_MESSAGES[code]);
    this.name = 'SafeError';
  }

  get userMessage(): string {
    return USER_MESSAGES[this.code];
  }
}

export function userMessageFor(code: SafeErrorCode): string {
  return USER_MESSAGES[code];
}

function looksLikeNetworkFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  // fetch in React Native / Node rejects with a TypeError on transport
  // failure; message content is not relied on beyond classification.
  return (
    error.name === 'TypeError' ||
    error.name === 'AbortError' ||
    /network request failed/i.test(error.message)
  );
}

/** Map any thrown value to a SafeError without leaking internals. */
export function toSafeError(error: unknown): SafeError {
  if (error instanceof SafeError) {
    return error;
  }
  if (looksLikeNetworkFailure(error)) {
    return new SafeError('network');
  }
  return new SafeError('unknown');
}
