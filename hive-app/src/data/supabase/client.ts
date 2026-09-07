/** The one Supabase client factory.
 *
 * Nothing else in the app constructs a client. The auth persistence path is
 * the versioned SecureStore adapter (via the bridge below); auto refresh is
 * off at construction and driven by the AuthController through AppState;
 * the supported process lock serializes token operations.
 */
import {
  createClient,
  isAuthApiError,
  isAuthRetryableFetchError,
  processLock,
  type Session,
  type SupabaseClient,
} from '@supabase/supabase-js';

import {
  type AuthGateway,
  type AuthListenerEvent,
  type ClientBundle,
  type MembershipGateway,
  SessionExpiredError,
  type SessionInfo,
  SessionOfflineError,
} from '@/auth/client-lifecycle';
import type { SessionStorage } from '@/auth/controller';
import { decodeSupabaseTotpQr, flattenQrSvg, splitTotpFactors } from '@/auth/mfa-contract';
import { QuarantineRequiredError } from '@/auth/secure-store-adapter';
import type { EnvironmentConfig } from '@/core/env';
import { SafeError } from '@/core/errors';
import {
  asClientId,
  asEntityId,
  asEnvironmentId,
  asMembershipId,
  asUserId,
  type UserId,
} from '@/core/ids';
import { MEMBERSHIP_ROLES, type Membership, type MembershipRole } from '@/tenancy/types';

import type { Database } from './database.types';

export type HiveSupabaseClient = SupabaseClient<Database>;

const STORAGE_KEY = 'hive-session';

/** Once closed (sign-out began, quarantine, fatal), this bundle's session
 * persistence is over: late library-internal refreshes can neither read
 * nor re-persist the session, independent of vendor internals
 * (independent review P2-3). Deletions always pass. */
export interface SessionWriteGate {
  open: boolean;
}

export interface SessionBridgeEvents {
  /** The first storage read or write that raised QuarantineRequiredError;
   * called once per bridge, before the call that met it returns. */
  onQuarantine?: (error: QuarantineRequiredError) => void;
}

/** The storage the auth library is given, plus the quarantine it has
 * absorbed so the controller-facing gateway can re-raise it. */
export interface SessionBridge {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  /** The first QuarantineRequiredError this bridge absorbed, or null. */
  quarantine(): QuarantineRequiredError | null;
  /** Throws the absorbed error, if any. */
  throwIfQuarantined(): void;
}

/** Routes the session envelope to the secure adapter; any other key the
 * auth library uses (transient verifiers) stays memory-only.
 *
 * Storage quarantine is absorbed here rather than thrown into the library
 * (find 46, 2026-09-07 desktop run): the library's own readers — its
 * recovery read at construction, the initial-session emitter, the refresh
 * tick, a data call's token lookup — cannot catch the adapter's error, and
 * on the device it became logged tick failures and unhandled rejections.
 * The first quarantine closes the gate (no further read or write reaches
 * the adapter), is reported once, and the library is shown "no session".
 * The controller never sees a false "no session": every controller-facing
 * gateway call re-raises the absorbed error, so the existing quarantine
 * catch sites fire exactly as they do for a failure met directly.
 * Deletions still pass through unchanged, failure included — the
 * controller's own read-back-verified deletion is the authority there. */
export function bridgeStorage(
  storage: SessionStorage,
  gate: SessionWriteGate,
  events: SessionBridgeEvents = {},
): SessionBridge {
  const transient = new Map<string, string>();
  let quarantine: QuarantineRequiredError | null = null;
  const absorb = (error: unknown): error is QuarantineRequiredError => {
    if (!(error instanceof QuarantineRequiredError)) return false;
    if (quarantine === null) {
      quarantine = error;
      gate.open = false;
      events.onQuarantine?.(error);
    }
    return true;
  };
  return {
    getItem: async (key: string): Promise<string | null> => {
      if (key !== STORAGE_KEY) return transient.get(key) ?? null;
      if (!gate.open) return null;
      try {
        return await storage.read();
      } catch (error) {
        if (absorb(error)) return null;
        throw error;
      }
    },
    setItem: async (key: string, value: string): Promise<void> => {
      if (key !== STORAGE_KEY) {
        transient.set(key, value);
        return;
      }
      if (!gate.open) return;
      try {
        await storage.write(value);
      } catch (error) {
        if (absorb(error)) return;
        throw error;
      }
    },
    removeItem: async (key: string): Promise<void> => {
      if (key === STORAGE_KEY) {
        await storage.delete();
      } else {
        transient.delete(key);
      }
    },
    quarantine: () => quarantine,
    throwIfQuarantined: () => {
      if (quarantine) throw quarantine;
    },
  };
}

