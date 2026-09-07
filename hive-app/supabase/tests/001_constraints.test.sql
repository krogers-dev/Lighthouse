-- Constraints: NOT NULL scope, composite-FK boundary enforcement,
-- immutable scope columns, append-only audit. Runs as the cluster
-- superuser deliberately: these must hold even for privileged writers.
begin;
select plan(12);

-- 1. Scope columns are NOT NULL.
select throws_ok(
  $$insert into public.cases (environment_id, client_id, entity_id, title)
    values ('11111111-0000-4000-8000-000000000001',
            'aaaaaaaa-0000-4000-8000-000000000001', null, 'x')$$,
  '23502', null, 'case without an entity scope is rejected');

-- 2. A case cannot claim entity B1 under client A: composite FK mismatch.
select throws_ok(
  $$insert into public.cases (environment_id, client_id, entity_id, title)
    values ('11111111-0000-4000-8000-000000000001',
            'aaaaaaaa-0000-4000-8000-000000000001',
            'bbbbbbbb-1111-4000-8000-000000000001', 'cross-scope case')$$,
  '23503', null, 'cross-boundary case scope is unrepresentable');

-- 3. An attention item cannot reference case A1 while claiming scope B1.
select throws_ok(
  $$insert into public.case_attention_items
      (environment_id, client_id, entity_id, case_id, summary)
    values ('11111111-0000-4000-8000-000000000001',
            'bbbbbbbb-0000-4000-8000-000000000001',
            'bbbbbbbb-1111-4000-8000-000000000001',
            'eeeeeeee-0000-4000-8000-0000000000a1', 'cross-scope attention')$$,
  '23503', null, 'attention item cannot point across a boundary');

-- 4-5. Scope columns are immutable.
select throws_ok(
  $$update public.cases
      set environment_id = '11111111-0000-4000-8000-000000000001'::uuid,
          client_id = 'bbbbbbbb-0000-4000-8000-000000000001'::uuid,
          entity_id = 'bbbbbbbb-1111-4000-8000-000000000001'::uuid
    where id = 'eeeeeeee-0000-4000-8000-0000000000a1'$$,
  'P0001', 'scope columns are immutable', 'case scope cannot change');

select throws_ok(
  $$update public.memberships
      set entity_id = 'aaaaaaaa-2222-4000-8000-000000000002'::uuid
    where id = 'dddddddd-0000-4000-8000-000000000001'$$,
  'P0001', 'scope columns are immutable', 'membership scope cannot change');

-- 6-7. Audit receipts are append-only.
select throws_ok(
  $$update public.audit_receipts set action = 'tampered'$$,
  'P0001', 'audit receipts are append-only', 'audit rows cannot be updated');

select throws_ok(
  $$delete from public.audit_receipts$$,
  'P0001', 'audit receipts are append-only', 'audit rows cannot be deleted');

-- 8-10. Enumerated value checks.
select throws_ok(
  $$insert into public.memberships (user_id, environment_id, client_id, entity_id, role)
    values ((select id from auth.users where email = 'nomember.norman@example.invalid'),
            '11111111-0000-4000-8000-000000000001',
            'aaaaaaaa-0000-4000-8000-000000000001',
            'aaaaaaaa-1111-4000-8000-000000000001', 'superuser')$$,
  '23514', null, 'unknown membership role is rejected');

select throws_ok(
  $$insert into public.cases (environment_id, client_id, entity_id, title, status)
    values ('11111111-0000-4000-8000-000000000001',
            'aaaaaaaa-0000-4000-8000-000000000001',
            'aaaaaaaa-1111-4000-8000-000000000001', 'x', 'RELEASED')$$,
  '23514', null, 'unknown case status is rejected');

select throws_ok(
  $$insert into public.environments (id, name, kind)
    values (gen_random_uuid(), 'x', 'sandbox')$$,
  '23514', null, 'unknown environment kind is rejected');

-- 11. A scope-consistent insert still works.
select lives_ok(
  $$insert into public.cases (environment_id, client_id, entity_id, title)
    values ('11111111-0000-4000-8000-000000000001',
            'aaaaaaaa-0000-4000-8000-000000000001',
            'aaaaaaaa-1111-4000-8000-000000000001', 'constraint smoke case')$$,
  'scope-consistent insert succeeds');

-- 12. RLS is enabled on every public table.
select is(
  (select count(*)::int from pg_tables
    where schemaname = 'public' and not rowsecurity),
  0, 'every public table has row level security enabled');

select * from finish();
rollback;
