/** ScopeKey — the immutable binding every repository requires.
 *
 * Constructed exclusively from a server-confirmed Membership. There is no
 * constructor from strings, so a scope can never be minted from a route
 * param, deep link, stored value, or form input.
 */
import type { ClientId, EntityId, EnvironmentId, MembershipId } from '@/core/ids';

import type { Membership } from './types';

declare const scopeKeyBrand: unique symbol;

export interface ScopeKey {
  readonly environmentId: EnvironmentId;
  readonly clientId: ClientId;
  readonly entityId: EntityId;
  readonly membershipId: MembershipId;
  readonly [scopeKeyBrand]: true;
}

export function scopeKeyFromMembership(membership: Membership): ScopeKey {
  const key = {
    environmentId: membership.environmentId,
    clientId: membership.clientId,
    entityId: membership.entityId,
    membershipId: membership.membershipId,
  };
  return Object.freeze(key) as ScopeKey;
}

export function scopeKeyEquals(a: ScopeKey, b: ScopeKey): boolean {
  return (
    a.environmentId === b.environmentId &&
    a.clientId === b.clientId &&
    a.entityId === b.entityId &&
    a.membershipId === b.membershipId
  );
}

/** Cache/registry key material only — never storage, never navigation.
 * Includes membershipId: two memberships can share the same
 * environment/client/entity (different roles), and request identity and
 * cancellation keys must distinguish them (P2-9). */
export function scopeKeyToken(key: ScopeKey): string {
  return `${key.environmentId}:${key.clientId}:${key.entityId}:${key.membershipId}`;
}
