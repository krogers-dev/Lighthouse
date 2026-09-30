/** Helpers for the live-bridge lane (see app-live-bridge.test.ts).
 *
 * Everything here is a NAMED SYNTHETIC stand-in for a native capability,
 * or a test-side port of an already-reviewed helper. Nothing reaches
 * production code paths: production wires expoSecureStoreBackend and
 * documentMarkerFileStore in src/app-runtime.ts, and neither import
 * appears anywhere in this directory.
 */
import type { AuthController } from '@/auth/controller';
import type { AuthState } from '@/auth/machine';
import type { SecureStoreBackend } from '@/auth/secure-store-adapter';
import type { MarkerFileStore } from '@/auth/install-marker';

/** In-memory SecureStore: the same interface the Keychain-backed backend
 * implements, minus the device. The versioned envelope, two-phase commit,
 * and residue logic under test are the REAL adapter's — only the byte
 * store is synthetic. */
export class SyntheticMemorySecureStore implements SecureStoreBackend {
  private readonly items = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.items.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.items.set(key, value);
  }

  async deleteItem(key: string): Promise<void> {
    this.items.delete(key);
  }

  /** Test-only visibility: what survived, if anything. */
  keys(): readonly string[] {
    return [...this.items.keys()];
  }
}

/** In-memory install marker file. */
export class SyntheticMemoryMarkerStore implements MarkerFileStore {
  private content: string | null = null;

  async read(): Promise<string | null> {
    return this.content;
  }

  async write(content: string): Promise<void> {
    this.content = content;
  }
}

/** Wait until the controller reaches a state accepted by `predicate`,
 * with a hard timeout that reports the state it was stuck in. */
export function waitForState(
  controller: AuthController,
  label: string,
  predicate: (state: AuthState) => boolean,
  timeoutMs = 20_000,
): Promise<AuthState> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const current = controller.getState();
    if (predicate(current)) {
      resolve(current);
      return;
    }
    const timer = setInterval(() => {
      if (Date.now() - startedAt > timeoutMs) {
        cleanup();
        reject(new Error(`${label}: still '${controller.getState().name}' after ${timeoutMs}ms`));
      }
    }, 250);
    const unsubscribe = controller.subscribe((state) => {
      if (predicate(state)) {
        cleanup();
        resolve(state);
      }
    });
    const cleanup = () => {
      clearInterval(timer);
      unsubscribe();
    };
  });
}

interface MailpitMessageSummary {
  ID: string;
  To: { Address: string }[];
  Subject: string;
  Created: string;
}

const EXPECTED_SUBJECT = 'Your HIVE sign-in code';

/** Snapshot Mailpit's message ids BEFORE requesting a code, so only a
 * message that arrives AFTER the request is ever accepted — the same
 * reliability contract as the black-box harness (RETURN-2 area 5). */
export async function snapshotMailbox(mailpitUrl: string): Promise<ReadonlySet<string>> {
  const response = await fetch(`${mailpitUrl}/api/v1/messages?limit=200`);
  const body = (await response.json()) as { messages?: MailpitMessageSummary[] };
  return new Set((body.messages ?? []).map((message) => message.ID));
}

/** The six-digit code from the first NEW message to `email` under the
 * exact expected subject. Polls briefly: SMTP delivery is asynchronous. */
export async function fetchOtpCode(
  mailpitUrl: string,
  email: string,
  before: ReadonlySet<string>,
  timeoutMs = 15_000,
): Promise<string> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const response = await fetch(`${mailpitUrl}/api/v1/messages?limit=200`);
    const body = (await response.json()) as { messages?: MailpitMessageSummary[] };
    const candidate = (body.messages ?? []).find(
      (message) =>
        !before.has(message.ID) &&
        message.Subject === EXPECTED_SUBJECT &&
        message.To.some((to) => to.Address.toLowerCase() === email.toLowerCase()),
    );
    if (candidate) {
      const detail = await fetch(`${mailpitUrl}/api/v1/message/${candidate.ID}`);
      const payload = (await detail.json()) as { Text?: string; HTML?: string };
      const haystack = `${payload.Text ?? ''}\n${payload.HTML ?? ''}`;
      const match = haystack.match(/\b(\d{6})\b/);
      if (match?.[1]) return match[1];
      throw new Error(`live-bridge: OTP mail for ${email} carries no six-digit code`);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`live-bridge: no OTP mail for ${email} within ${timeoutMs}ms`);
}
