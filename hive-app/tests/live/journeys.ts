/** Shared live-journey machinery for the tests/live suites.
 *
 * buildApp mirrors src/app-runtime.ts verbatim except the two native
 * byte stores; signInWithOtp drives sign-in exactly as the screens do,
 * answering GoTrue's one-second send floor with the public resend the
 * way a person would. Both suites (composition-level and screen-level)
 * share one definition so the wiring under test cannot drift.
 */
import { AuthController, type SessionStorage } from '@/auth/controller';
import { InstallMarker } from '@/auth/install-marker';
import type { AuthState } from '@/auth/machine';
import { SessionStorageAdapter } from '@/auth/secure-store-adapter';
import { nullDiagnostics } from '@/core/diagnostics';
import { systemClock } from '@/core/clock';
import { validateEnvironment } from '@/core/env';
import {
  createSupabaseBundle,
  type HiveSupabaseClient,
  type SessionWriteGate,
} from '@/data/supabase/client';
import {
  ActivityRepository,
  DashboardRepository,
  RequestsRepository,
} from '@/data/supabase/repositories';
import { ScopedRegistry } from '@/tenancy/clearing';

import {
  SyntheticMemoryMarkerStore,
  SyntheticMemorySecureStore,
  fetchOtpCode,
  snapshotMailbox,
  waitForState,
} from './helpers';

export { waitForState } from './helpers';

export const mailpitUrl = process.env.HIVE_LOCAL_MAILPIT_URL ?? 'http://127.0.0.1:54324';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
if (process.env.HIVE_LIVE_BRIDGE !== '1') {
  throw new Error(
    'live suites run through `node scripts/e2e-binary-stack.mjs bridge` — they need the live local stack',
  );
}
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('live suites refuse a non-loopback URL');
}

/** The app's composition root, verbatim except the two native backends.
 * Kept in one factory so every journey exercises the same wiring. */
export function buildApp() {
  const env = validateEnvironment(
    {
      EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
      EXPO_PUBLIC_SUPABASE_CLIENT_KEY: process.env.EXPO_PUBLIC_SUPABASE_CLIENT_KEY,
    },
    'development',
  );

  const backend = new SyntheticMemorySecureStore();
  const storage: SessionStorage = new SessionStorageAdapter(backend);
  const registry = new ScopedRegistry();
  let currentClient: HiveSupabaseClient | null = null;
  let currentGate: SessionWriteGate = { open: true };

  const controller = new AuthController({
    createBundle: () => {
      const gate: SessionWriteGate = { open: true };
      currentGate = gate;
      const bundle = createSupabaseBundle(env, storage, gate);
      currentClient = bundle.client;
      return {
        auth: bundle.auth,
        memberships: bundle.memberships,
        dispose: () => {
          gate.open = false;
          bundle.dispose();
          currentClient = null;
        },
      };
    },
    storage,
    marker: new InstallMarker(new SyntheticMemoryMarkerStore()),
    registry,
    diagnostics: nullDiagnostics,
    clock: systemClock,
    failMode: 'throw',
    initialAppStatus: 'active',
  });

  controller.subscribe((state) => {
    if (
      state.name === 'signing_out' ||
      state.name === 'storage_quarantined' ||
      state.name === 'fatal'
    ) {
      currentGate.open = false;
    }
  });

  const clientAccessor = (): HiveSupabaseClient => {
    if (!currentClient || controller.getState().name !== 'authorized') {
      throw new Error('auth_expired');
    }
    return currentClient;
  };

  return {
    controller,
    backend,
    storage,
    dashboard: new DashboardRepository(clientAccessor, registry),
    requests: new RequestsRepository(clientAccessor, registry),
    activity: new ActivityRepository(clientAccessor, registry),
  };
}

/** OTP sign-in exactly as the screens drive it: startSignIn (which sends
 * the code), read the code from the real email, submitOtp.
 *
 * GoTrue enforces a one-second send floor per address (config.toml
 * max_frequency); a journey that follows another within the same second
 * gets a 429, which the controller surfaces as a notice on first_factor.
 * The screens answer that with the resend control, so this helper does
 * the same through the controller's public requestOtp() — asserting the
 * failure is SHOWN, never silently swallowed, before retrying. */
export async function signInWithOtp(app: ReturnType<typeof buildApp>, email: string) {
  const before = await snapshotMailbox(mailpitUrl);
  await app.controller.startSignIn(email);
  for (let attempt = 0; ; attempt += 1) {
    const settled = (await waitForState(
      app.controller,
      `${email} otp settled`,
      (state) => state.name === 'first_factor' && (state.otpSent || state.notice !== undefined),
    )) as Extract<AuthState, { name: 'first_factor' }>;
    if (settled.otpSent) break;
    expect(settled.notice).toBeDefined();
    if (attempt >= 2) throw new Error(`${email}: OTP still refused after ${attempt + 1} requests`);
    await new Promise((resolve) => setTimeout(resolve, 1300));
    await app.controller.requestOtp();
  }
  const code = await fetchOtpCode(mailpitUrl, email, before);
  await app.controller.submitOtp(code);
}
