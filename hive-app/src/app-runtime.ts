/** Composition root. Environment validation runs before anything else is
 * constructed; on failure the app renders a configuration-fatal screen and
 * never initializes auth or data. The single Supabase client is owned by
 * the AuthController's lifecycle; repositories reach it only through the
 * accessor below, which fails safe when no client exists. */
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
import { createSupabaseBundle, type HiveSupabaseClient } from '@/data/supabase/client';
import { DashboardRepository } from '@/data/supabase/repositories';
import { ScopedRegistry } from '@/tenancy/clearing';

export interface AppServices {
  controller: AuthController;
  dashboardRepository: DashboardRepository;
  env: EnvironmentConfig;
}

export type RuntimeResult =
  | { ok: true; services: AppServices }
  | { ok: false; problems: readonly string[] };

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

  const controller = new AuthController({
    createBundle: () => {
      const bundle = createSupabaseBundle(env, storage);
      currentClient = bundle.client;
      return {
        auth: bundle.auth,
        memberships: bundle.memberships,
        dispose: () => {
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
  });

  const dashboardRepository = new DashboardRepository(() => {
    if (!currentClient) {
      throw new SafeError('auth_expired');
    }
    return currentClient;
  }, registry);

  cached = { ok: true, services: { controller, dashboardRepository, env } };
  return cached;
}
