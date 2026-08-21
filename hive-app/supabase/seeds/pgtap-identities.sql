-- SQL-only pgTAP identities (P0-2 split).
--
-- These auth.users rows are PLACEHOLDERS for the plain-PostgreSQL lane
-- (scripts/db-local.mjs): they satisfy foreign keys and let pgTAP
-- impersonate JWT claims, but they cannot sign in through GoTrue. The
-- full Supabase lane never loads this file — scripts/seed-local.mjs
-- creates real login-capable users through the Auth Admin API and inserts
-- the same membership matrix bound to the real ids.
--
-- The membership matrix here MUST stay identical to
-- scripts/lib/synthetic-identities.mjs (the canonical source the full
-- lane uses); pgTAP counts verify the effective state in both lanes.
-- All identities synthetic; example.invalid emails only.

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
   now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  -- Mixed-role fixtures (review P1-4): staff AAL2 gating must hold even
  -- when the same user also holds client_user memberships.
  ('00000000-0000-0000-0000-000000000000', 'cccccccc-0000-4000-8000-000000000008',
   'authenticated', 'authenticated', 'mixed.cross@example.invalid', '',
   now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cccccccc-0000-4000-8000-000000000009',
   'authenticated', 'authenticated', 'mixed.same@example.invalid', '',
   now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

-- Membership matrix — mirror of scripts/lib/synthetic-identities.mjs.
insert into public.memberships (id, user_id, environment_id, client_id, entity_id, role) values
  ('dddddddd-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001',
   '11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
   'aaaaaaaa-1111-4000-8000-000000000001', 'client_user'),
  ('dddddddd-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000001',
   '11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
   'aaaaaaaa-2222-4000-8000-000000000002', 'client_user'),
  ('dddddddd-0000-4000-8000-000000000006', 'cccccccc-0000-4000-8000-000000000006',
   '11111111-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001',
   'bbbbbbbb-1111-4000-8000-000000000001', 'client_user'),
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
  ('dddddddd-0000-4000-8000-000000000021', 'cccccccc-0000-4000-8000-000000000003',
   '11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
   'aaaaaaaa-1111-4000-8000-000000000001', 'preparer'),
  ('dddddddd-0000-4000-8000-000000000022', 'cccccccc-0000-4000-8000-000000000003',
   '11111111-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001',
   'bbbbbbbb-1111-4000-8000-000000000001', 'preparer'),
  ('dddddddd-0000-4000-8000-000000000031', 'cccccccc-0000-4000-8000-000000000004',
   '11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
   'aaaaaaaa-1111-4000-8000-000000000001', 'reviewer'),
  ('dddddddd-0000-4000-8000-000000000041', 'cccccccc-0000-4000-8000-000000000005',
   '11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
   'aaaaaaaa-1111-4000-8000-000000000001', 'approver'),
  -- mixed.cross: client_user on A1 plus preparer on B1.
  ('dddddddd-0000-4000-8000-000000000051', 'cccccccc-0000-4000-8000-000000000008',
   '11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
   'aaaaaaaa-1111-4000-8000-000000000001', 'client_user'),
  ('dddddddd-0000-4000-8000-000000000052', 'cccccccc-0000-4000-8000-000000000008',
   '11111111-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001',
   'bbbbbbbb-1111-4000-8000-000000000001', 'preparer'),
  -- mixed.same: client_user and reviewer on the same entity A1.
  ('dddddddd-0000-4000-8000-000000000053', 'cccccccc-0000-4000-8000-000000000009',
   '11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
   'aaaaaaaa-1111-4000-8000-000000000001', 'client_user'),
  ('dddddddd-0000-4000-8000-000000000054', 'cccccccc-0000-4000-8000-000000000009',
   '11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
   'aaaaaaaa-1111-4000-8000-000000000001', 'reviewer');
