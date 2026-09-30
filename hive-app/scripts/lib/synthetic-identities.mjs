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

/** Every identity carries one fixed, canonical Auth UUID (second RETURN
 * directive, area 1). The full-stack seed supplies this id to the Auth
 * Admin API and fails on any deviation; the SQL pgTAP lane inserts the
 * identical ids; JWT `sub` values are compared against these definitions
 * directly. memberships: [clientKey, entityKey, role]. */
export const SYNTHETIC_IDENTITIES = [
  {
    id: 'cccccccc-0000-4000-8000-000000000001',
    email: 'client.owner@example.invalid',
    memberships: [
      ['clientA', 'entityA1', 'client_user'],
      ['clientA', 'entityA2', 'client_user'],
    ],
  },
  {
    id: 'cccccccc-0000-4000-8000-000000000002',
    email: 'intake.beth@example.invalid',
    memberships: [
      ['clientA', 'entityA1', 'intake'],
      ['clientA', 'entityA2', 'intake'],
      ['clientB', 'entityB1', 'intake'],
      ['clientB', 'entityB2', 'intake'],
    ],
  },
  {
    id: 'cccccccc-0000-4000-8000-000000000003',
    email: 'preparer.pat@example.invalid',
    memberships: [
      ['clientA', 'entityA1', 'preparer'],
      ['clientB', 'entityB1', 'preparer'],
    ],
  },
  {
    id: 'cccccccc-0000-4000-8000-000000000004',
    email: 'reviewer.rae@example.invalid',
    memberships: [['clientA', 'entityA1', 'reviewer']],
  },
  {
    id: 'cccccccc-0000-4000-8000-000000000005',
    email: 'approver.avery@example.invalid',
    memberships: [['clientA', 'entityA1', 'approver']],
  },
  {
    id: 'cccccccc-0000-4000-8000-000000000006',
    email: 'client.second@example.invalid',
    memberships: [['clientB', 'entityB1', 'client_user']],
  },
  {
    id: 'cccccccc-0000-4000-8000-000000000007',
    email: 'nomember.norman@example.invalid',
    memberships: [],
  },
  {
    id: 'cccccccc-0000-4000-8000-000000000008',
    email: 'mixed.cross@example.invalid',
    memberships: [
      ['clientA', 'entityA1', 'client_user'],
      ['clientB', 'entityB1', 'preparer'],
    ],
  },
  {
    id: 'cccccccc-0000-4000-8000-000000000009',
    email: 'mixed.same@example.invalid',
    memberships: [
      ['clientA', 'entityA1', 'client_user'],
      ['clientA', 'entityA1', 'reviewer'],
    ],
  },
];

/** Membership rows bound to the canonical ids. Callers must have verified
 * (via verifyCanonicalUser) that the live Auth users carry exactly these
 * ids before inserting. */
export function membershipRows() {
  const rows = [];
  for (const identity of SYNTHETIC_IDENTITIES) {
    for (const [clientKey, entityKey, role] of identity.memberships) {
      rows.push({
        user_id: identity.id,
        environment_id: SCOPE.environmentId,
        client_id: SCOPE[clientKey],
        entity_id: SCOPE[entityKey],
        role,
      });
    }
  }
  return rows;
}
