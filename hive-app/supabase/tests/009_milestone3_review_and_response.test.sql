-- Milestone 3 (WO-004): request answers — structure, the source link, the
-- draft and submission path with every refusal token, what submission
-- moves and what it leaves alone, idempotency, immutability, and the
-- read matrix (a client sees their draft from anywhere; staff see a
-- submitted answer at AAL2 and never a draft).
--
-- Seeded state this suite relies on: request A1-question (the November
-- balance) is OPEN with one checked document of its own and a source
-- link to the checked statement on the ANSWERED request of the same
-- case; request A1-open is OPEN; no answer exists anywhere.
begin;
-- Explicit: pgTAP lives in the extensions schema on a hosted project.
set local search_path = public, extensions;
select plan(62);

create function pg_temp.user_id_for(p_email text)
returns uuid language sql stable security definer as $$
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

-- A draft on the November question with every argument defaulted to an
-- acceptable value, so each refusal test changes exactly one thing.
create function pg_temp.save_a3(
  p_request_version integer,
  p_body text default 'Yes, the closing balance matches our records (Synthetic).',
  p_cited uuid[] default array['d0c0d0c0-0000-4000-8000-0000000000a4']::uuid[],
  p_answer_version integer default null,
  p_request uuid default 'dddddddd-0000-4000-8000-0000000000a3'
)
returns jsonb language sql as $$
  select public.save_request_answer_draft(
    '11111111-0000-4000-8000-000000000001',
    'aaaaaaaa-0000-4000-8000-000000000001',
    'aaaaaaaa-1111-4000-8000-000000000001',
    p_request, p_request_version, p_body, p_cited, p_answer_version)
$$;

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------
select ok(
  (select relrowsecurity from pg_class where oid = 'public.request_answers'::regclass),
  'request_answers has row level security enabled');                       -- 1
select ok(
  (select relrowsecurity from pg_class where oid = 'public.request_answer_citations'::regclass),
  'request_answer_citations has row level security enabled');              -- 2
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'request_answers' and permissive = 'RESTRICTIVE'), 2,
  'request_answers carries the restrictive staff-AAL2 layer and the service gate');             -- 3
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'request_answer_citations' and permissive = 'RESTRICTIVE'), 2,
  'request_answer_citations carries the restrictive staff-AAL2 layer and the service gate');    -- 4
select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'request_answers'
     and grantee = 'authenticated' and privilege_type <> 'SELECT'), 0,
  'request_answers grants authenticated nothing but SELECT');              -- 5
select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'request_answer_citations'
     and grantee = 'authenticated' and privilege_type <> 'SELECT'), 0,
  'request_answer_citations grants authenticated nothing but SELECT');     -- 6
select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'request_answers' and grantee = 'anon'), 0,
  'request_answers grants anon nothing at all');                           -- 7
select ok(
  (select count(*) from pg_constraint where conname = 'requests_subject_document_fkey') = 1,
  'a request''s source link is a composite foreign key inside its own scope'); -- 8
select is(
  has_function_privilege('anon',
    'public.save_request_answer_draft(uuid,uuid,uuid,uuid,integer,text,uuid[],integer)', 'execute'),
  false, 'anon cannot execute save_request_answer_draft');                 -- 9
select is(
  has_function_privilege('authenticated',
    'public.save_request_answer_draft(uuid,uuid,uuid,uuid,integer,text,uuid[],integer)', 'execute'),
  true, 'authenticated may call save_request_answer_draft (the function decides who)'); -- 10
select is(
  has_function_privilege('anon', 'public.submit_request_answer(uuid,integer,uuid)', 'execute'),
  false, 'anon cannot execute submit_request_answer');                     -- 11

-- ---------------------------------------------------------------------------
-- The source link, seeded: the question is about a document on ANOTHER
-- request of the case, resolved inside the scope.
-- ---------------------------------------------------------------------------
select is(
  (select u.display_name from public.requests r
     join public.document_uploads u on u.id = r.subject_document_id
    where r.id = 'dddddddd-0000-4000-8000-0000000000a3'),
  'statement-2025-11 (Synthetic).pdf',
  'the November question is about the checked November statement');       -- 12
