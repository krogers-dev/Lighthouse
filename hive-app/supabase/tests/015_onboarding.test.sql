-- Onboarding (WO-012): the server role brings a client and a legal entity
-- into an environment by name, grants and revokes memberships, and looks a
-- person up by address; every change writes a receipt in the scope it
-- touches, the same key never writes twice, and no client role reaches
-- any of it.
--
-- Seeded state this suite relies on: the environment 'local-development';
-- nomember.norman exists with no memberships; client.owner holds
-- client_user on A1. Everything the suite creates is rolled back.
begin;
-- Explicit: pgTAP lives in the extensions schema on a hosted project.
set local search_path = public, extensions;
select plan(40);

create function pg_temp.user_id_for(p_email text)
returns uuid language sql stable security definer as $$
  select id from auth.users where lower(email) = lower(p_email)
$$;

create function pg_temp.impersonate_email(p_email text, aal text default 'aal2')
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

create function pg_temp.become_service_role()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'service_role', true);
end;
$$;

create function pg_temp.audit_count(p_action text, p_entity uuid)
returns integer language sql security definer as $$
  select count(*)::int from public.audit_receipts
   where action = p_action and entity_id = p_entity
$$;

create function pg_temp.entity_count(p_name text)
returns integer language sql security definer as $$
  select count(*)::int from public.entities where display_name = p_name
$$;

create function pg_temp.membership_count(p_email text, p_entity uuid)
returns integer language sql security definer as $$
  select count(*)::int from public.memberships
   where user_id = pg_temp.user_id_for(p_email) and entity_id = p_entity
$$;

-- ---------------------------------------------------------------------------
-- Grants: the server role alone
-- ---------------------------------------------------------------------------
select is(has_function_privilege('anon',
  'public.onboard_entity(text,text,text,text,uuid)', 'execute'), false,
  'anon cannot onboard');                                                    -- 1
select is(has_function_privilege('authenticated',
  'public.onboard_entity(text,text,text,text,uuid)', 'execute'), false,
  'authenticated cannot onboard');                                           -- 2
select is(has_function_privilege('service_role',
  'public.onboard_entity(text,text,text,text,uuid)', 'execute'), true,
  'the server role can');                                                    -- 3
select is(has_function_privilege('authenticated',
  'public.grant_membership(uuid,uuid,uuid,uuid,text,uuid)', 'execute'), false,
  'authenticated cannot grant a membership');                                -- 4
select is(has_function_privilege('authenticated',
  'public.revoke_membership(uuid,uuid,uuid,uuid,text,uuid)', 'execute'), false,
  'authenticated cannot revoke one');                                        -- 5
select is(has_function_privilege('authenticated',
  'public.operator_user_id_by_email(text)', 'execute'), false,
  'authenticated cannot look a person up by address');                       -- 6
select is(has_function_privilege('anon',
  'public.operator_user_id_by_email(text)', 'execute'), false,
  'nor can anon');                                                           -- 7
select is(has_function_privilege('authenticated',
  'app_private.user_id_by_email(text)', 'execute'), false,
  'and the helper that reads the identity table is closed to client roles'); -- 8

-- ---------------------------------------------------------------------------
-- Onboarding an entity
-- ---------------------------------------------------------------------------
select pg_temp.become_service_role();
select gen_random_uuid() as first_key \gset
select public.onboard_entity('local-development', 'development',
  'Onboarding Suite Client (Synthetic)', 'Onboarding Suite Entity One (Synthetic)',
  :'first_key') as first \gset

select is((:'first'::jsonb ->> 'environment_created')::boolean, false,
  'an existing environment is found by name, not created again');            -- 9
select is((:'first'::jsonb ->> 'client_created')::boolean, true,
  'a new client is created');                                                -- 10
select is(:'first'::jsonb ->> 'environment_id', '11111111-0000-4000-8000-000000000001',
  'in the environment that was named');                                      -- 11
