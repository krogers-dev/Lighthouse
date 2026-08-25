-- HIVE Milestone 0 synthetic seed — DOMAIN ROWS ONLY. Everything here is
-- clearly fictional: "(Synthetic)" labels, no financial values, no real
-- identities, no live data. UUIDs match the TypeScript test fixtures
-- (src/auth/__tests__/fixtures.ts).
--
-- Identities and memberships are deliberately NOT here (P0-2):
-- - Full Supabase lane: scripts/seed-local.mjs creates login-capable
--   users through the Auth Admin API (placeholder auth.users rows cannot
--   sign in) and then inserts memberships bound to the real user ids,
--   from the canonical matrix in scripts/lib/synthetic-identities.mjs.
-- - SQL-only pgTAP lane: scripts/db-local.mjs additionally applies
--   supabase/seeds/pgtap-identities.sql (fixed-UUID placeholders).
-- pgTAP suites resolve users by email so both lanes satisfy them.

-- ---------------------------------------------------------------------------
-- Scope: one development environment, two clients, two entities each
-- ---------------------------------------------------------------------------

insert into public.environments (id, name, kind) values
  ('11111111-0000-4000-8000-000000000001', 'local-development', 'development');

insert into public.clients (id, environment_id, display_name) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001',
   'Harbor Light Bakery LLC (Synthetic)'),
  ('bbbbbbbb-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001',
   'Cedar Grove Consulting LLC (Synthetic)');

insert into public.entities (id, environment_id, client_id, display_name) values
  ('aaaaaaaa-1111-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000001', 'Harbor Light Bakery LLC (Synthetic)'),
  ('aaaaaaaa-2222-4000-8000-000000000002', '11111111-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000001', 'Harbor Light Holdings LLC (Synthetic)'),
  ('bbbbbbbb-1111-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001',
   'bbbbbbbb-0000-4000-8000-000000000001', 'Cedar Grove Consulting LLC (Synthetic)'),
  ('bbbbbbbb-2222-4000-8000-000000000002', '11111111-0000-4000-8000-000000000001',
   'bbbbbbbb-0000-4000-8000-000000000001', 'Cedar Grove Properties LLC (Synthetic)');

-- ---------------------------------------------------------------------------
-- Synthetic workflow content: one case with an attention item and next
-- action on A1; a case with the same children on B1; a case on B2 with its
-- own attention item and next action (RETURN-4 P2-4: no seeded client
-- user, mixed.cross included, may reach the B2 children — without them
-- every seeded child row fell inside mixed.cross's reach and the
-- exact-reach assertion for those two tables was satisfied trivially);
-- A2 stays empty to exercise the dashboard empty state.
-- ---------------------------------------------------------------------------

insert into public.cases (id, environment_id, client_id, entity_id, title, status) values
  ('eeeeeeee-0000-4000-8000-0000000000a1', '11111111-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-1111-4000-8000-000000000001',
   '2025 books close (Synthetic)', 'EVIDENCE_PENDING'),
  ('eeeeeeee-0000-4000-8000-0000000000b1', '11111111-0000-4000-8000-000000000001',
   'bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-1111-4000-8000-000000000001',
   'Quarterly review (Synthetic)', 'DRAFT'),
  ('eeeeeeee-0000-4000-8000-0000000000b2', '11111111-0000-4000-8000-000000000001',
   'bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-2222-4000-8000-000000000002',
   'Entity setup checklist (Synthetic)', 'INTAKE_RECORDED');

insert into public.case_attention_items (id, environment_id, client_id, entity_id, case_id, summary) values
  ('ffffffff-0000-4000-8000-0000000000a1', '11111111-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-1111-4000-8000-000000000001',
   'eeeeeeee-0000-4000-8000-0000000000a1',
   'One statement is still needed to complete the records (Synthetic)'),
  -- Out-of-scope fixture (RETURN-3 area 6): lives in client B / entity B1
  -- so cross-scope isolation of attention items is a REAL negative.
  ('ffffffff-0000-4000-8000-0000000000b1', '11111111-0000-4000-8000-000000000001',
   'bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-1111-4000-8000-000000000001',
   'eeeeeeee-0000-4000-8000-0000000000b1',
   'Quarterly checklist item outstanding (Synthetic)'),
  -- ENTITY B2 fixture (RETURN-4 P2-4). Without it, every seeded attention
  -- item fell inside mixed.cross's reach (A + B1), so "exact reach" was
  -- satisfied trivially for this table and an entity-level leak would not
  -- have been detected. This row is reachable by NO seeded client user and
  -- by staff only at AAL2.
  ('ffffffff-0000-4000-8000-0000000000b2', '11111111-0000-4000-8000-000000000001',
   'bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-2222-4000-8000-000000000002',
   'eeeeeeee-0000-4000-8000-0000000000b2',
   'Entity setup documents not yet supplied (Synthetic)');

