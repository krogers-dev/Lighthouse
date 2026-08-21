/** The one Supabase client factory.
 *
 * Nothing else in the app constructs a client. The auth persistence path is
 * the versioned SecureStore adapter (via the bridge below); auto refresh is
 * off at construction and driven by the AuthController through AppState;
 * the supported process lock serializes token operations.
 */
import {
  createClient,
  processLock,
  type Session,
  type SupabaseClient,
} from '@supabase/supabase-js';

import type {
  AuthGateway,
  AuthListenerEvent,
  ClientBundle,
  MembershipGateway,
  SessionInfo,
} from '@/auth/client-lifecycle';
import type { SessionStorage } from '@/auth/controller';
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

/** Routes the session envelope to the secure adapter; any other key the
 * auth library uses (transient verifiers) stays memory-only. */
export function bridgeStorage(storage: SessionStorage, gate: SessionWriteGate) {
  const transient = new Map<string, string>();
  return {
    getItem: async (key: string): Promise<string | null> => {
      if (key !== STORAGE_KEY) return transient.get(key) ?? null;
      return gate.open ? storage.read() : null;
    },
    setItem: async (key: string, value: string): Promise<void> => {
      if (key !== STORAGE_KEY) {
        transient.set(key, value);
        return;
      }
      if (!gate.open) return;
      await storage.write(value);
    },
    removeItem: async (key: string): Promise<void> => {
      if (key === STORAGE_KEY) {
        await storage.delete();
      } else {
        transient.delete(key);
      }
    },
  };
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

function makeAuthGateway(client: HiveSupabaseClient): AuthGateway {
  return {
    async getSession(): Promise<SessionInfo | null> {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      return toSessionInfo(client, data.session);
    },
    async requestOtp(email: string): Promise<void> {
      // Invite-only: never create a user from the app.
      const { error } = await client.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false },
      });
      if (error) throw error;
    },
    async verifyOtp(email: string, token: string): Promise<SessionInfo> {
      const { data, error } = await client.auth.verifyOtp({ email, token, type: 'email' });
      if (error) throw error;
      return requireSessionInfo(await toSessionInfo(client, data.session));
    },
    async listTotpFactors() {
      const { data, error } = await client.auth.mfa.listFactors();
      if (error) throw error;
      const totp = data?.totp ?? [];
      return {
        verifiedId: totp.find((factor) => factor.status === 'verified')?.id ?? null,
        unverifiedIds: totp
          .filter((factor) => factor.status !== 'verified')
          .map((factor) => factor.id),
      };
    },
    async enrollTotp() {
      const { data, error } = await client.auth.mfa.enroll({ factorType: 'totp' });
      if (error) throw error;
      if (!data?.id || !data.totp?.secret) throw new SafeError('unknown');
      // Memory-only setup material; never persisted, logged, or exported.
      return {
        factorId: data.id,
        secret: data.totp.secret,
        qrSvg: data.totp.qr_code ?? null,
        uri: data.totp.uri ?? null,
      };
    },
    async unenrollTotp(factorId: string): Promise<void> {
      const { error } = await client.auth.mfa.unenroll({ factorId });
      if (error) throw error;
    },
    async verifyTotp(factorId: string, code: string): Promise<SessionInfo> {
      const { error } = await client.auth.mfa.challengeAndVerify({ factorId, code });
      if (error) throw error;
      const { data, error: sessionError } = await client.auth.getSession();
      if (sessionError) throw sessionError;
      return requireSessionInfo(await toSessionInfo(client, data.session));
    },
    async signOutRemote(): Promise<void> {
      const { error } = await client.auth.signOut();
      if (error) throw error;
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
): SupabaseBundle {
  const client = createClient<Database>(env.supabaseUrl, env.supabaseClientKey, {
    auth: {
      storage: bridgeStorage(storage, gate),
      storageKey: STORAGE_KEY,
      autoRefreshToken: false,
      persistSession: true,
      detectSessionInUrl: false,
      lock: processLock,
    },
  });
  return {
    client,
    auth: makeAuthGateway(client),
    memberships: makeMembershipGateway(client),
    dispose(): void {
      void client.auth.stopAutoRefresh();
    },
  };
}
