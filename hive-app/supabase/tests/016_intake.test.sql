-- Intake (WO-013, Milestone 7): staff open a case and ask the client for
-- what is needed. Intake opens a case as a draft, records intake, and
-- opens requests; intake or the preparer opens further requests and
-- closes them; a draft with nothing in it can be discarded. Every step is
-- a reviewed server function under the protected-mutation contract, at
-- AAL2, in the exact scope, with a receipt; the client sees the case and
-- its requests through the same reads as before and can do none of it.
--
-- Seeded state this suite relies on: intake.beth holds intake on A1, A2,
-- B1, B2; preparer.pat holds preparer on A1 and B1; client.owner holds
-- client_user on A1 and A2; entity A2 has no case; case a1 (A1) is
-- EVIDENCE_PENDING at version 1 with the checked document d0c0...a1 and the
-- rejected d0c0...a2; case b1 (B1) is a seeded DRAFT with an attention item.
begin;
-- Explicit: pgTAP lives in the extensions schema on a hosted project.
set local search_path = public, extensions;
select plan(54);

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

-- Scope A2: the empty entity of client A.
create function pg_temp.open_case(p_title text, p_key uuid default gen_random_uuid())
returns jsonb language sql as $$
  select public.open_case(
    '11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
    'aaaaaaaa-2222-4000-8000-000000000002', p_title, p_key)
$$;
create function pg_temp.record_intake(p_case uuid, p_version integer, p_key uuid default gen_random_uuid())
returns jsonb language sql as $$
  select public.record_case_intake(
    '11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
    'aaaaaaaa-2222-4000-8000-000000000002', p_case, p_version, p_key)
$$;
create function pg_temp.discard(p_case uuid, p_version integer, p_key uuid default gen_random_uuid())
returns jsonb language sql as $$
  select public.discard_case_draft(
    '11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
    'aaaaaaaa-2222-4000-8000-000000000002', p_case, p_version, p_key)
$$;
create function pg_temp.open_request(p_case uuid, p_version integer, p_title text, p_detail text,
                                     p_due integer, p_document uuid, p_key uuid default gen_random_uuid())
returns jsonb language sql as $$
  select public.open_request(
    '11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
    'aaaaaaaa-2222-4000-8000-000000000002', p_case, p_version, p_title, p_detail, p_due,
    p_document, p_key)
$$;
create function pg_temp.close_request(p_request uuid, p_version integer, p_key uuid default gen_random_uuid())
returns jsonb language sql as $$
  select public.close_request(
    '11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
    'aaaaaaaa-2222-4000-8000-000000000002', p_request, p_version, p_key)
$$;
create function pg_temp.audit_count(p_action text, p_object text)
returns integer language sql security definer as $$
  select count(*)::int from public.audit_receipts
   where action = p_action and object_ref = p_object
$$;
create function pg_temp.event_count(p_case uuid, p_kind text, p_role text)
returns integer language sql security definer as $$
  select count(*)::int from public.activity_events
   where case_id = p_case and event_kind = p_kind and actor_role = p_role
$$;
create function pg_temp.case_row(p_case uuid)
returns public.cases language sql security definer as $$
  select * from public.cases where id = p_case
$$;
create function pg_temp.request_row(p_request uuid)
returns public.requests language sql security definer as $$
  select * from public.requests where id = p_request
$$;

-- ---------------------------------------------------------------------------
-- Grants and gates
-- ---------------------------------------------------------------------------
select is(has_function_privilege('anon', 'public.open_case(uuid,uuid,uuid,text,uuid)', 'execute'), false,
  'anon cannot open a case');                                                -- 1
select is(has_function_privilege('anon',
  'public.open_request(uuid,uuid,uuid,uuid,integer,text,text,integer,uuid,uuid)', 'execute'), false,
  'anon cannot open a request');                                             -- 2
