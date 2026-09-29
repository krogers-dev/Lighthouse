-- Milestone 6 (WO-007): release controls — the service kill switch (the
-- public status read, the server-role switch with replay and validation,
-- the restrictive gate on every protected table, the helper refusal every
-- transition goes through, and the preservation of every row and receipt
-- while paused) and the account deletion request lifecycle (request,
-- replay, one open at a time, own-row reads, withdraw, request again,
-- server-role completion, the record outliving the auth user).
--
-- Seeded state this suite relies on: three cases; client.owner holds
-- client_user on A1 and A2; client.second holds client_user on B1;
-- preparer.pat holds preparer on A1; case A1 is EVIDENCE_PENDING at
-- version 1 and request a1 is OPEN at version 1.
begin;
select plan(47);

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

create function pg_temp.become_service_role()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'service_role', true);
end;
$$;

create function pg_temp.set_state(p_state text, p_reason text, p_min text,
                                  p_key uuid default gen_random_uuid())
returns jsonb language sql as $$
  select public.set_service_state(p_state, p_reason, p_min, p_key)
$$;
create function pg_temp.upload(p_key uuid default gen_random_uuid())
returns jsonb language sql as $$
  select public.begin_document_upload(
    '11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
    'aaaaaaaa-1111-4000-8000-000000000001', 'dddddddd-0000-4000-8000-0000000000a1',
    1, p_key, 'paused-check (Synthetic).pdf', 'application/pdf', 1024, repeat('b', 64))
$$;
create function pg_temp.freeze(p_version integer, p_key uuid default gen_random_uuid())
returns jsonb language sql as $$
  select public.freeze_case_package(
    '11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
    'aaaaaaaa-1111-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-0000000000a1',
    p_version, p_key)
$$;
create function pg_temp.audit_count(p_action text)
returns integer language sql security definer as $$
  select count(*)::int from public.audit_receipts where action = p_action
$$;

-- ---------------------------------------------------------------------------
-- Structure and grants
-- ---------------------------------------------------------------------------
select is((select state from public.service_status where id = 1), 'open',
  'the service starts open');                                                -- 1
select is((select min_app_version from public.service_status where id = 1), '0.0.0',
  'with no minimum app version');                                            -- 2
select is((select count(*)::int from public.service_status), 1,
  'and exactly one status row');                                             -- 3
