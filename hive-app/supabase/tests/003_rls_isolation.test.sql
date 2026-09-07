-- Row-level security isolation: anonymous, no-membership, wrong-client,
-- wrong-entity, forged-ID, membership-creation, boundary-mutation, and
-- audit-access attempts all deny with zero protected fields.
begin;
select plan(29);

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
-- Anonymous: no read anywhere (denied at the grant layer, before any row).
-- ---------------------------------------------------------------------------
select pg_temp.become_anon() \gset
select throws_ok('select * from public.cases', '42501', null,
  'anonymous cannot read cases');                                     -- 1
select throws_ok('select * from public.memberships', '42501', null,
  'anonymous cannot read memberships');                               -- 2
select throws_ok('select * from public.audit_receipts', '42501', null,
  'anonymous cannot read audit receipts');                            -- 3
select pg_temp.become_superuser() \gset

-- ---------------------------------------------------------------------------
-- Client A owner: exactly their two entities, nothing of client B.
-- ---------------------------------------------------------------------------
select pg_temp.impersonate_email('client.owner@example.invalid') \gset
select is((select count(*)::int from public.memberships), 2,
  'client A owner sees exactly their two memberships');               -- 4
select is((select count(*)::int from public.environments), 1,
  'client A owner sees one environment');                             -- 5
select is((select count(*)::int from public.clients), 1,
  'client A owner sees only client A');                               -- 6
select is((select count(*)::int from public.entities), 2,
  'client A owner sees only the two A entities');                     -- 7
select is((select count(*)::int from public.cases), 2,
  'client A owner sees exactly the two A1 cases');                            -- 8
select is((select count(*)::int from public.case_attention_items), 1,
  'client A owner sees only their attention item');                   -- 9
select is((select count(*)::int from public.case_next_actions), 1,
  'client A owner sees only their next action');                      -- 10
select is((select count(*)::int from public.cases
           where id = 'eeeeeeee-0000-4000-8000-0000000000b1'), 0,
  'forged/guessed case id from another client returns zero rows');    -- 11
select is((select count(*)::int from public.cases
           where client_id = 'bbbbbbbb-0000-4000-8000-000000000001'), 0,
  'sweeping another client id returns zero rows');                    -- 12
select throws_ok(
  $$insert into public.memberships (user_id, environment_id, client_id, entity_id, role)
    values (pg_temp.user_id_for('client.owner@example.invalid'),
            '11111111-0000-4000-8000-000000000001',
            'bbbbbbbb-0000-4000-8000-000000000001',
            'bbbbbbbb-1111-4000-8000-000000000001', 'client_user')$$,
  '42501', null, 'a client cannot grant themselves a membership');    -- 13
select throws_ok(
  $$update public.cases set status = 'APPROVED'
    where id = 'eeeeeeee-0000-4000-8000-0000000000a1'$$,
  '42501', null, 'a client cannot mutate workflow state');            -- 14
select throws_ok('select * from public.audit_receipts', '42501', null,
  'a client cannot read audit receipts');                             -- 15
select throws_ok(
  $$insert into public.audit_receipts
      (environment_id, client_id, entity_id, action, object_ref)
    values ('11111111-0000-4000-8000-000000000001',
            'aaaaaaaa-0000-4000-8000-000000000001',
            'aaaaaaaa-1111-4000-8000-000000000001', 'forged', 'x')$$,
  '42501', null, 'a client cannot write audit receipts directly');    -- 16
select throws_ok(
  $$select app_private.append_audit(
      null, '11111111-0000-4000-8000-000000000001',
      'aaaaaaaa-0000-4000-8000-000000000001',
      'aaaaaaaa-1111-4000-8000-000000000001', 'forged', 'x')$$,
  '42501', null, 'a client cannot execute privileged functions');     -- 17
select pg_temp.become_superuser() \gset

-- ---------------------------------------------------------------------------
-- Client B owner: entity-level isolation inside their own client.
-- ---------------------------------------------------------------------------
select pg_temp.impersonate_email('client.second@example.invalid') \gset
select is((select count(*)::int from public.cases), 1,
  'client B owner sees only the B1 case');                            -- 18
select is((select count(*)::int from public.entities), 1,
  'client B owner does not see sibling entity B2');                   -- 19
select is((select count(*)::int from public.cases
           where entity_id = 'bbbbbbbb-2222-4000-8000-000000000002'), 0,
  'wrong-entity query inside the same client returns zero rows');     -- 20
select is((select count(*)::int from public.cases
           where id = 'eeeeeeee-0000-4000-8000-0000000000a1'), 0,
  'client B cannot fetch the A1 case by id');                         -- 21
select pg_temp.become_superuser() \gset

-- ---------------------------------------------------------------------------
-- Staff roles see exactly their memberships; roles add no extra reach.
-- ---------------------------------------------------------------------------
select pg_temp.impersonate_email('intake.beth@example.invalid', 'aal2') \gset
select is((select count(*)::int from public.cases), 4,
  'intake sees the four cases across all four entities');            -- 22
select is((select count(*)::int from public.entities), 4,
  'intake sees all four entities via memberships');                   -- 23
select pg_temp.become_superuser() \gset

select pg_temp.impersonate_email('preparer.pat@example.invalid', 'aal2') \gset
select is((select count(*)::int from public.cases), 3,
  'preparer sees only the A1 and B1 cases');                              -- 24
select pg_temp.become_superuser() \gset

-- ---------------------------------------------------------------------------
-- A valid account with no membership sees nothing.
-- ---------------------------------------------------------------------------
select pg_temp.impersonate_email('nomember.norman@example.invalid') \gset
select is((select count(*)::int from public.memberships), 0,
  'no-membership user has no membership rows');                       -- 25
select is((select count(*)::int from public.cases), 0,
  'no-membership user sees zero cases');                              -- 26
select is((select count(*)::int from public.clients), 0,
  'no-membership user sees zero clients');                            -- 27
select pg_temp.become_superuser() \gset

-- ---------------------------------------------------------------------------
-- service_role (server) still operates: bypassrls and privileged writer.
-- ---------------------------------------------------------------------------
select set_config('role', 'service_role', true) \gset
select is((select count(*)::int from public.cases), 4,
  'service_role sees all rows for server-side work');                 -- 28
select lives_ok(
  $$select app_private.append_audit(
      null, '11111111-0000-4000-8000-000000000001',
      'aaaaaaaa-0000-4000-8000-000000000001',
      'aaaaaaaa-1111-4000-8000-000000000001', 'test.audit', 'case:test')$$,
  'service_role can append audit receipts');                          -- 29
select pg_temp.become_superuser() \gset

select * from finish();
rollback;
