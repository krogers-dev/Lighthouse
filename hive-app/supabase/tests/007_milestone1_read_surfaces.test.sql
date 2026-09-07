-- Milestone 1 read surfaces (requests, activity_events): the full denial
-- matrix, matching the shape suites 003-006 apply to the Milestone 0
-- tables. WO-002 A1/T1/T2: the threat is policy DRIFT between tables, so
-- these two are held to exactly the same standard as the original six.
begin;
select plan(34);

create function pg_temp.user_id_for(p_email text)
returns uuid language sql stable as $$
  select id from auth.users where lower(email) = lower(p_email)
$$;

create function pg_temp.impersonate_email(p_email text, aal text default 'aal1')
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.user_id_for(p_email),
                      'role', 'authenticated', 'aal', aal)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function pg_temp.become_anon()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
end;
$$;

create function pg_temp.become_superuser()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Structure: RLS enabled, least-privilege grants, indexed policy columns.
-- ---------------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.requests'::regclass),
  'requests has row level security enabled');                              -- 1
select ok(
  (select relrowsecurity from pg_class where oid = 'public.activity_events'::regclass),
  'activity_events has row level security enabled');                       -- 2
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'requests' and permissive = 'RESTRICTIVE'), 1,
  'requests carries the restrictive staff-AAL2 layer');                    -- 3
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'activity_events' and permissive = 'RESTRICTIVE'), 1,
  'activity_events carries the restrictive staff-AAL2 layer');             -- 4
select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'requests'
     and grantee = 'authenticated' and privilege_type <> 'SELECT'), 0,
  'requests grants authenticated nothing but SELECT');                     -- 5
select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'activity_events'
     and grantee = 'authenticated' and privilege_type <> 'SELECT'), 0,
  'activity_events grants authenticated nothing but SELECT');              -- 6
select ok(
  (select count(*) from pg_indexes where schemaname = 'public'
    and tablename = 'requests' and indexdef like '%environment_id, client_id, entity_id%') > 0,
  'requests policy columns are indexed');                                  -- 7
select ok(
  (select count(*) from pg_indexes where schemaname = 'public'
    and tablename = 'activity_events' and indexdef like '%environment_id, client_id, entity_id%') > 0,
  'activity_events policy columns are indexed');                           -- 8

-- activity_events must not be able to carry free text (threat T3).
select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and table_name = 'activity_events'
     and data_type in ('text', 'character varying')
     and column_name not in ('event_kind', 'actor_role')), 0,
  'activity_events has no free-text column beyond the enumerated kind and role'); -- 9

-- ---------------------------------------------------------------------------
-- Anonymous: denied at the grant layer, before any row is considered.
-- ---------------------------------------------------------------------------
select pg_temp.become_anon() \gset
select throws_ok('select * from public.requests', '42501', null,
  'anonymous cannot read requests');                                       -- 10
select throws_ok('select * from public.activity_events', '42501', null,
  'anonymous cannot read activity events');                                -- 11

-- ---------------------------------------------------------------------------
-- Client A owner: exactly their own scope, and nothing else.
-- ---------------------------------------------------------------------------
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('client.owner@example.invalid') \gset

select is((select count(*)::int from public.requests), 2,
  'client A owner sees exactly their two requests');                       -- 12
select is((select count(*)::int from public.activity_events), 3,
  'client A owner sees exactly their three activity events');              -- 13
select is(
  (select count(*)::int from public.requests
   where client_id = 'bbbbbbbb-0000-4000-8000-000000000001'), 0,
  'sweeping another client id returns zero requests');                     -- 14
select is(
  (select count(*)::int from public.activity_events
   where client_id = 'bbbbbbbb-0000-4000-8000-000000000001'), 0,
  'sweeping another client id returns zero activity events');              -- 15

-- T2: a forged/guessed id from another scope returns ZERO ROWS rather
-- than an error, so the response never confirms the row exists.
select is(
  (select count(*)::int from public.requests
   where id = 'dddddddd-0000-4000-8000-0000000000b1'), 0,
  'a guessed foreign request id returns zero rows, not an existence signal'); -- 16
