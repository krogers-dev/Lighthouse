/** Canonical synthetic identity and membership matrix (P0-2).
 *
 * The full Supabase lane (scripts/seed-local.mjs) creates these users
 * through the Auth Admin API — placeholder auth.users rows cannot sign
 * in — and inserts the membership matrix bound to the real generated ids.
 * The SQL-only pgTAP lane loads the mirrored fixed-UUID version in
 * supabase/seeds/pgtap-identities.sql. Keep the two in lockstep; pgTAP
 * resolves users by email so both lanes satisfy the same suites.
 * Synthetic identities only; example.invalid emails.
 */

export const SCOPE = {
  environmentId: '11111111-0000-4000-8000-000000000001',
  clientA: 'aaaaaaaa-0000-4000-8000-000000000001',
  clientB: 'bbbbbbbb-0000-4000-8000-000000000001',
  entityA1: 'aaaaaaaa-1111-4000-8000-000000000001',
  entityA2: 'aaaaaaaa-2222-4000-8000-000000000002',
  entityB1: 'bbbbbbbb-1111-4000-8000-000000000001',
  entityB2: 'bbbbbbbb-2222-4000-8000-000000000002',
};

/** memberships: [clientKey, entityKey, role] */
export const SYNTHETIC_IDENTITIES = [
  {
    email: 'client.owner@example.invalid',
    memberships: [
      ['clientA', 'entityA1', 'client_user'],
      ['clientA', 'entityA2', 'client_user'],
    ],
  },
  {
    email: 'intake.beth@example.invalid',
    memberships: [
      ['clientA', 'entityA1', 'intake'],
      ['clientA', 'entityA2', 'intake'],
      ['clientB', 'entityB1', 'intake'],
      ['clientB', 'entityB2', 'intake'],
    ],
  },
  {
    email: 'preparer.pat@example.invalid',
    memberships: [
      ['clientA', 'entityA1', 'preparer'],
      ['clientB', 'entityB1', 'preparer'],
    ],
  },
  {
    email: 'reviewer.rae@example.invalid',
    memberships: [['clientA', 'entityA1', 'reviewer']],
  },
  {
    email: 'approver.avery@example.invalid',
    memberships: [['clientA', 'entityA1', 'approver']],
  },
  {
    email: 'client.second@example.invalid',
    memberships: [['clientB', 'entityB1', 'client_user']],
  },
  {
    email: 'nomember.norman@example.invalid',
    memberships: [],
  },
  {
    email: 'mixed.cross@example.invalid',
    memberships: [
      ['clientA', 'entityA1', 'client_user'],
      ['clientB', 'entityB1', 'preparer'],
    ],
  },
  {
    email: 'mixed.same@example.invalid',
    memberships: [
      ['clientA', 'entityA1', 'client_user'],
      ['clientA', 'entityA1', 'reviewer'],
    ],
  },
];

export function membershipRows(resolvedIdByEmail) {
  const rows = [];
  for (const identity of SYNTHETIC_IDENTITIES) {
    const userId = resolvedIdByEmail.get(identity.email);
    if (!userId) {
      throw new Error(`no resolved user id for ${identity.email}`);
    }
    for (const [clientKey, entityKey, role] of identity.memberships) {
      rows.push({
        user_id: userId,
        environment_id: SCOPE.environmentId,
        client_id: SCOPE[clientKey],
        entity_id: SCOPE[entityKey],
        role,
      });
    }
  }
  return rows;
}
