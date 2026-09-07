-- Staff reads require AAL2 at the database, not just in the client.
-- A staff member's first-factor-only (aal1) JWT must see zero protected
-- rows even through a direct PostgREST/SQL query; client_user access is
-- unaffected at aal1; a user's own membership rows stay visible at aal1
-- because the client needs them to decide that MFA is required.
begin;
select plan(10);

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

-- Intake (staff) at aal1: routing metadata only, zero protected rows.
select pg_temp.impersonate_email('intake.beth@example.invalid', 'aal1') \gset
select is((select count(*)::int from public.memberships), 4,
  'staff at aal1 still sees their own membership rows (MFA routing)');   -- 1
select is((select count(*)::int from public.cases), 0,
  'staff at aal1 sees zero cases');                                      -- 2
select is((select count(*)::int from public.entities), 0,
  'staff at aal1 sees zero entities');                                   -- 3
select is((select count(*)::int from public.clients), 0,
  'staff at aal1 sees zero clients');                                    -- 4
select is((select count(*)::int from public.case_attention_items), 0,
  'staff at aal1 sees zero attention items');                            -- 5
select pg_temp.become_superuser() \gset

-- The same staff member at aal2 has their full membership reach.
select pg_temp.impersonate_email('intake.beth@example.invalid', 'aal2') \gset
select is((select count(*)::int from public.cases), 4,
  'staff at aal2 sees the cases their memberships cover');               -- 6
select is((select count(*)::int from public.entities), 4,
  'staff at aal2 sees their entities');                                  -- 7
select pg_temp.become_superuser() \gset

-- client_user access is unchanged at aal1.
select pg_temp.impersonate_email('client.owner@example.invalid', 'aal1') \gset
select is((select count(*)::int from public.cases), 2,
  'client user at aal1 still sees their two A1 cases');                          -- 8
select is((select count(*)::int from public.entities), 2,
  'client user at aal1 still sees their entities');                      -- 9
select pg_temp.become_superuser() \gset

-- A missing aal claim is treated as aal1 (fail closed) for staff.
select set_config('request.jwt.claims',
  json_build_object('sub', pg_temp.user_id_for('intake.beth@example.invalid'),
                    'role', 'authenticated')::text, true) \gset
select set_config('role', 'authenticated', true) \gset
select is((select count(*)::int from public.cases), 0,
  'staff with no aal claim is treated as aal1 and sees zero cases');     -- 10
select pg_temp.become_superuser() \gset

select * from finish();
rollback;