select is(pg_temp.entity_count('Onboarding Suite Entity One (Synthetic)'), 1,
  'and the entity exists under its name');                                   -- 12
select is(pg_temp.audit_count('entity.onboarded', (:'first'::jsonb ->> 'entity_id')::uuid), 1,
  'with one receipt in the new scope');                                      -- 13

select public.onboard_entity('local-development', 'development',
  'Onboarding Suite Client (Synthetic)', 'Onboarding Suite Entity One (Synthetic)',
  :'first_key') as replay \gset
select is((:'replay'::jsonb ->> 'replayed')::boolean, true,
  'the same key replays the same result');                                   -- 14
select is(:'replay'::jsonb ->> 'entity_id', :'first'::jsonb ->> 'entity_id',
  'naming the same entity');                                                 -- 15
select is(pg_temp.entity_count('Onboarding Suite Entity One (Synthetic)'), 1,
  'and writes nothing twice');                                               -- 16

select public.onboard_entity('local-development', 'development',
  '  onboarding   suite client (synthetic) ', 'Onboarding Suite Entity Two (Synthetic)',
  gen_random_uuid()) as second \gset
select is((:'second'::jsonb ->> 'client_created')::boolean, false,
  'a second entity joins the same client, found without regard to case or spacing'); -- 17
select is(:'second'::jsonb ->> 'client_id', :'first'::jsonb ->> 'client_id',
  'the very same client');                                                   -- 18

select throws_ok(
  $$select public.onboard_entity('local-development', 'development',
      'Onboarding Suite Client (Synthetic)', 'onboarding suite entity one (synthetic)',
      gen_random_uuid())$$,
  'P0001', 'entity_exists',
  'an entity name already used by the client is refused, whatever its case'); -- 19

select public.onboard_entity('onboarding-suite-environment', 'staging',
  'Onboarding Suite Client (Synthetic)', 'Onboarding Suite Entity One (Synthetic)',
  gen_random_uuid()) as elsewhere \gset
select is((:'elsewhere'::jsonb ->> 'environment_created')::boolean, true,
  'an environment that does not exist is created with its kind');            -- 20
select isnt(:'elsewhere'::jsonb ->> 'client_id', :'first'::jsonb ->> 'client_id',
  'and the same client name there is another client');                       -- 21

select throws_ok(
  $$select public.onboard_entity('local-development', 'production',
      'Onboarding Suite Other (Synthetic)', 'Onboarding Suite Other (Synthetic)',
      gen_random_uuid())$$,
  'P0001', 'environment_kind_mismatch',
  'an existing environment named with another kind is refused');             -- 22
select throws_ok(
  $$select public.onboard_entity('local-development', 'development',
      '   ', 'Onboarding Suite Other (Synthetic)', gen_random_uuid())$$,
  'P0001', 'invalid_name', 'a blank name is refused');                       -- 23
select throws_ok(
  $$select public.onboard_entity('local-development', 'development',
      'Onboarding Suite Other (Synthetic)', E'Line one\nline two', gen_random_uuid())$$,
  'P0001', 'invalid_name', 'a name with a line break is refused');           -- 24
select throws_ok(
  $$select public.onboard_entity('local-development', 'development',
      'Onboarding Suite Other (Synthetic)', repeat('x', 121), gen_random_uuid())$$,
  'P0001', 'invalid_name', 'a name over 120 characters is refused');         -- 25
select throws_ok(
  $$select public.onboard_entity('local-development', 'sandbox',
      'Onboarding Suite Other (Synthetic)', 'Onboarding Suite Other (Synthetic)',
      gen_random_uuid())$$,
  'P0001', 'invalid_kind', 'an unknown environment kind is refused');        -- 26
select throws_ok(
  $$select public.onboard_entity('local-development', 'development',
      'Onboarding Suite Other (Synthetic)', 'Onboarding Suite Other (Synthetic)', null)$$,
  'P0001', 'invalid_idempotency_key', 'a missing key is refused');           -- 27

