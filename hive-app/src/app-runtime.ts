/** Composition root. Environment validation runs before anything else is
 * constructed; on failure the app renders a configuration-fatal screen and
 * never initializes auth or data. The single Supabase client is owned by
 * the AuthController's lifecycle; repositories reach it only through the
 * accessor below, which fails safe when no client exists. */
import { AppState } from 'react-native';

import { AuthController, type SessionStorage } from '@/auth/controller';
import { InstallMarker } from '@/auth/install-marker';
import { documentMarkerFileStore } from '@/auth/marker-file-store';
import { expoCryptoRandomSource } from '@/auth/native-random-source';
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
import type { RandomSource } from '@/core/ids';
import {
  createSupabaseBundle,
  type HiveSupabaseClient,
  type SessionWriteGate,
} from '@/data/supabase/client';
import { AnswersRepository } from '@/data/supabase/answers';
import { DocumentsRepository } from '@/data/supabase/documents';
import {
  ActivityRepository,
  DashboardRepository,
  RequestsRepository,
} from '@/data/supabase/repositories';
import { withSyntheticDocumentSource } from '@/dev/qa-synthetic-document';
import type { AddDocumentPorts } from '@/features/documents/AddDocumentScreen';
import {
  expoDigester,
  expoDocumentReader,
  expoDocumentSource,
  writeSyntheticDocumentToCache,
} from '@/features/documents/expo-adapters';
import { ScopedRegistry } from '@/tenancy/clearing';

export interface AppServices {
  controller: AuthController;
  dashboardRepository: DashboardRepository;
  requestsRepository: RequestsRepository;
  activityRepository: ActivityRepository;
  documentsRepository: DocumentsRepository;
  answersRepository: AnswersRepository;
  /** The device bindings the add-document flow runs on (WO-003). */
  documentPorts: AddDocumentPorts;
  /** The device's random source, for the keys a write makes (WO-004). */
  random: RandomSource;
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
        EXPO_PUBLIC_SUPPORT_EMAIL: process.env.EXPO_PUBLIC_SUPPORT_EMAIL,
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
    createBundle: (events) => {
      const gate: SessionWriteGate = { open: true };
      currentGate = gate;
      // The bridge reports a quarantine the auth library met on its own
      // (find 46); the controller takes the transition.
      const bundle = createSupabaseBundle(env, storage, gate, {
        onQuarantine: events.onStorageQuarantine,
      });
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
    // The random source is explicit, not defaulted: core's web-crypto
    // default throws under Hermes (find 14).
    marker: new InstallMarker(documentMarkerFileStore, expoCryptoRandomSource),
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
  const documentsRepository = new DocumentsRepository(clientAccessor, registry);
  const answersRepository = new AnswersRepository(clientAccessor, registry);
  const documentPorts: AddDocumentPorts = {
    // In a QA build the picker can be armed by the synthetic-document deep
    // link for one pick (a device flow cannot drive the platform's file
    // picker); everywhere else the wrapper is the inert stub and this IS
    // the system picker.
    source: withSyntheticDocumentSource(expoDocumentSource, writeSyntheticDocumentToCache),
    reader: expoDocumentReader,
    digester: expoDigester,
    random: expoCryptoRandomSource,
  };

  cached = {
    ok: true,
    services: {
      controller,
      dashboardRepository,
      requestsRepository,
      activityRepository,
      documentsRepository,
      answersRepository,
      documentPorts,
      random: expoCryptoRandomSource,
      env,
    },
  };
  return cached;
}
