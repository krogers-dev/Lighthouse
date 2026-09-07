-- Grants: anonymous holds nothing; authenticated holds SELECT only and
-- only where granted; the privileged schema and its functions are
-- unreachable from client roles.
begin;
select plan(12);

-- 1. anon holds no privilege of any kind on any public table.
select ok(
  not exists (
    select 1 from pg_tables t
    where t.schemaname = 'public'
      and has_table_privilege(
        'anon', format('%I.%I', t.schemaname, t.tablename),
        'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
  ),
  'anon holds no privilege on any public table');

-- 2. authenticated cannot write anywhere in public.
select ok(
  not exists (
    select 1 from pg_tables t
    where t.schemaname = 'public'
      and has_table_privilege(
        'authenticated', format('%I.%I', t.schemaname, t.tablename),
        'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
  ),
  'authenticated holds no write privilege on any public table');

-- 3. authenticated has SELECT on exactly the readable tables — by NAME,
-- not by count. A count only proves how many tables are readable; naming
-- them proves WHICH, so swapping one grant for another cannot pass.
select is(
  (select array_agg(t.tablename::text order by t.tablename) from pg_tables t
    where t.schemaname = 'public'
      and has_table_privilege(
        'authenticated', format('%I.%I', t.schemaname, t.tablename), 'SELECT')),
  array[
    'activity_events',
    'case_attention_items',
    'case_next_actions',
    'cases',
    'clients',
    'entities',
    'environments',
    'memberships',
    'requests'
  ],
  'authenticated can select exactly the nine granted tables, by name');

-- 4. audit receipts accept no client read at all.
select ok(
  not has_table_privilege('authenticated', 'public.audit_receipts', 'SELECT'),
  'authenticated cannot select audit receipts');

-- 5-7. Privileged function execution.
select ok(
  not has_function_privilege(
    'anon', 'app_private.append_audit(uuid, uuid, uuid, uuid, text, text, jsonb)', 'EXECUTE'),
  'anon cannot execute append_audit');

select ok(
  not has_function_privilege(
    'authenticated', 'app_private.append_audit(uuid, uuid, uuid, uuid, text, text, jsonb)', 'EXECUTE'),
  'authenticated cannot execute append_audit');

select ok(
  has_function_privilege(
    'service_role', 'app_private.append_audit(uuid, uuid, uuid, uuid, text, text, jsonb)', 'EXECUTE'),
  'service_role can execute append_audit');

-- 8-9. append_audit is security definer with a fixed search_path.
select ok(
  (select prosecdef from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_private' and p.proname = 'append_audit'),
  'append_audit is security definer');

select ok(
  exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_private' and p.proname = 'append_audit'
      and p.proconfig @> array['search_path=""']
  ),
  'append_audit pins an empty search_path');

-- 10-12. The unexposed schema is unreachable from client roles.
select ok(
  not has_schema_privilege('anon', 'app_private', 'USAGE'),
  'anon has no usage on app_private');

select ok(
  not has_schema_privilege('authenticated', 'app_private', 'USAGE'),
  'authenticated has no usage on app_private');

select ok(
  has_schema_privilege('service_role', 'app_private', 'USAGE'),
  'service_role has usage on app_private');

select * from finish();
rollback;
