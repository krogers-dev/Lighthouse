/** Synthetic fixtures. Clearly fictional; example.invalid emails only. */
import { asClientId, asEntityId, asEnvironmentId, asMembershipId, asUserId } from '@/core/ids';
import type { Actor, Membership } from '@/tenancy/types';

export const ENV_DEV = asEnvironmentId('11111111-0000-4000-8000-000000000001');

export const CLIENT_A = asClientId('aaaaaaaa-0000-4000-8000-000000000001');
export const CLIENT_B = asClientId('bbbbbbbb-0000-4000-8000-000000000001');

export const ENTITY_A1 = asEntityId('aaaaaaaa-1111-4000-8000-000000000001');
export const ENTITY_A2 = asEntityId('aaaaaaaa-2222-4000-8000-000000000002');
export const ENTITY_B1 = asEntityId('bbbbbbbb-1111-4000-8000-000000000001');

export const USER_CLIENT = asUserId('cccccccc-0000-4000-8000-000000000001');
export const USER_STAFF = asUserId('cccccccc-0000-4000-8000-000000000002');
/** Mirrors the seeded mixed.same@example.invalid user: two memberships with
 * different roles on the SAME entity (scripts/lib/synthetic-identities.mjs). */
export const USER_MIXED_SAME = asUserId('cccccccc-0000-4000-8000-000000000009');

export const actorAal1: Actor = { userId: USER_CLIENT, aal: 'aal1' };
export const actorAal2: Actor = { userId: USER_STAFF, aal: 'aal2' };

export const membershipA1: Membership = {
  membershipId: asMembershipId('dddddddd-0000-4000-8000-000000000001'),
  environmentId: ENV_DEV,
  clientId: CLIENT_A,
  entityId: ENTITY_A1,
  role: 'client_user',
  clientName: 'Harbor Light Bakery LLC (Synthetic)',
  entityName: 'Harbor Light Bakery LLC (Synthetic)',
};

export const membershipA2: Membership = {
  membershipId: asMembershipId('dddddddd-0000-4000-8000-000000000002'),
  environmentId: ENV_DEV,
  clientId: CLIENT_A,
  entityId: ENTITY_A2,
  role: 'client_user',
  clientName: 'Harbor Light Bakery LLC (Synthetic)',
  entityName: 'Harbor Light Holdings LLC (Synthetic)',
};

export const membershipB1Staff: Membership = {
  membershipId: asMembershipId('dddddddd-0000-4000-8000-000000000003'),
  environmentId: ENV_DEV,
  clientId: CLIENT_B,
  entityId: ENTITY_B1,
  role: 'preparer',
  clientName: 'Cedar Grove Consulting LLC (Synthetic)',
  entityName: 'Cedar Grove Consulting LLC (Synthetic)',
};

/** Same-entity pair for USER_MIXED_SAME (DB seed rows ...-0053/-0054): the
 * environment/client/entity triple matches exactly; only membershipId and
 * role differ. Request identity must still distinguish them (P2-9). */
export const membershipMixedClient: Membership = {
  membershipId: asMembershipId('dddddddd-0000-4000-8000-000000000053'),
  environmentId: ENV_DEV,
  clientId: CLIENT_A,
  entityId: ENTITY_A1,
  role: 'client_user',
  clientName: 'Harbor Light Bakery LLC (Synthetic)',
  entityName: 'Harbor Light Bakery LLC (Synthetic)',
};

export const membershipMixedReviewer: Membership = {
  membershipId: asMembershipId('dddddddd-0000-4000-8000-000000000054'),
  environmentId: ENV_DEV,
  clientId: CLIENT_A,
  entityId: ENTITY_A1,
  role: 'reviewer',
  clientName: 'Harbor Light Bakery LLC (Synthetic)',
  entityName: 'Harbor Light Bakery LLC (Synthetic)',
};

export const FORGED_MEMBERSHIP_ID = asMembershipId('face0000-0000-4000-8000-00000000face');