/** Runs one library call for the controller and re-raises any quarantine
 * the bridge has absorbed by the time it settles — whether the call
 * succeeded on the library's "no session" view or failed for another
 * reason, because storage trouble outranks every other classification
 * (independent review P2-5: never misread as offline or signed out). */
async function raisingQuarantine<T>(bridge: SessionBridge, call: () => Promise<T>): Promise<T> {
  let result: T;
  try {
    result = await call();
  } catch (error) {
    bridge.throwIfQuarantined();
    throw error;
  }
  bridge.throwIfQuarantined();
  return result;
}

/** What a failed getSession() means (2026-09-06 review). The only server
 * call inside getSession() is the refresh of a lapsed stored session, so:
 * a 4xx from the auth API is the server REJECTING the refresh token
 * (revoked, rotated, expired) — a dead session; a retryable fetch error is
 * an unreachable server — an offline launch; anything else stays fatal. */
export function classifyGetSessionError(error: unknown): 'expired' | 'offline' | 'other' {
  if (isAuthRetryableFetchError(error)) return 'offline';
  if (isAuthApiError(error) && error.status >= 400 && error.status < 500) return 'expired';
  return 'other';
}

/** The two sign-in answers that must not fall through to the generic line
 * (2026-09-07 wording review). With shouldCreateUser: false the auth
 * server refuses an email it will not send to (422, otp_disabled /
 * signup_disabled); a rate limit is 429 or an over_*_rate_limit code.
 * Everything else keeps its original shape for the safe-error mapper. */
export function mapSignInRequestError(error: unknown): unknown {
  if (!isAuthApiError(error)) return error;
  const code = error.code ?? '';
  if (error.status === 429 || code.includes('rate_limit')) return new SafeError('rate_limited');
  if (error.status === 422 || code === 'otp_disabled' || code === 'signup_disabled') {
    return new SafeError('not_authorized');
  }
  return error;
}

async function currentAal(client: HiveSupabaseClient): Promise<'aal1' | 'aal2'> {
  const { data, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) return 'aal1';
  return data?.currentLevel === 'aal2' ? 'aal2' : 'aal1';
}

async function toSessionInfo(
  client: HiveSupabaseClient,
  session: Session | null,
): Promise<SessionInfo | null> {
  if (!session?.user?.id) return null;
  return {
    userId: asUserId(session.user.id),
    aal: await currentAal(client),
    expiresAt: typeof session.expires_at === 'number' ? session.expires_at * 1000 : null,
  };
}

function requireSessionInfo(info: SessionInfo | null): SessionInfo {
  if (!info) throw new SafeError('auth_invalid');
  return info;
}

