-- HIVE Milestone 0 synthetic seed. Everything here is clearly fictional:
-- "(Synthetic)" labels and example.invalid emails only. No financial
-- values, no real identities, no live data. UUIDs match the TypeScript
-- test fixtures (src/auth/__tests__/fixtures.ts) so app tests, pgTAP
-- tests, and the seeded database describe one world.
--
-- Synthetic authorized users are created server-side here (or by
-- scripts/seed-local.mjs through the admin API); the app itself can never
-- create users (self-registration is disabled).

-- ---------------------------------------------------------------------------
-- Synthetic auth users
-- ---------------------------------------------------------------------------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000', 'cccccccc-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'client.owner@example.invalid', '',
   now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cccccccc-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'intake.beth@example.invalid', '',
   now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cccccccc-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'preparer.pat@example.invalid', '',
   now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cccccccc-0000-4000-8000-000000000004',
   'authenticated', 'authenticated', 'reviewer.rae@example.invalid', '',
   now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cccccccc-0000-4000-8000-000000000005',
   'authenticated', 'authenticated', 'approver.avery@example.invalid', '',
   now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cccccccc-0000-4000-8000-000000000006',
   'authenticated', 'authenticated', 'client.second@example.invalid', '',
   now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cccccccc-0000-4000-8000-000000000007',
   'authenticated', 'authenticated', 'nomember.norman@example.invalid', '',
   now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

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
-- Memberships: client user, intake, preparer, reviewer, approver, and one
-- user with no membership at all (cccccccc-…-0007).
-- ---------------------------------------------------------------------------

insert into public.memberships (id, user_id, environment_id, client_id, entity_id, role) values
  -- Client A owner: both A entities (drives the scope chooser).
  ('dddddddd-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001',
   '11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
   'aaaaaaaa-1111-4000-8000-000000000001', 'client_user'),
  ('dddddddd-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000001',
   '11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
   'aaaaaaaa-2222-4000-8000-000000000002', 'client_user'),
  -- Client B owner: exactly one entity; B2 exists but is not theirs.
  ('dddddddd-0000-4000-8000-000000000006', 'cccccccc-0000-4000-8000-000000000006',
   '11111111-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001',
   'bbbbbbbb-1111-4000-8000-000000000001', 'client_user'),
  -- Intake (Beth): status tracking across all four entities.
  ('dddddddd-0000-4000-8000-000000000011', 'cccccccc-0000-4000-8000-000000000002',
   '11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
   'aaaaaaaa-1111-4000-8000-000000000001', 'intake'),
  ('dddddddd-0000-4000-8000-000000000012', 'cccccccc-0000-4000-8000-000000000002',
   '11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
   'aaaaaaaa-2222-4000-8000-000000000002', 'intake'),
  ('dddddddd-0000-4000-8000-000000000013', 'cccccccc-0000-4000-8000-000000000002',
   '11111111-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001',
   'bbbbbbbb-1111-4000-8000-000000000001', 'intake'),
  ('dddddddd-0000-4000-8000-000000000014', 'cccccccc-0000-4000-8000-000000000002',
   '11111111-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001',
   'bbbbbbbb-2222-4000-8000-000000000002', 'intake'),
  -- Preparer: one entity per client.
  ('dddddddd-0000-4000-8000-000000000021', 'cccccccc-0000-4000-8000-000000000003',
   '11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
   'aaaaaaaa-1111-4000-8000-000000000001', 'preparer'),
  ('dddddddd-0000-4000-8000-000000000022', 'cccccccc-0000-4000-8000-000000000003',
   '11111111-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001',
   'bbbbbbbb-1111-4000-8000-000000000001', 'preparer'),
  -- Reviewer and approver: conflict-free on A1 only.
  ('dddddddd-0000-4000-8000-000000000031', 'cccccccc-0000-4000-8000-000000000004',
   '11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
   'aaaaaaaa-1111-4000-8000-000000000001', 'reviewer'),
  ('dddddddd-0000-4000-8000-000000000041', 'cccccccc-0000-4000-8000-000000000005',
   '11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
   'aaaaaaaa-1111-4000-8000-000000000001', 'approver');

-- ---------------------------------------------------------------------------
-- Synthetic workflow content: one case with an attention item and next
-- action on A1; a bare case on B1; a case on B2 (visible to intake only);
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
   'One statement is still needed to complete the records (Synthetic)');

insert into public.case_next_actions (id, environment_id, client_id, entity_id, case_id, summary, owner_role) values
  ('ffffffff-1111-4000-8000-0000000000a1', '11111111-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-1111-4000-8000-000000000001',
   'eeeeeeee-0000-4000-8000-0000000000a1',
   'Provide the missing statement when convenient (Synthetic)', 'client_user');

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