select is(has_function_privilege('authenticated', 'public.open_case(uuid,uuid,uuid,text,uuid)', 'execute'), true,
  'a signed-in person may call it: the membership decides inside');          -- 3

select pg_temp.impersonate_email('client.owner@example.invalid', 'aal2');
select throws_ok($$select pg_temp.open_case('Books close 2026 (Synthetic)')$$, '42501', null,
  'a client user is refused');                                               -- 4
select pg_temp.impersonate_email('preparer.pat@example.invalid', 'aal2');
select throws_ok($$select pg_temp.open_case('Books close 2026 (Synthetic)')$$, '42501', null,
  'a preparer is refused: only intake opens a case');                        -- 5
select pg_temp.impersonate_email('intake.beth@example.invalid', 'aal1');
select throws_ok($$select pg_temp.open_case('Books close 2026 (Synthetic)')$$, '42501', null,
  'intake at aal1 is refused');                                              -- 6

-- ---------------------------------------------------------------------------
-- Opening a case
-- ---------------------------------------------------------------------------
select pg_temp.impersonate_email('intake.beth@example.invalid', 'aal2');
select gen_random_uuid() as open_key \gset
select pg_temp.open_case('  Books close  2026 (Synthetic) ', :'open_key') as opened \gset
select is(:'opened'::jsonb ->> 'case_status', 'DRAFT', 'intake opens a case as a draft');    -- 7
select is((:'opened'::jsonb ->> 'case_version')::int, 1, 'at version 1');                    -- 8
select (:'opened'::jsonb ->> 'case_id')::uuid as case_id \gset
select is((pg_temp.case_row(:'case_id')).title, 'Books close 2026 (Synthetic)',
  'with its title trimmed and single-spaced');                              -- 9
select is((pg_temp.case_row(:'case_id')).entity_id, 'aaaaaaaa-2222-4000-8000-000000000002',
  'in the exact scope');                                                     -- 10
select is(pg_temp.audit_count('case.opened', 'case:' || :'case_id'), 1,
  'with one receipt');                                                       -- 11
select is(pg_temp.event_count(:'case_id', 'case.intake_recorded', 'intake'), 0,
  'and nothing on the trail yet: a draft is being set up');                  -- 12
select is(pg_temp.open_case('Books close 2026 (Synthetic)', :'open_key') ->> 'case_id', :'case_id'::text,
  'the same key replays the same case');                                     -- 13
select throws_ok($$select pg_temp.open_case('x')$$, 'P0001', 'invalid_title',
  'a one-character title is refused');                                       -- 14
select throws_ok($$select pg_temp.open_case(E'Two\nlines')$$, 'P0001', 'invalid_title',
  'a title with a line break is refused');                                   -- 15
select throws_ok($$select pg_temp.open_case('Books close 2026 (Synthetic)', null)$$,
  'P0001', 'invalid_idempotency_key', 'a missing key is refused');           -- 16

select pg_temp.impersonate_email('client.owner@example.invalid', 'aal1');
select is((select count(*)::int from public.cases where id = :'case_id'), 1,
  'the client of the scope sees the draft, as "being set up"');              -- 17

-- ---------------------------------------------------------------------------
-- Requests need a recorded intake; recording it is a transition
-- ---------------------------------------------------------------------------
select pg_temp.impersonate_email('intake.beth@example.invalid', 'aal2');
select throws_ok(
  format($$select pg_temp.open_request(%L, 1, 'Bank statements (Synthetic)', '', null, null)$$, :'case_id'),
  'P0001', 'case_not_open_for_requests', 'a draft takes no request');        -- 18
select throws_ok(format($$select pg_temp.record_intake(%L, 5)$$, :'case_id'),
  'P0001', 'case_changed', 'a stale version is refused');                    -- 19
select pg_temp.impersonate_email('preparer.pat@example.invalid', 'aal2');
select throws_ok(format($$select pg_temp.record_intake(%L, 1)$$, :'case_id'), '42501', null,
  'a preparer cannot record intake');                                        -- 20