select isnt(
  (select u.request_id from public.requests r
     join public.document_uploads u on u.id = r.subject_document_id
    where r.id = 'dddddddd-0000-4000-8000-0000000000a3'),
  'dddddddd-0000-4000-8000-0000000000a3'::uuid,
  'which sits on a different request of the same case');                    -- 13

select pg_temp.become_superuser() \gset
select version as req3_version from public.requests
 where id = 'dddddddd-0000-4000-8000-0000000000a3' \gset
select version as req1_version from public.requests
 where id = 'dddddddd-0000-4000-8000-0000000000a1' \gset
select status as case_status_before from public.cases
 where id = 'eeeeeeee-0000-4000-8000-0000000000a1' \gset

select pg_temp.impersonate_email('client.owner@example.invalid') \gset
select is(
  (select subject_document_id from public.requests where id = 'dddddddd-0000-4000-8000-0000000000a3'),
  'd0c0d0c0-0000-4000-8000-0000000000a3'::uuid,
  'the client reads the source link on the question');                     -- 14
select is(
  (select count(*)::int from public.document_uploads where id = 'd0c0d0c0-0000-4000-8000-0000000000a3'), 1,
  'and resolves the document it names inside the scope');                  -- 15

-- ---------------------------------------------------------------------------
-- The draft, as the client owner.
-- ---------------------------------------------------------------------------
select pg_temp.become_anon() \gset
select throws_ok('select * from public.request_answers', '42501', null,
  'anonymous cannot read answers');                                        -- 16

select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('client.owner@example.invalid') \gset
select is((select count(*)::int from public.request_answers), 0,
  'no answer exists before the first draft');                              -- 17
select (pg_temp.save_a3(:req3_version) ->> 'answer_id')::uuid as answer_id \gset
select is(
  (select status from public.request_answers where id = :'answer_id'), 'DRAFT',
  'the first save creates a draft');                                       -- 18
select is(
  (select version from public.request_answers where id = :'answer_id'), 1,
  'at version 1');                                                          -- 19
select is(
  (select count(*)::int from public.request_answer_citations where answer_id = :'answer_id'), 1,
  'with its one citation');                                                 -- 20
-- Audit receipts are readable by no client role, so the check runs as the
-- superuser and the client is impersonated again afterwards.
select pg_temp.become_superuser() \gset
select ok(
  (select details ? 'body' = false and (details ->> 'body_length')::int > 0
     from public.audit_receipts
    where object_ref = 'answer:' || :'answer_id' and action = 'answer.draft_saved'),
  'the audit receipt carries the length, never the text');                 -- 21
select pg_temp.impersonate_email('client.owner@example.invalid') \gset

select throws_ok(
  format('select pg_temp.save_a3(%s, %L, null, 5)', :req3_version, 'edited (Synthetic).'),
  'P0001', 'answer_changed', 'a stale answer version is a conflict, never an overwrite'); -- 22
select throws_ok(
  format('select pg_temp.save_a3(%s, %L, null, null)', :req3_version, 'edited (Synthetic).'),
  'P0001', 'answer_changed', 'saving as if no draft existed, when one does, is the same conflict'); -- 23
select is(
  (pg_temp.save_a3(:req3_version, 'Edited: yes, it matches (Synthetic).', null, 1) ->> 'version')::int, 2,
  'a save at the current version updates the draft and bumps it');        -- 24
select is(
  (select body from public.request_answers where id = :'answer_id'),
  'Edited: yes, it matches (Synthetic).',
  'the body is what was saved');                                            -- 25
select is(
  (select count(*)::int from public.request_answer_citations where answer_id = :'answer_id'), 0,
  'and the citations are exactly the new set (none)');                     -- 26

select throws_ok(
  format('select pg_temp.save_a3(%s, %L, array(select gen_random_uuid() from generate_series(1, 21)), 2)',
         :req3_version, 'x'),
  'P0001', 'too_many_citations', 'twenty-one citations are refused');      -- 27
