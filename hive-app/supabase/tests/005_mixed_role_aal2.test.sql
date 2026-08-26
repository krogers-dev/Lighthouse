-- Mixed-role accounts cannot bypass the global staff AAL2 gate through
-- the Data API (PM directive P1 item 4). A user holding both client_user
-- and staff memberships gets ZERO protected content at aal1 — including
-- through their client_user membership — and exactly their membership
-- reach at aal2. Direct-SQL equivalents of the PostgREST attack path;
-- the live-JWT PostgREST variant runs in scripts/e2e-local-auth.mjs.
begin;
select plan(12);

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

create function pg_temp.become_superuser()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Cross-scope mixed user: client_user on A1 plus preparer on B1.
select pg_temp.impersonate_email('mixed.cross@example.invalid', 'aal1') \gset
select is((select count(*)::int from public.memberships), 2,
  'cross-scope mixed user sees own membership rows at aal1 (routing)');  -- 1
select is((select count(*)::int from public.cases), 0,
  'cross-scope mixed user at aal1 sees zero cases, even via client_user'); -- 2
select is((select count(*)::int from public.entities), 0,
  'cross-scope mixed user at aal1 sees zero entities');                  -- 3
select is((select count(*)::int from public.clients), 0,
  'cross-scope mixed user at aal1 sees zero clients');                   -- 4
select is((select count(*)::int from public.cases
           where entity_id = 'aaaaaaaa-1111-4000-8000-000000000001'), 0,
  'targeting the client_user scope directly still yields zero at aal1'); -- 5
select pg_temp.become_superuser() \gset

select pg_temp.impersonate_email('mixed.cross@example.invalid', 'aal2') \gset
select is((select count(*)::int from public.cases), 3,
  'cross-scope mixed user at aal2 sees exactly the A1 and B1 cases');        -- 6
select is((select count(*)::int from public.entities), 2,
  'cross-scope mixed user at aal2 sees exactly their two entities');     -- 7
select is((select count(*)::int from public.cases
           where entity_id = 'bbbbbbbb-2222-4000-8000-000000000002'), 0,
  'aal2 grants membership reach only, never beyond (B2 stays hidden)');  -- 8
select pg_temp.become_superuser() \gset

-- Same-scope mixed user: client_user and reviewer both on A1.
select pg_temp.impersonate_email('mixed.same@example.invalid', 'aal1') \gset
select is((select count(*)::int from public.cases), 0,
  'same-scope mixed user at aal1 sees zero cases');                      -- 9
select is((select count(*)::int from public.memberships), 2,
  'same-scope mixed user sees both own membership rows at aal1');        -- 10
select pg_temp.become_superuser() \gset

select pg_temp.impersonate_email('mixed.same@example.invalid', 'aal2') \gset
select is((select count(*)::int from public.cases), 2,
  'same-scope mixed user at aal2 sees exactly the A1 cases');             -- 11
select is((select count(*)::int from public.entities), 1,
  'same-scope mixed user at aal2 sees exactly entity A1');               -- 12
select pg_temp.become_superuser() \gset

select * from finish();
rollback;
