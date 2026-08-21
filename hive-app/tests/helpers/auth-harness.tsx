/** Compact controller harness for cross-feature contract tests. All
 * dependencies are synthetic fakes; no native modules and no network. */
import { fixedClock } from '@/core/clock';
import { nullDiagnostics } from '@/core/diagnostics';
import type { UserId } from '@/core/ids';
import { AuthController, type SessionStorage } from '@/auth/controller';
import type { AuthListenerEvent, ClientBundle, SessionInfo } from '@/auth/client-lifecycle';
import { InstallMarker } from '@/auth/install-marker';
import { ScopedRegistry, type ClearReason } from '@/tenancy/clearing';
import type { Membership } from '@/tenancy/types';

class HarnessStorage implements SessionStorage {
  async read(): Promise<string | null> {
    return null;
  }
  async write(): Promise<void> {}
  async delete(): Promise<void> {}
  async scrubAll(): Promise<void> {}
  async hasResidue(): Promise<boolean> {
    return false;
  }
}

export interface ContractHarness {
  controller: AuthController;
  registry: ScopedRegistry;
  clearLog: ClearReason[];
}

export function makeContractHarness(options: {
  session: SessionInfo | null;
  memberships: Map<UserId, Membership[]>;
}): ContractHarness {
  const registry = new ScopedRegistry();
  const clearLog: ClearReason[] = [];
  registry.register({ clear: (reason) => clearLog.push(reason) });
  const listeners: ((event: AuthListenerEvent) => void)[] = [];
  const markerStore = {
    content: null as string | null,
    read: async () => markerStore.content,
    write: async (content: string) => {
      markerStore.content = content;
    },
  };
  const controller = new AuthController({
    createBundle: (): ClientBundle => ({
      auth: {
        getSession: async () => options.session,
        requestOtp: async () => {},
        verifyOtp: async () => {
          if (!options.session) throw new Error('no session configured');
          return options.session;
        },
        listTotpFactors: async () => ({ verifiedId: 'factor-synthetic', unverifiedIds: [] }),
        enrollTotp: async () => ({
          factorId: 'factor-enrolled-synthetic',
          secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
          qrSvg: null,
          uri: null,
        }),
        unenrollTotp: async () => {},
        verifyTotp: async () => {
          if (!options.session) throw new Error('no session configured');
          return options.session;
        },
        signOutRemote: async () => {},
        startAutoRefresh: () => {},
        stopAutoRefresh: () => {},
        onAuthStateChange: (listener) => {
          listeners.push(listener);
          return () => undefined;
        },
      },
      memberships: {
        listMemberships: async (userId) => options.memberships.get(userId) ?? [],
      },
      dispose: () => undefined,
    }),
    storage: new HarnessStorage(),
    marker: new InstallMarker(markerStore, { fill: (b) => b.fill(1) }, () => 0),
    registry,
    diagnostics: nullDiagnostics,
    clock: fixedClock(1_000_000),
    failMode: 'throw',
  });
  return { controller, registry, clearLog };
}