select throws_ok(
  format('select pg_temp.save_a3(%s, %L, array[%L]::uuid[], 2)',
         :req3_version, 'x', 'd0c0d0c0-0000-4000-8000-0000000000a1'),
  'P0001', 'invalid_document', 'a document on another request cannot be cited'); -- 28
select throws_ok(
  format('select pg_temp.save_a3(%s, repeat(%L, 4001), null, 2)', :req3_version, 'x'),
  'P0001', 'answer_too_long', 'the 4,001st character is refused');         -- 29
select throws_ok(
  format('select pg_temp.save_a3(%s, %L, null, 2)', :req3_version, E'bell\x07here'),
  'P0001', 'invalid_text', 'a control character is refused');              -- 30
select lives_ok(
  format('select pg_temp.save_a3(%s, %L, null, 2)', :req3_version, E'two lines\nand a\ttab (Synthetic).'),
  'newlines and tabs are text');                                            -- 31
select throws_ok(
  $$select pg_temp.save_a3(1, 'x', null, null, 'dddddddd-0000-4000-8000-0000000000a2')$$,
  'P0001', 'request_closed', 'an answered request takes no draft');        -- 32
select throws_ok(
  $$select pg_temp.save_a3(1, 'x', null, null, 'dddddddd-0000-4000-8000-0000000000b1')$$,
  'P0001', 'request_not_found', 'a foreign request inside the caller''s own scope is not found'); -- 33
select throws_ok(
  format('select pg_temp.save_a3(%s, %L, null, 3)', :req3_version + 7, 'x'),
  'P0001', 'request_changed', 'a stale request version is a conflict');    -- 34

-- ---------------------------------------------------------------------------
-- Submission: refusals, then the one thing it moves.
-- ---------------------------------------------------------------------------
select throws_ok(
  format('select public.submit_request_answer(%L, 9, gen_random_uuid())', :'answer_id'),
  'P0001', 'answer_changed', 'submitting a stale version is refused');     -- 35
select lives_ok(
  format('select pg_temp.save_a3(%s, %L, null, 3)', :req3_version, '   '),
  'a blank draft can be saved');                                            -- 36
select throws_ok(
  format('select public.submit_request_answer(%L, 4, gen_random_uuid())', :'answer_id'),
  'P0001', 'empty_answer', 'but not submitted');                            -- 37
select lives_ok(
  format('select pg_temp.save_a3(%s, %L, array[%L]::uuid[], 4)',
         :req3_version, 'Final: yes, the balance matches (Synthetic).', 'd0c0d0c0-0000-4000-8000-0000000000a4'),
  'the final draft, citing the question''s own checked document');         -- 38

select is(
  (public.submit_request_answer(:'answer_id', 5, 'aaaa2222-0000-4000-8000-000000000001') ->> 'status'),
  'SUBMITTED', 'an explicit submission settles the answer');               -- 39
select ok(
  (select submitted_at is not null and version = 6 from public.request_answers where id = :'answer_id'),
  'stamped with server time and a bumped version');                        -- 40
select is(
  (select status from public.requests where id = 'dddddddd-0000-4000-8000-0000000000a3'), 'ANSWERED',
  'the request moved to ANSWERED');                                         -- 41
select is(
  (select version from public.requests where id = 'dddddddd-0000-4000-8000-0000000000a3'),
  :req3_version + 1, 'and its version moved with it');                     -- 42
select is(
  (select status from public.cases where id = 'eeeeeeee-0000-4000-8000-0000000000a1'),
  :'case_status_before', 'the case status did not move');                  -- 43
select is(
  (select count(*)::int from public.case_attention_items
    where case_id = 'eeeeeeee-0000-4000-8000-0000000000a1'), 1,
  'no attention item moved');                                               -- 44
select is(
  (select count(*)::int from public.case_next_actions
    where case_id = 'eeeeeeee-0000-4000-8000-0000000000a1'), 1,
  'no next action moved');                                                  -- 45
select is(
  (select count(*)::int from public.activity_events
    where case_id = 'eeeeeeee-0000-4000-8000-0000000000a1'
      and event_kind = 'request.answered' and actor_role = 'client_user'), 2,
  'the trail gained one "request answered" beside the seeded one');       -- 46
