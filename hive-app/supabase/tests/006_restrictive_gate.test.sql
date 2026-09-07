-- The staff-AAL2 invariant is a RESTRICTIVE policy layer (second RETURN
-- directive, area 3): it must hold even when someone later adds a
-- permissive allow policy to a protected table. Permissive policies OR
-- together; only a restrictive policy survives that. This suite proves
-- the separation structurally and behaviorally, including the bypass
-- regression: an allow-all permissive policy is added inside this
-- transaction and the AAL1 staff denial must still hold.
begin;
select plan(11);

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

-- Structure: every protected table carries exactly one RESTRICTIVE
-- staff-AAL2 select policy, separate from its permissive scope policy.
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public'
      and tablename in ('environments','clients','entities','cases',
                        'case_attention_items','case_next_actions')
      and permissive = 'RESTRICTIVE'
      and policyname like '%_staff_requires_aal2'),
  6, 'all six protected tables carry the restrictive staff-AAL2 policy');   -- 1

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public'
      and tablename in ('environments','clients','entities','cases',
                        'case_attention_items','case_next_actions')
      and permissive = 'PERMISSIVE'
      and policyname like '%_select_by_membership'
      and (qual like '%aal%')),
  0, 'no permissive scope policy embeds the AAL condition any more');       -- 2

-- Behavior unchanged: mixed same-scope user blocked at aal1, exact reach
-- at aal2, own membership rows still visible for routing.
select pg_temp.impersonate_email('mixed.same@example.invalid', 'aal1') \gset
select is((select count(*)::int from public.cases), 0,
  'mixed user at aal1: zero cases under the restrictive layer');            -- 3
select is((select count(*)::int from public.memberships), 2,
  'own membership rows stay visible at aal1 (documented exception)');       -- 4
select pg_temp.become_superuser() \gset

select pg_temp.impersonate_email('mixed.same@example.invalid', 'aal2') \gset
select is((select count(*)::int from public.cases), 2,
  'mixed user at aal2: exactly the A1 cases');                               -- 5
select pg_temp.become_superuser() \gset

-- BYPASS REGRESSION: add a permissive allow-all select policy. The
-- restrictive layer must still deny AAL1 staff; at aal2 the bypass
-- policy widens reach (proving the permissive layer really allowed all
-- rows and the aal1 denial came from the restrictive layer alone).
create policy qa_bypass_allow_all on public.cases
  for select to authenticated using (true);

select pg_temp.impersonate_email('mixed.same@example.invalid', 'aal1') \gset
select is((select count(*)::int from public.cases), 0,
  'REGRESSION: allow-all permissive policy cannot bypass the aal1 staff denial'); -- 6
select pg_temp.become_superuser() \gset

select pg_temp.impersonate_email('mixed.same@example.invalid', 'aal2') \gset
select is((select count(*)::int from public.cases), 4,
  'at aal2 the synthetic bypass policy is what widens reach — the denial was the restrictive layer'); -- 7
select pg_temp.become_superuser() \gset

-- A pure client user is untouched by the staff gate, with or without the
-- synthetic bypass policy present.
select pg_temp.impersonate_email('client.owner@example.invalid', 'aal1') \gset
select is((select count(*)::int from public.cases
           where entity_id in ('aaaaaaaa-1111-4000-8000-000000000001',
                               'aaaaaaaa-2222-4000-8000-000000000002')), 2,
  'client-only user keeps normal aal1 reach on their own scopes (both A1 cases)'); -- 8
select pg_temp.become_superuser() \gset

drop policy qa_bypass_allow_all on public.cases;

-- After removing the synthetic policy, reach returns exactly to normal.
select pg_temp.impersonate_email('mixed.same@example.invalid', 'aal2') \gset
select is((select count(*)::int from public.cases), 2,
  'reach returns to exact membership scope once the bypass policy is gone'); -- 9
select pg_temp.become_superuser() \gset

-- The restrictive layer never blocks aal2 staff (no over-blocking).
select pg_temp.impersonate_email('reviewer.rae@example.invalid', 'aal2') \gset
select is((select count(*)::int from public.cases), 2,
  'aal2 staff reach is unaffected by the restrictive layer');               -- 10
select pg_temp.become_superuser() \gset

-- Anonymous stays fully denied regardless of layering (grant layer,
-- before any policy is even consulted).
select set_config('request.jwt.claims', '', true) \gset
select set_config('role', 'anon', true) \gset
select throws_ok('select * from public.cases', '42501', null,
  'anonymous is denied at the grant layer under both policy layers');       -- 11

select * from finish();
rollback;
