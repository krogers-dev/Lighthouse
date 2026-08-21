import { membershipA1, membershipA2 } from '@/auth/__tests__/fixtures';

import { ScopedRegistry } from '../clearing';
import { scopeKeyEquals, scopeKeyFromMembership, scopeKeyToken } from '../scope-key';
import { isStaffRole, membershipsRequireAal2 } from '../types';

describe('ScopeKey', () => {
  it('is built only from a server-confirmed membership and is frozen', () => {
    const key = scopeKeyFromMembership(membershipA1);
    expect(key.environmentId).toBe(membershipA1.environmentId);
    expect(key.entityId).toBe(membershipA1.entityId);
    expect(Object.isFrozen(key)).toBe(true);
    try {
      (key as { entityId: string }).entityId = 'forged';
    } catch {
      // strict-mode environments throw on frozen writes; either way the
      // value must be unchanged.
    }
    expect(key.entityId).toBe(membershipA1.entityId);
  });

  it('compares by full scope identity', () => {
    const a = scopeKeyFromMembership(membershipA1);
    const b = scopeKeyFromMembership(membershipA1);
    const c = scopeKeyFromMembership(membershipA2);
    expect(scopeKeyEquals(a, b)).toBe(true);
    expect(scopeKeyEquals(a, c)).toBe(false);
    expect(scopeKeyToken(a)).not.toBe(scopeKeyToken(c));
  });
});

describe('ScopedRegistry', () => {
  it('clears every registered resource with the reason', () => {
    const registry = new ScopedRegistry();
    const reasons: string[] = [];
    registry.register({ clear: (reason) => reasons.push(`a:${reason}`) });
    registry.register({ clear: (reason) => reasons.push(`b:${reason}`) });
    expect(registry.clearAll('identity_switch')).toBe(2);
    expect(reasons).toEqual(['a:identity_switch', 'b:identity_switch']);
  });

  it('unregisters cleanly', () => {
    const registry = new ScopedRegistry();
    const unregister = registry.register({ clear: () => undefined });
    expect(registry.size).toBe(1);
    unregister();
    expect(registry.size).toBe(0);
  });
});

describe('role rules', () => {
  it('marks staff roles as requiring AAL2', () => {
    expect(isStaffRole('client_user')).toBe(false);
    expect(isStaffRole('intake')).toBe(true);
    expect(isStaffRole('approver')).toBe(true);
    expect(membershipsRequireAal2([membershipA1])).toBe(false);
  });
});