insert into public.case_next_actions (id, environment_id, client_id, entity_id, case_id, summary, owner_role) values
  ('ffffffff-1111-4000-8000-0000000000a1', '11111111-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-1111-4000-8000-000000000001',
   'eeeeeeee-0000-4000-8000-0000000000a1',
   'Provide the missing statement when convenient (Synthetic)', 'client_user'),
  -- Out-of-scope fixture (RETURN-3 area 6), client B / entity B1.
  ('ffffffff-1111-4000-8000-0000000000b1', '11111111-0000-4000-8000-000000000001',
   'bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-1111-4000-8000-000000000001',
   'eeeeeeee-0000-4000-8000-0000000000b1',
   'Prepare the quarterly review packet (Synthetic)', 'preparer'),
  -- ENTITY B2 fixture (RETURN-4 P2-4): the next-action counterpart, out of
  -- reach for every seeded client user including mixed.cross.
  ('ffffffff-1111-4000-8000-0000000000b2', '11111111-0000-4000-8000-000000000001',
   'bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-2222-4000-8000-000000000002',
   'eeeeeeee-0000-4000-8000-0000000000b2',
   'Collect the entity setup documents (Synthetic)', 'preparer');

-- A representative privileged audit receipt via the server-side writer.
select app_private.append_audit(
  null,
  '11111111-0000-4000-8000-000000000001',
  'aaaaaaaa-0000-4000-8000-000000000001',
  'aaaaaaaa-1111-4000-8000-000000000001',
  'seed.applied',
  'case:eeeeeeee-0000-4000-8000-0000000000a1',
  '{"note":"synthetic seed"}'::jsonb
);

-- ---------------------------------------------------------------------------
-- Milestone 1 read surfaces (WO-002 R2, R3)
--
-- Requests and activity for the A1 case, plus deliberately OUT-OF-SCOPE
-- rows on B1 and B2 so every isolation assertion is a real negative
-- rather than a set that happens to be the whole table (the RETURN-4 P2-4
-- lesson). No free text in activity by design — kinds and roles only.
-- ---------------------------------------------------------------------------

insert into public.requests
  (id, environment_id, client_id, entity_id, case_id, title, detail, owner_role, status, requested_on, due_on) values
  ('dddddddd-0000-4000-8000-0000000000a1', '11111111-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-1111-4000-8000-000000000001',
   'eeeeeeee-0000-4000-8000-0000000000a1',
   'Bank statement for the closing month (Synthetic)',
   'The final month statement is needed to complete the records (Synthetic).',
   'client_user', 'OPEN', '2026-08-10', '2026-09-10'),
  ('dddddddd-0000-4000-8000-0000000000a2', '11111111-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-1111-4000-8000-000000000001',
   'eeeeeeee-0000-4000-8000-0000000000a1',
   'Confirm the vehicle expense category (Synthetic)',
   'One category needs your confirmation before review (Synthetic).',
   'client_user', 'ANSWERED', '2026-08-05', null),
  -- Out of scope: client B / entity B1.
  ('dddddddd-0000-4000-8000-0000000000b1', '11111111-0000-4000-8000-000000000001',
   'bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-1111-4000-8000-000000000001',
   'eeeeeeee-0000-4000-8000-0000000000b1',
   'Quarterly packet source documents (Synthetic)',
   'Source documents for the quarterly packet (Synthetic).',
   'preparer', 'OPEN', '2026-08-12', null),
  -- Out of scope: entity B2, which NO seeded client user can reach.
  ('dddddddd-0000-4000-8000-0000000000b2', '11111111-0000-4000-8000-000000000001',
   'bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-2222-4000-8000-000000000002',
   'eeeeeeee-0000-4000-8000-0000000000b2',
   'Entity setup documents (Synthetic)',
   'Formation documents for the new entity (Synthetic).',
   'intake', 'OPEN', '2026-08-14', null);

insert into public.activity_events
  (id, environment_id, client_id, entity_id, case_id, event_kind, actor_role, occurred_at) values
  ('cccccccc-1111-4000-8000-0000000000a1', '11111111-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-1111-4000-8000-000000000001',
   'eeeeeeee-0000-4000-8000-0000000000a1', 'case.status_changed', 'preparer',
   '2026-08-01T15:00:00Z'),
  ('cccccccc-1111-4000-8000-0000000000a2', '11111111-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-1111-4000-8000-000000000001',
   'eeeeeeee-0000-4000-8000-0000000000a1', 'request.opened', 'intake',
   '2026-08-10T16:30:00Z'),
  ('cccccccc-1111-4000-8000-0000000000a3', '11111111-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-1111-4000-8000-000000000001',
   'eeeeeeee-0000-4000-8000-0000000000a1', 'request.answered', 'client_user',
   '2026-08-11T09:15:00Z'),
  -- Out of scope: client B / entity B1.
  ('cccccccc-1111-4000-8000-0000000000b1', '11111111-0000-4000-8000-000000000001',
   'bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-1111-4000-8000-000000000001',
   'eeeeeeee-0000-4000-8000-0000000000b1', 'request.opened', 'preparer',
   '2026-08-12T11:00:00Z'),
  -- Out of scope: entity B2.
  ('cccccccc-1111-4000-8000-0000000000b2', '11111111-0000-4000-8000-000000000001',
   'bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-2222-4000-8000-000000000002',
   'eeeeeeee-0000-4000-8000-0000000000b2', 'case.status_changed', 'intake',
   '2026-08-14T13:45:00Z');
