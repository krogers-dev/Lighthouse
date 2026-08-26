/** Composition root. Environment validation runs before anything else is
 * constructed; on failure the app renders a configuration-fatal screen and
 * never initializes auth or data. The single Supabase client is owned by
 * the AuthController's lifecycle; repositories reach it only through the
 * accessor below, which fails safe when no client exists. */
import { AppState } from 'react-native';

import { AuthController, type SessionStorage } from '@/auth/controller';
import { InstallMarker } from '@/auth/install-marker';
import { documentMarkerFileStore } from '@/auth/marker-file-store';
import { SessionStorageAdapter } from '@/auth/secure-store-adapter';
import { expoSecureStoreBackend } from '@/auth/secure-store-backend';
import { systemClock } from '@/core/clock';
import { nullDiagnostics } from '@/core/diagnostics';
import {
  EnvironmentValidationError,
  validateEnvironment,
  type EnvironmentConfig,
} from '@/core/env';
import { SafeError } from '@/core/errors';
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

export interface AppServices {
  controller: AuthController;
  dashboardRepository: DashboardRepository;
  requestsRepository: RequestsRepository;
  activityRepository: ActivityRepository;
  env: EnvironmentConfig;
}

export type RuntimeResult =
  { ok: true; services: AppServices } | { ok: false; problems: readonly string[] };

let cached: RuntimeResult | null = null;

export function getRuntime(): RuntimeResult {
  if (cached) return cached;

  let env: EnvironmentConfig;
  try {
    // EXPO_PUBLIC_* references must stay static for Expo's build-time inlining.
    env = validateEnvironment(
      {
        EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
        EXPO_PUBLIC_SUPABASE_CLIENT_KEY: process.env.EXPO_PUBLIC_SUPABASE_CLIENT_KEY,
      },
      __DEV__ ? 'development' : 'release',
    );
  } catch (error) {
    cached = {
      ok: false,
      problems:
        error instanceof EnvironmentValidationError
          ? error.problems
          : ['Environment validation failed'],
    };
    return cached;
  }

  const storage: SessionStorage = new SessionStorageAdapter(expoSecureStoreBackend);
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
    marker: new InstallMarker(documentMarkerFileStore),
    registry,
    diagnostics: nullDiagnostics,
    clock: systemClock,
    failMode: __DEV__ ? 'throw' : 'closed',
    // Cold boots usually happen already-foregrounded; refresh must start
    // then too, not only after the next AppState change (P1 item 5).
    initialAppStatus: AppState.currentState === 'active' ? 'active' : 'unknown',
  });

  // The moment sign-out begins (or storage quarantines, or the app goes
  // fatal), this bundle's session persistence closes for good; a fresh
  // bundle after sign-out gets a fresh open gate.
  controller.subscribe((state) => {
    if (
      state.name === 'signing_out' ||
      state.name === 'storage_quarantined' ||
      state.name === 'fatal'
    ) {
      currentGate.open = false;
    }
  });

  // Protected reads exist only in the authorized state; during sign-out,
  // quarantine, or after disposal this accessor fails safe (independent
  // review P2-2). Every repository shares it, so no read surface can
  // acquire a client the others could not.
  const clientAccessor = (): HiveSupabaseClient => {
    if (!currentClient || controller.getState().name !== 'authorized') {
      throw new SafeError('auth_expired');
    }
    return currentClient;
  };

  const dashboardRepository = new DashboardRepository(clientAccessor, registry);
  const requestsRepository = new RequestsRepository(clientAccessor, registry);
  const activityRepository = new ActivityRepository(clientAccessor, registry);

  cached = {
    ok: true,
    services: { controller, dashboardRepository, requestsRepository, activityRepository, env },
  };
  return cached;
}