select pg_temp.impersonate_email('client.owner@example.invalid', 'aal2');
select throws_ok(
  $$select public.onboard_entity('local-development', 'development',
      'Onboarding Suite Other (Synthetic)', 'Onboarding Suite Other (Synthetic)',
      gen_random_uuid())$$,
  '42501', null, 'a signed-in person is refused at the door');               -- 28

-- ---------------------------------------------------------------------------
-- Memberships
-- ---------------------------------------------------------------------------
select pg_temp.become_service_role();
select (:'first'::jsonb ->> 'environment_id')::uuid as env,
       (:'first'::jsonb ->> 'client_id')::uuid as cli,
       (:'first'::jsonb ->> 'entity_id')::uuid as ent \gset
select gen_random_uuid() as grant_key \gset
select public.grant_membership(pg_temp.user_id_for('nomember.norman@example.invalid'),
  :'env', :'cli', :'ent', 'client_user', :'grant_key') as granted \gset
select is((:'granted'::jsonb ->> 'granted')::boolean, true,
  'the server role grants a membership');                                    -- 29
select is(pg_temp.audit_count('membership.granted', :'ent'), 1,
  'with a receipt in its scope');                                            -- 30
select is((public.grant_membership(pg_temp.user_id_for('nomember.norman@example.invalid'),
  :'env', :'cli', :'ent', 'client_user', :'grant_key') ->> 'replayed')::boolean, true,
  'the same key replays');                                                   -- 31
select is((public.grant_membership(pg_temp.user_id_for('nomember.norman@example.invalid'),
  :'env', :'cli', :'ent', 'client_user', gen_random_uuid()) ->> 'granted')::boolean, false,
  'a membership already held is not granted twice');                         -- 32
select is(pg_temp.membership_count('nomember.norman@example.invalid', :'ent'), 1,
  'and one row stands');                                                     -- 33

select throws_ok(
  format($$select public.grant_membership(gen_random_uuid(), %L, %L, %L, 'client_user', gen_random_uuid())$$,
    :'env', :'cli', :'ent'),
  'P0001', 'unknown_user', 'a person who does not exist is refused');        -- 34
select throws_ok(
  format($$select public.grant_membership(%L, %L, %L, %L, 'client_user', gen_random_uuid())$$,
    pg_temp.user_id_for('nomember.norman@example.invalid'), :'env',
    'aaaaaaaa-0000-4000-8000-000000000001', :'ent'),
  'P0001', 'unknown_scope', 'an entity named under the wrong client is refused'); -- 35
select throws_ok(
  format($$select public.grant_membership(%L, %L, %L, %L, 'owner', gen_random_uuid())$$,
    pg_temp.user_id_for('nomember.norman@example.invalid'), :'env', :'cli', :'ent'),
  'P0001', 'invalid_role', 'a role outside the five is refused');            -- 36

select pg_temp.impersonate_email('nomember.norman@example.invalid', 'aal1');
select is((select count(*)::int from public.entities), 1,
  'the new member reads exactly the one entity they were given');            -- 37

select pg_temp.become_service_role();
select is((public.revoke_membership(pg_temp.user_id_for('nomember.norman@example.invalid'),
  :'env', :'cli', :'ent', 'client_user', gen_random_uuid()) ->> 'revoked')::boolean, true,
  'the server role revokes it');                                             -- 38
select pg_temp.impersonate_email('nomember.norman@example.invalid', 'aal1');
select is((select count(*)::int from public.entities), 0,
  'and the person reads nothing at once');                                   -- 39

-- ---------------------------------------------------------------------------
-- Looking a person up
-- ---------------------------------------------------------------------------
select pg_temp.become_service_role();
select ok(
  public.operator_user_id_by_email('NoMember.Norman@Example.Invalid')
    = pg_temp.user_id_for('nomember.norman@example.invalid')
  and public.operator_user_id_by_email('nobody.at.all@example.invalid') is null,
  'the server role finds a person by address whatever its case, and nothing for a stranger'); -- 40

select * from finish();
rollback;