function makeAuthGateway(client: HiveSupabaseClient, bridge: SessionBridge): AuthGateway {
  return {
    getSession(): Promise<SessionInfo | null> {
      return raisingQuarantine(bridge, async () => {
        const { data, error } = await client.auth.getSession();
        if (error) {
          const kind = classifyGetSessionError(error);
          if (kind === 'expired') throw new SessionExpiredError();
          if (kind === 'offline') throw new SessionOfflineError();
          throw error;
        }
        return toSessionInfo(client, data.session);
      });
    },
    requestOtp(email: string): Promise<void> {
      return raisingQuarantine(bridge, async () => {
        // Invite-only: never create a user from the app.
        const { error } = await client.auth.signInWithOtp({
          email,
          options: { shouldCreateUser: false },
        });
        if (error) throw mapSignInRequestError(error);
      });
    },
    verifyOtp(email: string, token: string): Promise<SessionInfo> {
      return raisingQuarantine(bridge, async () => {
        const { data, error } = await client.auth.verifyOtp({ email, token, type: 'email' });
        if (error) throw mapSignInRequestError(error);
        return requireSessionInfo(await toSessionInfo(client, data.session));
      });
    },
    listTotpFactors() {
      return raisingQuarantine(bridge, async () => {
        const { data, error } = await client.auth.mfa.listFactors();
        if (error) throw error;
        // Contract note (area 2): data.totp holds VERIFIED totp factors
        // only; unverified ones appear only in data.all.
        return splitTotpFactors(data);
      });
    },
    enrollTotp() {
      return raisingQuarantine(bridge, async () => {
        const { data, error } = await client.auth.mfa.enroll({ factorType: 'totp' });
        if (error) throw error;
        if (!data?.id || !data.totp?.secret) throw new SafeError('unknown');
        // Memory-only setup material; never persisted, logged, or exported.
        // qr_code arrives as a data:image/svg+xml;utf-8 URI — decoded and
        // validated before any renderer sees it; null falls back to the
        // manual setup key.
        return {
          factorId: data.id,
          secret: data.totp.secret,
          // Flattened to one path per colour before it reaches a renderer:
          // a module-per-rect QR is thousands of native views (find 33).
          qrSvg: flattenQrSvg(decodeSupabaseTotpQr(data.totp.qr_code)),
          uri: data.totp.uri ?? null,
        };
      });
    },
    unenrollTotp(factorId: string): Promise<void> {
      return raisingQuarantine(bridge, async () => {
        const { error } = await client.auth.mfa.unenroll({ factorId });
        if (error) throw error;
      });
    },
    verifyTotp(factorId: string, code: string): Promise<SessionInfo> {
      return raisingQuarantine(bridge, async () => {
        const { error } = await client.auth.mfa.challengeAndVerify({ factorId, code });
        if (error) throw error;
        const { data, error: sessionError } = await client.auth.getSession();
        if (sessionError) throw sessionError;
        return requireSessionInfo(await toSessionInfo(client, data.session));
      });
    },
    signOutRemote(): Promise<void> {
      return raisingQuarantine(bridge, async () => {
        const { error } = await client.auth.signOut();
        if (error) throw error;
      });
    },
    startAutoRefresh(): void {
      void client.auth.startAutoRefresh();
    },
    stopAutoRefresh(): void {
      void client.auth.stopAutoRefresh();
    },
    onAuthStateChange(listener: (event: AuthListenerEvent) => void): () => void {
      const { data } = client.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') listener('SIGNED_OUT');
        else if (event === 'TOKEN_REFRESHED') listener('TOKEN_REFRESHED');
        else listener('OTHER');
      });
      return () => data.subscription.unsubscribe();
    },
  };
}

function toMembershipRole(value: string): MembershipRole {
  if ((MEMBERSHIP_ROLES as readonly string[]).includes(value)) {
    return value as MembershipRole;
  }
  throw new SafeError('unknown');
}

function makeMembershipGateway(client: HiveSupabaseClient): MembershipGateway {
  return {
    async listMemberships(userId: UserId): Promise<Membership[]> {
      // RLS already restricts to the caller's rows; the user filter is
      // defense in depth, never the enforcement.
      const memberships = await client
        .from('memberships')
        .select('id, environment_id, client_id, entity_id, role, user_id')
        .eq('user_id', userId);
      if (memberships.error) throw memberships.error;
      const clients = await client.from('clients').select('id, display_name');
      if (clients.error) throw clients.error;
      const entities = await client.from('entities').select('id, display_name');
      if (entities.error) throw entities.error;
      const clientNames = new Map(clients.data.map((row) => [row.id, row.display_name]));
      const entityNames = new Map(entities.data.map((row) => [row.id, row.display_name]));
      return memberships.data.map((row) => ({
        membershipId: asMembershipId(row.id),
        environmentId: asEnvironmentId(row.environment_id),
        clientId: asClientId(row.client_id),
        entityId: asEntityId(row.entity_id),
        role: toMembershipRole(row.role),
        clientName: clientNames.get(row.client_id) ?? 'Workspace',
        entityName: entityNames.get(row.entity_id) ?? 'Entity',
      }));
    },
  };
}

export interface SupabaseBundle extends ClientBundle {
  readonly client: HiveSupabaseClient;
}

export function createSupabaseBundle(
  env: EnvironmentConfig,
  storage: SessionStorage,
  gate: SessionWriteGate = { open: true },
  events: SessionBridgeEvents = {},
): SupabaseBundle {
  const bridge = bridgeStorage(storage, gate, events);
  const client = createClient<Database>(env.supabaseUrl, env.supabaseClientKey, {
    auth: {
      storage: bridge,
      storageKey: STORAGE_KEY,
      autoRefreshToken: false,
      persistSession: true,
      detectSessionInUrl: false,
      lock: processLock,
    },
  });
  return {
    client,
    auth: makeAuthGateway(client, bridge),
    memberships: makeMembershipGateway(client),
    dispose(): void {
      void client.auth.stopAutoRefresh();
    },
  };
}
