/** Membership and actor types.
 *
 * A membership row is the only source of scope authority, and the list the
 * app holds always comes from a server-confirmed query — never from route
 * params, deep links, device storage, or form input.
 */
import type { ClientId, EntityId, EnvironmentId, MembershipId, UserId } from '@/core/ids';

export const MEMBERSHIP_ROLES = [
  'client_user',
  'intake',
  'preparer',
  'reviewer',
  'approver',
] as const;

export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

/** Staff roles require AAL2 before any scope binds. */
export const STAFF_ROLES: readonly MembershipRole[] = [
  'intake',
  'preparer',
  'reviewer',
  'approver',
];

export function isStaffRole(role: MembershipRole): boolean {
  return STAFF_ROLES.includes(role);
}

export type AuthenticatorAssuranceLevel = 'aal1' | 'aal2';

export interface Actor {
  readonly userId: UserId;
  readonly aal: AuthenticatorAssuranceLevel;
}

/** A server-confirmed membership row. */
export interface Membership {
  readonly membershipId: MembershipId;
  readonly environmentId: EnvironmentId;
  readonly clientId: ClientId;
  readonly entityId: EntityId;
  readonly role: MembershipRole;
  /** Synthetic display labels in Milestone 0. */
  readonly clientName: string;
  readonly entityName: string;
}

export function membershipsRequireAal2(memberships: readonly Membership[]): boolean {
  return memberships.some((m) => isStaffRole(m.role));
}