select pg_temp.impersonate_email('intake.beth@example.invalid', 'aal2');
select pg_temp.record_intake(:'case_id', 1) as recorded \gset
select is(:'recorded'::jsonb ->> 'case_status', 'INTAKE_RECORDED', 'intake records the intake'); -- 21
select is((:'recorded'::jsonb ->> 'case_version')::int, 2, 'the version moves');            -- 22
select is(pg_temp.event_count(:'case_id', 'case.intake_recorded', 'intake'), 1,
  'and the trail says so, by role');                                         -- 23
select throws_ok(format($$select pg_temp.record_intake(%L, 2)$$, :'case_id'),
  'P0001', 'case_not_draft', 'it cannot be recorded twice');                 -- 24

-- ---------------------------------------------------------------------------
-- Opening requests
-- ---------------------------------------------------------------------------
select gen_random_uuid() as request_key \gset
select pg_temp.open_request(:'case_id', 2, ' Bank statements for  the year (Synthetic)',
  E'Every month of 2026.\nStatements only, please.', 14, null, :'request_key') as first \gset
select is(:'first'::jsonb ->> 'case_status', 'EVIDENCE_PENDING',
  'the first request moves the case to waiting on documents');               -- 25
select is((:'first'::jsonb ->> 'case_version')::int, 3, 'and the case version with it'); -- 26
select (:'first'::jsonb ->> 'request_id')::uuid as request_id \gset
select is((pg_temp.request_row(:'request_id')).status, 'OPEN', 'the request is open');   -- 27
select is((pg_temp.request_row(:'request_id')).owner_role, 'client_user',
  'owned by the client');                                                    -- 28
select is((pg_temp.request_row(:'request_id')).title, 'Bank statements for the year (Synthetic)',
  'its title trimmed and single-spaced');                                    -- 29
select is((pg_temp.request_row(:'request_id')).detail, E'Every month of 2026.\nStatements only, please.',
  'its detail kept with its line break');                                    -- 30
select is((pg_temp.request_row(:'request_id')).requested_on, current_date,
  'requested today, by the server''s clock');                                -- 31
select is((pg_temp.request_row(:'request_id')).due_on, current_date + 14,
  'due in fourteen days');                                                   -- 32
select is(pg_temp.event_count(:'case_id', 'request.opened', 'intake'), 1,
  'the trail gained "request opened" by intake');                            -- 33
select is(pg_temp.audit_count('request.opened', 'request:' || :'request_id'), 1,
  'with one receipt');                                                       -- 34
select is(pg_temp.open_request(:'case_id', 2, 'Bank statements for the year (Synthetic)', '', 14, null,
  :'request_key') ->> 'request_id', :'request_id'::text,
  'the same key replays the same request even at the old case version');    -- 35

select pg_temp.open_request(:'case_id', 3, 'Vehicle costs (Synthetic)', '', null, null) as second \gset
select is((:'second'::jsonb ->> 'case_version')::int, 3,
  'a second request leaves the case version alone: nothing on the case changed'); -- 36
select is((pg_temp.request_row((:'second'::jsonb ->> 'request_id')::uuid)).due_on, null,
  'and may have no due date');                                               -- 37
select throws_ok(
  format($$select pg_temp.open_request(%L, 3, 'Receipts (Synthetic)', E'bad\x01byte', null, null)$$, :'case_id'),
  'P0001', 'invalid_detail', 'a detail with a control character is refused'); -- 38
select throws_ok(
  format($$select pg_temp.open_request(%L, 3, 'Receipts (Synthetic)', '', 0, null)$$, :'case_id'),
  'P0001', 'invalid_due', 'a due date of zero days is refused');             -- 39
select throws_ok(
  format($$select pg_temp.open_request(%L, 3, 'Receipts (Synthetic)', '', 366, null)$$, :'case_id'),
  'P0001', 'invalid_due', 'and one more than a year out');                   -- 40