select is((select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('service_status', 'service_status_changes', 'account_deletion_requests')
     and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT'), 0,
  'client roles hold no write on the three tables');                         -- 4
select is((select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and table_name in ('service_status', 'service_status_changes')
     and grantee in ('anon', 'authenticated')), 0,
  'and no direct read of the status or its history');                        -- 5
select ok(has_function_privilege('anon', 'public.service_status_read()', 'execute'),
  'anyone reads the status through the one function');                      -- 6
select is(has_function_privilege('authenticated', 'public.set_service_state(text,text,text,uuid)', 'execute'), false,
  'authenticated cannot flip the switch');                                   -- 7
select is(has_function_privilege('service_role', 'public.set_service_state(text,text,text,uuid)', 'execute'), true,
  'the server role can');                                                    -- 8
select is((select count(*)::int from pg_policies
   where schemaname = 'public' and policyname like '%_service_open' and permissive = 'RESTRICTIVE'), 17,
  'the service gate is a restrictive policy on all seventeen protected tables'); -- 9
select is(has_function_privilege('authenticated', 'public.complete_account_deletion(uuid)', 'execute'), false,
  'authenticated cannot complete a deletion');                               -- 10
select is(has_function_privilege('anon', 'public.request_account_deletion(uuid)', 'execute'), false,
  'anon cannot request one');                                                -- 11

-- ---------------------------------------------------------------------------
-- Pause: zero rows, refused transitions, nothing removed
-- ---------------------------------------------------------------------------
select count(*)::int as cases_before from public.cases \gset
select count(*)::int as receipts_before from public.audit_receipts \gset

select pg_temp.become_anon();
select is((public.service_status_read() ->> 'state'), 'open',
  'anon reads the status: open');                                            -- 12
select pg_temp.impersonate_email('client.owner@example.invalid', 'aal1');
select ok((select count(*) from public.cases) > 0,
  'while open, the client reads the cases of the scope');                    -- 13

select pg_temp.become_service_role();
select gen_random_uuid() as pause_key \gset
select pg_temp.set_state('paused', 'incident', '0.0.0', :'pause_key') as paused \gset
select is(:'paused'::jsonb ->> 'state', 'paused', 'the server role pauses the service');  -- 14
select is((:'paused'::jsonb ->> 'version')::int, 2, 'the status version moved to 2');    -- 15
select is((pg_temp.set_state('paused', 'incident', '0.0.0', :'pause_key') ->> 'replayed')::boolean, true,
  'the same key replays the same change');                                   -- 16
select is((select count(*)::int from public.service_status_changes), 1,
  'and the history holds exactly one change');                               -- 17

select pg_temp.become_anon();
select is((public.service_status_read() ->> 'state'), 'paused',
  'anon reads the status: paused');                                          -- 18
select is((public.service_status_read() ->> 'reason_code'), 'incident',
  'with its reason code');                                                   -- 19
select pg_temp.impersonate_email('client.owner@example.invalid', 'aal1');
select is((select count(*)::int from public.cases), 0,
  'paused: the client reads zero cases');                                    -- 20
select is((select count(*)::int from public.requests), 0,
  'paused: the client reads zero requests');                                 -- 21
select is((select count(*)::int from public.memberships), 0,
  'paused: the client reads zero memberships');                              -- 22
select throws_ok($$select pg_temp.upload()$$, 'P0001', 'service_paused',
  'paused: a client transition is refused before anything else');           -- 23
select pg_temp.impersonate_email('preparer.pat@example.invalid', 'aal2');
select is((select count(*)::int from public.cases), 0,
  'paused: staff at AAL2 read zero cases');                                  -- 24
select throws_ok($$select pg_temp.freeze(1)$$, 'P0001', 'service_paused',
  'paused: a staff transition is refused before anything else');            -- 25
select pg_temp.impersonate_email('client.owner@example.invalid', 'aal1');
select gen_random_uuid() as del_key \gset
select public.request_account_deletion(:'del_key') as requested \gset
select is(:'requested'::jsonb ->> 'status', 'REQUESTED',
  'paused: a deletion request is still possible (outside the gate)');       -- 26
select is((select count(*)::int from public.account_deletion_requests), 1,
  'and the person reads their own request while paused');                   -- 27

select pg_temp.become_superuser();
select is((select count(*)::int from public.cases), :cases_before,
  'nothing was removed: every case row stands');                             -- 28
select ok((select count(*) from public.audit_receipts) >= :receipts_before,
  'and the audit history only grew');                                        -- 29

-- ---------------------------------------------------------------------------
-- Resume and validation
-- ---------------------------------------------------------------------------
select pg_temp.become_service_role();
select is(pg_temp.set_state('open', 'none', '0.0.0') ->> 'state', 'open',
  'the server role resumes the service');                                    -- 30
select throws_ok($$select pg_temp.set_state('closed', 'none', '0.0.0')$$, 'P0001', 'invalid_state',
  'a state is exactly open or paused');                                      -- 31
select throws_ok($$select pg_temp.set_state('open', 'none', '1.0')$$, 'P0001', 'invalid_version',
  'a minimum app version is three numbers');                                 -- 32
select throws_ok($$select pg_temp.set_state('open', 'because', '0.0.0')$$, 'P0001', 'invalid_reason',
  'a reason is one of the enumerated codes');                                -- 33
select pg_temp.impersonate_email('client.owner@example.invalid', 'aal1');
select is((select count(*)::int from public.cases), 2,
  'resumed: the client reads the two cases of the scopes held again');      -- 34

-- ---------------------------------------------------------------------------
-- Deletion request lifecycle
-- ---------------------------------------------------------------------------
select is((public.request_account_deletion(:'del_key') ->> 'replayed')::boolean, true,
  'the same key replays the same request');                                  -- 35
select throws_ok($$select public.request_account_deletion(gen_random_uuid())$$, 'P0001', 'already_requested',
  'one open request at a time');                                             -- 36
select is(pg_temp.audit_count('account.deletion_requested'), 2,
  'one audit receipt per scope held (client.owner holds two)');              -- 37
select pg_temp.impersonate_email('client.second@example.invalid', 'aal1');
select is((select count(*)::int from public.account_deletion_requests), 0,
  'another person reads no request of theirs (zero rows)');                  -- 38
select throws_ok($$select public.withdraw_account_deletion(gen_random_uuid())$$, 'P0001', 'no_open_request',
  'and cannot withdraw one they never made');                                -- 39
select pg_temp.impersonate_email('client.owner@example.invalid', 'aal1');
select gen_random_uuid() as wd_key \gset
select is(public.withdraw_account_deletion(:'wd_key') ->> 'status', 'WITHDRAWN',
  'the person withdraws the open request');                                  -- 40
select is((public.withdraw_account_deletion(:'wd_key') ->> 'replayed')::boolean, true,
  'the same key replays the withdrawal');                                    -- 41
select is(public.request_account_deletion(gen_random_uuid()) ->> 'status', 'REQUESTED',
  'and may ask again');                                                      -- 42

select pg_temp.become_service_role();
select public.complete_account_deletion(pg_temp.user_id_for('client.owner@example.invalid')) as done \gset
select is(:'done'::jsonb ->> 'status', 'COMPLETED', 'the server role completes the open request'); -- 43
select is((:'done'::jsonb ->> 'memberships_removed')::int, 2,
  'and removes both memberships');                                           -- 44
select throws_ok(
  $$select public.complete_account_deletion(pg_temp.user_id_for('client.second@example.invalid'))$$,
  'P0001', 'no_open_request', 'a person with no open request is not completed'); -- 45

select pg_temp.become_superuser();
select count(*)::int as owner_documents_before from public.document_uploads
 where created_by = pg_temp.user_id_for('client.owner@example.invalid') \gset
delete from auth.users where id = pg_temp.user_id_for('client.owner@example.invalid');
select is((select count(*)::int from public.account_deletion_requests
   where subject_ref = 'user:cccccccc-0000-4000-8000-000000000001' and user_id is null
     and status in ('COMPLETED', 'WITHDRAWN')), 2,
  'the requests outlive the auth user as records, with a pseudonymous subject'); -- 46
select is((select count(*)::int from public.document_uploads
   where created_by = 'cccccccc-0000-4000-8000-000000000001'), :owner_documents_before,
  'and the documents the person gave remain, with who gave them, as records'); -- 47

select * from finish();
rollback;