select pg_temp.become_superuser() \gset
select ok(
  (select details ? 'body' = false from public.audit_receipts
    where object_ref = 'answer:' || :'answer_id' and action = 'answer.submitted'),
  'the submission receipt carries no text either');                        -- 47
select pg_temp.impersonate_email('client.owner@example.invalid') \gset
select is(
  (public.submit_request_answer(:'answer_id', 5, 'aaaa2222-0000-4000-8000-000000000001') ->> 'status'),
  'SUBMITTED', 'the same submission key replays the same answer');         -- 48
select throws_ok(
  format('select public.submit_request_answer(%L, 6, gen_random_uuid())', :'answer_id'),
  'P0001', 'already_submitted', 'a second submission is refused');         -- 49
select throws_ok(
  format('select pg_temp.save_a3(%s, %L, null, 6)', :req3_version + 1, 'later thoughts'),
  'P0001', 'already_submitted', 'a submitted answer takes no more drafts'); -- 50

-- ---------------------------------------------------------------------------
-- Who reads what: staff at AAL2 see the submitted answer and never a draft.
-- ---------------------------------------------------------------------------
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('client.owner@example.invalid') \gset
select lives_ok(
  format($$select public.save_request_answer_draft(
    '11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
    'aaaaaaaa-1111-4000-8000-000000000001', 'dddddddd-0000-4000-8000-0000000000a1', %s,
    'A draft on the open request (Synthetic).', null, null)$$, :req1_version),
  'a second draft, on the open request, stays a draft');                   -- 51

select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('reviewer.rae@example.invalid', 'aal1') \gset
select is((select count(*)::int from public.request_answers), 0,
  'staff at aal1 sees no answer at all');                                   -- 52
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('reviewer.rae@example.invalid', 'aal2') \gset
select is((select count(*)::int from public.request_answers), 1,
  'staff at aal2 sees exactly the submitted answer, not the draft');       -- 53
select is((select count(*)::int from public.request_answer_citations), 1,
  'and its citation');                                                      -- 54
select throws_ok(
  format('select pg_temp.save_a3(%s, %L, null, null, %L)', :req1_version, 'staff text',
         'dddddddd-0000-4000-8000-0000000000a1'),
  '42501', null, 'staff cannot write a draft even at aal2');               -- 55
select throws_ok(
  format('select public.submit_request_answer(%L, 6, gen_random_uuid())', :'answer_id'),
  '42501', null, 'nor submit someone else''s answer');                     -- 56

select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('mixed.same@example.invalid', 'aal2') \gset
select is((select count(*)::int from public.request_answers), 2,
  'a client user who is also staff sees the draft too, through the client membership'); -- 57
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('client.second@example.invalid') \gset
select is((select count(*)::int from public.request_answers), 0,
  'another client sees nothing');                                           -- 58

-- ---------------------------------------------------------------------------
-- Immutability, at the table.
-- ---------------------------------------------------------------------------
select pg_temp.become_superuser() \gset
select throws_ok(
  format($$update public.request_answers set body = 'rewritten' where id = %L$$, :'answer_id'),
  'P0001', 'a submitted answer is immutable', 'a submitted answer cannot be edited by anyone'); -- 59
select throws_ok(
  format($$delete from public.request_answer_citations where answer_id = %L$$, :'answer_id'),
  'P0001', 'citations of a submitted answer are immutable', 'nor its citations removed'); -- 60

-- The local lanes' reset (scripts/lib/answer-reset.mjs) removes a settled
-- answer with the table owner's authority; its citations go with it.
select pg_temp.become_superuser() \gset
select lives_ok(
  format('delete from public.request_answers where id = %L', :'answer_id'),
  'the table owner can remove a submitted answer (the synthetic lanes'' reset)'); -- 61
select is(
  (select count(*)::int from public.request_answer_citations where answer_id = :'answer_id'), 0,
  'and its citations cascade with it');                                    -- 62

select * from finish();
rollback;