select throws_ok(
  format($$select pg_temp.open_request(%L, 3, 'About that statement (Synthetic)', '', null,
    'd0c0d0c0-0000-4000-8000-0000000000a1')$$, :'case_id'),
  'P0001', 'document_not_checked', 'a document of another case cannot be the subject'); -- 41
select is((public.open_request(
    '11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
    'aaaaaaaa-1111-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-0000000000a1', 1,
    'About the July statement (Synthetic)', 'Which account is it for?', 7,
    'd0c0d0c0-0000-4000-8000-0000000000a1', gen_random_uuid()) ->> 'case_status'),
  'EVIDENCE_PENDING', 'a checked document of the case can be the subject of a question'); -- 42
select throws_ok(
  $$select public.open_request(
    '11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
    'aaaaaaaa-1111-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-0000000000a1', 1,
    'About the photo (Synthetic)', '', null, 'd0c0d0c0-0000-4000-8000-0000000000a2', gen_random_uuid())$$,
  'P0001', 'document_not_checked', 'a rejected document cannot be');         -- 43

select pg_temp.impersonate_email('preparer.pat@example.invalid', 'aal2');
select is((public.open_request(
    '11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
    'aaaaaaaa-1111-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-0000000000a1', 1,
    'Payroll summary (Synthetic)', '', 30, null, gen_random_uuid()) ->> 'case_status'),
  'EVIDENCE_PENDING', 'the preparer may open a request too');                -- 44
select is(pg_temp.event_count('eeeeeeee-0000-4000-8000-0000000000a1', 'request.opened', 'preparer'), 1,
  'and the trail names the preparer');                                       -- 45
select pg_temp.impersonate_email('client.owner@example.invalid', 'aal1');
select throws_ok(format($$select pg_temp.open_request(%L, 3, 'Mine (Synthetic)', '', null, null)$$, :'case_id'),
  '42501', null, 'a client user cannot open a request');                     -- 46
select is((select count(*)::int from public.requests where case_id = :'case_id'), 2,
  'but sees the two that were opened for them');                             -- 47

-- ---------------------------------------------------------------------------
-- Closing a request
-- ---------------------------------------------------------------------------
select pg_temp.impersonate_email('intake.beth@example.invalid', 'aal2');
select throws_ok(format($$select pg_temp.close_request(%L, 9)$$, :'request_id'),
  'P0001', 'request_changed', 'a stale request version is refused');        -- 48
select pg_temp.close_request(:'request_id', 1) as closed \gset
select is(:'closed'::jsonb ->> 'request_status', 'CLOSED', 'intake closes a request');    -- 49
select is(pg_temp.event_count(:'case_id', 'request.closed', 'intake'), 1,
  'and the trail says so');                                                  -- 50
select throws_ok(format($$select pg_temp.close_request(%L, 2)$$, :'request_id'),
  'P0001', 'request_not_closable', 'a closed request stays closed');         -- 51

-- ---------------------------------------------------------------------------
-- Discarding a draft
-- ---------------------------------------------------------------------------
select pg_temp.open_case('Opened by mistake (Synthetic)') as mistake \gset
select is((pg_temp.discard((:'mistake'::jsonb ->> 'case_id')::uuid, 1) ->> 'discarded')::boolean, true,
  'a draft with nothing in it can be discarded, and the receipt outlives it'); -- 52
select throws_ok(format($$select pg_temp.discard(%L, 3)$$, :'case_id'),
  'P0001', 'case_not_draft', 'a case past its draft cannot be discarded');   -- 53
select throws_ok(
  $$select public.discard_case_draft('11111111-0000-4000-8000-000000000001',
    'bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-1111-4000-8000-000000000001',
    'eeeeeeee-0000-4000-8000-0000000000b1', 1, gen_random_uuid())$$,
  'P0001', 'case_has_children', 'a draft that already holds something is kept'); -- 54

select * from finish();
rollback;