select is(
  (select count(*)::int from public.activity_events
   where id = 'cccccccc-1111-4000-8000-0000000000b1'), 0,
  'a guessed foreign activity id returns zero rows, not an existence signal'); -- 17
select is(
  (select count(*)::int from public.requests
   where entity_id = 'bbbbbbbb-2222-4000-8000-000000000002'), 0,
  'the unreachable B2 entity yields zero requests');                       -- 18
select is(
  (select count(*)::int from public.activity_events
   where entity_id = 'bbbbbbbb-2222-4000-8000-000000000002'), 0,
  'the unreachable B2 entity yields zero activity events');                -- 19

-- Read-only surface: no write reaches the table, whatever the scope.
select throws_ok(
  $$insert into public.requests
      (environment_id, client_id, entity_id, case_id, title, detail, owner_role, requested_on)
    values ('11111111-0000-4000-8000-000000000001',
            'aaaaaaaa-0000-4000-8000-000000000001',
            'aaaaaaaa-1111-4000-8000-000000000001',
            'eeeeeeee-0000-4000-8000-0000000000a1',
            'x', 'y', 'client_user', '2026-08-20')$$,
  '42501', null, 'a client user cannot insert a request');                 -- 20
select throws_ok(
  $$update public.requests set status = 'CLOSED'$$,
  '42501', null, 'a client user cannot update a request');                 -- 21
select throws_ok(
  $$delete from public.requests$$,
  '42501', null, 'a client user cannot delete a request');                 -- 22
select throws_ok(
  $$insert into public.activity_events
      (environment_id, client_id, entity_id, case_id, event_kind, actor_role)
    values ('11111111-0000-4000-8000-000000000001',
            'aaaaaaaa-0000-4000-8000-000000000001',
            'aaaaaaaa-1111-4000-8000-000000000001',
            'eeeeeeee-0000-4000-8000-0000000000a1',
            'case.status_changed', 'preparer')$$,
  '42501', null, 'a client user cannot forge an activity event');          -- 23
select throws_ok(
  $$update public.activity_events set actor_role = 'approver'$$,
  '42501', null, 'a client user cannot rewrite activity history');         -- 24
select throws_ok(
  $$delete from public.activity_events$$,
  '42501', null, 'a client user cannot erase activity history');           -- 25

-- ---------------------------------------------------------------------------
-- A user with NO membership sees nothing at all.
-- ---------------------------------------------------------------------------
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('no.membership@example.invalid') \gset
select is((select count(*)::int from public.requests), 0,
  'a user with no membership sees zero requests');                         -- 26
select is((select count(*)::int from public.activity_events), 0,
  'a user with no membership sees zero activity events');                  -- 27

-- ---------------------------------------------------------------------------
-- Staff at AAL1: the restrictive layer denies the whole read surface.
-- ---------------------------------------------------------------------------
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('reviewer.rae@example.invalid', 'aal1') \gset
select is((select count(*)::int from public.requests), 0,
  'staff at aal1 sees zero requests');                                     -- 28
select is((select count(*)::int from public.activity_events), 0,
  'staff at aal1 sees zero activity events');                              -- 29

-- Same staff user at AAL2: their exact membership scope, nothing wider.
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('reviewer.rae@example.invalid', 'aal2') \gset
select is((select count(*)::int from public.requests), 2,
  'staff at aal2 sees exactly their scoped requests');                     -- 30
select is((select count(*)::int from public.activity_events), 3,
  'staff at aal2 sees exactly their scoped activity events');              -- 31
select is(
  (select count(*)::int from public.requests
   where entity_id = 'bbbbbbbb-2222-4000-8000-000000000002'), 0,
  'staff at aal2 still cannot reach an entity outside their membership');  -- 32

-- ---------------------------------------------------------------------------
-- Mixed-role user at AAL1: holding any staff membership denies the read.
-- ---------------------------------------------------------------------------
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('mixed.cross@example.invalid', 'aal1') \gset
select is((select count(*)::int from public.requests), 0,
  'a mixed-role user at aal1 sees zero requests despite a client membership'); -- 33
select is((select count(*)::int from public.activity_events), 0,
  'a mixed-role user at aal1 sees zero activity events');                  -- 34

select * from finish();
rollback;
