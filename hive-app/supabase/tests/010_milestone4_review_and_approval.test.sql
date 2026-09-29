-- Milestone 4 (WO-005): internal review and approval — structure, grants,
-- the read matrix (staff of the scope at AAL2, nobody else), the frozen
-- package and its digest, every transition with every refusal, conflicts
-- of interest, idempotent replay, what each step moves, immutability, and
-- the expiry sweep.
--
-- Seeded state this suite relies on: case A1 ("2025 books close") is
-- EVIDENCE_PENDING at version 1 with three requests and three checked
-- documents; preparer.pat, reviewer.rae, approver.avery, and intake.beth
-- hold their roles on A1; mixed.same holds client_user and reviewer on
-- A1; mixed.cross holds client_user on A1 and preparer on B1.
begin;
-- Explicit: pgTAP lives in the extensions schema on a hosted project.
set local search_path = public, extensions;
select plan(90);

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

-- The A1 scope and case, restated literally.
create function pg_temp.freeze(p_version integer, p_key uuid default gen_random_uuid())
returns jsonb language sql as $$
  select public.freeze_case_package(
    '11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
    'aaaaaaaa-1111-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-0000000000a1',
    p_version, p_key)
$$;
create function pg_temp.start_review(p_version integer, p_key uuid default gen_random_uuid())
returns jsonb language sql as $$
  select public.start_case_review(
    '11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
    'aaaaaaaa-1111-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-0000000000a1',
    p_version, p_key)
$$;
create function pg_temp.verdict(p_version integer, p_verdict text, p_note text default '',
                                p_key uuid default gen_random_uuid())
returns jsonb language sql as $$
  select public.record_case_verdict(
    '11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
    'aaaaaaaa-1111-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-0000000000a1',
    p_version, p_verdict, p_note, p_key)
$$;
create function pg_temp.resume(p_version integer, p_key uuid default gen_random_uuid())
returns jsonb language sql as $$
  select public.resume_case(
    '11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
    'aaaaaaaa-1111-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-0000000000a1',
    p_version, p_key)
$$;
create function pg_temp.approve(p_version integer, p_package uuid, p_digest text,
                                p_destination text default 'hive-record',
                                p_key uuid default gen_random_uuid())
returns jsonb language sql as $$
  select public.approve_case_package(
    '11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
    'aaaaaaaa-1111-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-0000000000a1',
    p_version, p_package, p_digest, p_destination, p_key)
$$;
create function pg_temp.case_status()
returns text language sql as $$
  select status from public.cases where id = 'eeeeeeee-0000-4000-8000-0000000000a1'
$$;
create function pg_temp.case_version()
returns integer language sql as $$
  select version from public.cases where id = 'eeeeeeee-0000-4000-8000-0000000000a1'
$$;
create function pg_temp.current_package()
returns public.case_review_packages language sql as $$
  select * from public.case_review_packages
   where case_id = 'eeeeeeee-0000-4000-8000-0000000000a1' and superseded_at is null
$$;
create function pg_temp.trail_count(p_kind text)
returns integer language sql as $$
  select count(*)::int from public.activity_events
   where case_id = 'eeeeeeee-0000-4000-8000-0000000000a1' and event_kind = p_kind
$$;

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.case_review_packages'::regclass),
  'case_review_packages has row level security enabled');                  -- 1
select ok((select relrowsecurity from pg_class where oid = 'public.case_reviews'::regclass),
  'case_reviews has row level security enabled');                          -- 2
select ok((select relrowsecurity from pg_class where oid = 'public.case_approvals'::regclass),
  'case_approvals has row level security enabled');                        -- 3
select is((select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'case_review_packages' and permissive = 'RESTRICTIVE'), 2,
  'case_review_packages carries the restrictive staff-AAL2 layer and the service gate');        -- 4
select is((select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'case_reviews' and permissive = 'RESTRICTIVE'), 2,
  'case_reviews carries the restrictive staff-AAL2 layer and the service gate');                -- 5
select is((select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'case_approvals' and permissive = 'RESTRICTIVE'), 2,
  'case_approvals carries the restrictive staff-AAL2 layer and the service gate');              -- 6
select is((select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('case_review_packages', 'case_reviews', 'case_approvals')
     and grantee = 'authenticated' and privilege_type <> 'SELECT'), 0,
  'the three tables grant authenticated nothing but SELECT');              -- 7
select is((select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('case_review_packages', 'case_reviews', 'case_approvals')
     and grantee = 'anon'), 0,
  'and anon nothing at all');                                              -- 8
select is((select column_default from information_schema.columns
   where table_schema = 'public' and table_name = 'cases' and column_name = 'version'), '1',
  'cases carry an object version from 1');                                 -- 9
select ok((select pg_get_constraintdef(oid) from pg_constraint
   where conname = 'activity_events_event_kind_check') like '%case.approved%',
  'the activity vocabulary names the case workflow kinds');                -- 10
select is(has_function_privilege('anon',
  'public.freeze_case_package(uuid,uuid,uuid,uuid,integer,uuid)', 'execute'), false,
  'anon cannot execute freeze_case_package');                              -- 11
select is(has_function_privilege('authenticated',
  'public.approve_case_package(uuid,uuid,uuid,uuid,integer,uuid,text,text,uuid)', 'execute'), true,
  'authenticated may call approve_case_package (the function decides who)'); -- 12
select is(has_function_privilege('authenticated', 'public.expire_case_approvals()', 'execute'), false,
  'the expiry sweep is not callable by authenticated');                    -- 13
select is(has_function_privilege('service_role', 'public.expire_case_approvals()', 'execute'), true,
  'the expiry sweep is callable by the server role');                      -- 14

-- ---------------------------------------------------------------------------
-- Freezing: who may, at what version, and what it records.
-- ---------------------------------------------------------------------------
select pg_temp.become_superuser() \gset
select is(pg_temp.case_status(), 'EVIDENCE_PENDING', 'case A1 starts EVIDENCE_PENDING'); -- 15
select is(pg_temp.case_version(), 1, 'at version 1');                       -- 16

select pg_temp.impersonate_email('preparer.pat@example.invalid', 'aal1') \gset
select throws_ok('select pg_temp.freeze(1)', '42501', null,
  'a preparer at AAL1 cannot freeze');                                     -- 17
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('client.owner@example.invalid', 'aal1') \gset
select throws_ok('select pg_temp.freeze(1)', '42501', null,
  'a client user cannot freeze');                                          -- 18
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('intake.beth@example.invalid') \gset
select throws_ok('select pg_temp.freeze(1)', '42501', null,
  'intake cannot freeze (no accounting decision, no submission for review)'); -- 19
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('preparer.pat@example.invalid') \gset
select throws_ok('select pg_temp.freeze(99)', 'P0001', 'case_changed',
  'a stale case version is a conflict');                                   -- 20
select throws_ok(
  $$select public.freeze_case_package('11111111-0000-4000-8000-000000000001',
    'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-1111-4000-8000-000000000001',
    'eeeeeeee-0000-4000-8000-0000000000b1', 1, gen_random_uuid())$$,
  'P0001', 'case_not_found', 'a case outside the named scope is not found inside it'); -- 21

select gen_random_uuid() as freeze_key \gset
select pg_temp.freeze(1, :'freeze_key') as frozen \gset
select is((:'frozen'::jsonb ->> 'package_number')::int, 1, 'the first package is number 1'); -- 22
select is(:'frozen'::jsonb ->> 'case_status', 'READY_FOR_REVIEW', 'and the case is READY_FOR_REVIEW'); -- 23
select is(pg_temp.case_version(), 2, 'the case version moved with it');    -- 24
select matches(:'frozen'::jsonb ->> 'manifest_digest', '^[0-9a-f]{64}$',
  'the package carries a SHA-256 digest');                                 -- 25
select is(jsonb_array_length((pg_temp.current_package()).manifest -> 'requests'), 3,
  'the manifest names the case''s three requests');                        -- 26
select is(jsonb_array_length((pg_temp.current_package()).manifest -> 'documents'), 3,
  'and its three checked documents, never the refused one');               -- 27
select is(jsonb_array_length((pg_temp.current_package()).manifest -> 'answers'), 0,
  'and no answer, since none is submitted');                               -- 28
select ok((pg_temp.current_package()).manifest::text !~ 'Synthetic',
  'the manifest carries ids and digests, no names or text');               -- 29
select is(pg_temp.freeze(1, :'freeze_key') ->> 'package_id', :'frozen'::jsonb ->> 'package_id',
  'the same key replays the same package');                                -- 30
select throws_ok('select pg_temp.freeze(2)', 'P0001', 'case_not_freezable',
  'a case already sent for review is not frozen again');                   -- 31
select is(pg_temp.trail_count('case.package_frozen'), 1,
  'the trail gained "sent for review"');                                   -- 32
select pg_temp.become_superuser() \gset
select is(app_private.manifest_digest(app_private.build_case_manifest('eeeeeeee-0000-4000-8000-0000000000a1')),
  (pg_temp.current_package()).manifest_digest,
  'the digest is reproducible from the evidence as it stands');            -- 33
select is((select count(*)::int from public.audit_receipts
   where object_ref = 'case:eeeeeeee-0000-4000-8000-0000000000a1'
     and action = 'case.package_frozen' and details ? 'result'), 1,
  'the audit receipt records the freeze with its result');                 -- 34

-- ---------------------------------------------------------------------------
-- The read matrix on the package.
-- ---------------------------------------------------------------------------
select pg_temp.impersonate_email('preparer.pat@example.invalid') \gset
select is((select count(*)::int from public.case_review_packages), 1,
  'the preparer at AAL2 reads the package');                               -- 35
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('preparer.pat@example.invalid', 'aal1') \gset
select is((select count(*)::int from public.case_review_packages), 0,
  'the same preparer at AAL1 reads nothing');                              -- 36
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('client.owner@example.invalid', 'aal1') \gset
select is((select count(*)::int from public.case_review_packages), 0,
  'a client user reads no package');                                       -- 37
select is(pg_temp.case_status(), 'READY_FOR_REVIEW',
  'but sees the case status the workflow moved');                          -- 38
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('mixed.same@example.invalid') \gset
select is((select count(*)::int from public.case_review_packages), 1,
  'a client user who is also the scope''s reviewer reads it at AAL2');     -- 39
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('mixed.cross@example.invalid') \gset
select is((select count(*)::int from public.case_review_packages), 0,
  'staff elsewhere, a client here: nothing in this scope');                -- 40
select pg_temp.become_anon() \gset
select throws_ok('select * from public.case_review_packages', '42501', null,
  'anonymous cannot read packages');                                       -- 41

-- ---------------------------------------------------------------------------
-- Review: who, conflicts, versions, verdicts.
-- ---------------------------------------------------------------------------
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('preparer.pat@example.invalid') \gset
select throws_ok('select pg_temp.start_review(2)', '42501', null,
  'a preparer holds no reviewer membership');                              -- 42
-- A preparer who ALSO held the reviewer role would be conflicted on the
-- package they froze: prove it with a temporary membership.
select pg_temp.become_superuser() \gset
insert into public.memberships (user_id, environment_id, client_id, entity_id, role)
values (pg_temp.user_id_for('preparer.pat@example.invalid'),
        '11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
        'aaaaaaaa-1111-4000-8000-000000000001', 'reviewer');
select pg_temp.impersonate_email('preparer.pat@example.invalid') \gset
select throws_ok('select pg_temp.start_review(2)', 'P0001', 'conflict_of_interest',
  'the person who froze the package does not review it');                  -- 43
select pg_temp.become_superuser() \gset
delete from public.memberships
 where user_id = pg_temp.user_id_for('preparer.pat@example.invalid') and role = 'reviewer';

select pg_temp.impersonate_email('reviewer.rae@example.invalid') \gset
select throws_ok('select pg_temp.start_review(1)', 'P0001', 'case_changed',
  'a stale version does not start a review');                              -- 44
select gen_random_uuid() as start_key \gset
select pg_temp.start_review(2, :'start_key') as started \gset
select is(:'started'::jsonb ->> 'case_status', 'IN_REVIEW', 'the review starts');   -- 45
select is(pg_temp.start_review(2, :'start_key') ->> 'review_id', :'started'::jsonb ->> 'review_id',
  'the same key replays the same review');                                 -- 46
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('mixed.same@example.invalid') \gset
select throws_ok('select pg_temp.start_review(3)', 'P0001', 'case_not_reviewable',
  'a second reviewer cannot start a review already under way');            -- 47
select throws_ok($$select pg_temp.verdict(3, 'PASS')$$, 'P0001', 'not_your_review',
  'nor record a verdict on someone else''s review');                       -- 48
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('approver.avery@example.invalid') \gset
select throws_ok($$select pg_temp.verdict(3, 'RETURN')$$, '42501', null,
  'an approver is not the reviewer while the case is in review');          -- 49
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('reviewer.rae@example.invalid') \gset
select throws_ok($$select pg_temp.verdict(3, 'MAYBE')$$, 'P0001', 'invalid_verdict',
  'a verdict is exactly PASS, RETURN, or HOLD');                           -- 50
select throws_ok(format($$select pg_temp.verdict(3, 'RETURN', %L)$$, repeat('x', 2001)),
  'P0001', 'note_too_long', 'the 2,001st character of a note is refused');  -- 51
select throws_ok($$select pg_temp.verdict(3, 'RETURN', E'bad\x01note')$$,
  'P0001', 'invalid_text', 'a control character in a note is refused');    -- 52
select pg_temp.verdict(3, 'RETURN', 'The July statement is missing its last page (Synthetic).') as returned \gset
select is(:'returned'::jsonb ->> 'case_status', 'RETURNED', 'RETURN sends the case back'); -- 53
select is((select note from public.case_reviews where id = (:'returned'::jsonb ->> 'review_id')::uuid),
  'The July statement is missing its last page (Synthetic).',
  'with the note on the staff-only review row');                           -- 54
select is(pg_temp.trail_count('case.returned'), 1, 'and "returned for changes" in the trail'); -- 55
select pg_temp.become_superuser() \gset
select ok((select details ? 'note' = false and (details ->> 'note_length')::int > 0
   from public.audit_receipts
   where object_ref = 'case:eeeeeeee-0000-4000-8000-0000000000a1' and action = 'case.verdict_recorded'),
  'the audit receipt carries the note''s length, never the note');         -- 56

-- ---------------------------------------------------------------------------
-- Resume, a second package, PASS, and approval.
-- ---------------------------------------------------------------------------
select pg_temp.impersonate_email('reviewer.rae@example.invalid') \gset
select throws_ok('select pg_temp.resume(4)', '42501', null,
  'a reviewer does not resume work on the case');                          -- 57
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('preparer.pat@example.invalid') \gset
select is(pg_temp.resume(4) ->> 'case_status', 'EVIDENCE_PENDING',
  'the preparer resumes a returned case');                                 -- 58
select pg_temp.freeze(5) as frozen2 \gset
select is((:'frozen2'::jsonb ->> 'package_number')::int, 2, 'the next package is number 2'); -- 59
select is((select count(*)::int from public.case_review_packages
   where case_id = 'eeeeeeee-0000-4000-8000-0000000000a1' and superseded_at is not null), 1,
  'and package 1 is superseded');                                          -- 60
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('reviewer.rae@example.invalid') \gset
select is(pg_temp.start_review(6) ->> 'case_status', 'IN_REVIEW', 'package 2 goes into review'); -- 61
select is(pg_temp.verdict(7, 'PASS') ->> 'case_status', 'APPROVAL_PENDING',
  'PASS moves the case to APPROVAL_PENDING');                              -- 62
select pg_temp.become_superuser() \gset
select (pg_temp.current_package()).id as package2 \gset
select (pg_temp.current_package()).manifest_digest as digest2 \gset

select pg_temp.impersonate_email('reviewer.rae@example.invalid') \gset
select throws_ok(format($$select pg_temp.approve(8, %L, %L)$$, :'package2', :'digest2'),
  '42501', null, 'a reviewer holds no approver membership');               -- 63
-- A reviewer who ALSO held the approver role would be conflicted on the
-- package they reviewed.
select pg_temp.become_superuser() \gset
insert into public.memberships (user_id, environment_id, client_id, entity_id, role)
values (pg_temp.user_id_for('reviewer.rae@example.invalid'),
        '11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
        'aaaaaaaa-1111-4000-8000-000000000001', 'approver');
select pg_temp.impersonate_email('reviewer.rae@example.invalid') \gset
select throws_ok(format($$select pg_temp.approve(8, %L, %L)$$, :'package2', :'digest2'),
  'P0001', 'conflict_of_interest', 'the reviewer of a package does not approve it'); -- 64
select pg_temp.become_superuser() \gset
delete from public.memberships
 where user_id = pg_temp.user_id_for('reviewer.rae@example.invalid') and role = 'approver';

select pg_temp.impersonate_email('approver.avery@example.invalid') \gset
select throws_ok(format($$select pg_temp.approve(8, %L, %L)$$, gen_random_uuid(), :'digest2'),
  'P0001', 'package_changed', 'an approval names the current package');   -- 65
select throws_ok(format($$select pg_temp.approve(8, %L, %L)$$, :'package2', repeat('0', 64)),
  'P0001', 'digest_mismatch', 'and its exact digest');                     -- 66
select throws_ok(format($$select pg_temp.approve(8, %L, %L, 'drive-filing')$$, :'package2', :'digest2'),
  'P0001', 'invalid_destination', 'and only the HIVE record as destination'); -- 67
select throws_ok(format($$select pg_temp.approve(7, %L, %L)$$, :'package2', :'digest2'),
  'P0001', 'case_changed', 'and the case version the screen read');        -- 68
select gen_random_uuid() as approve_key \gset
select pg_temp.approve(8, :'package2', :'digest2', 'hive-record', :'approve_key') as approved \gset
select is(:'approved'::jsonb ->> 'case_status', 'APPROVED', 'the approval settles the case'); -- 69
select ok((:'approved'::jsonb ->> 'expires_at')::timestamptz
  between now() + interval '29 days' and now() + interval '31 days',
  'and expires in 30 days');                                               -- 70
select is((select package_number from public.case_approvals
   where id = (:'approved'::jsonb ->> 'approval_id')::uuid), 2,
  'bound to package 2');                                                   -- 71
select is((select package_digest from public.case_approvals
   where id = (:'approved'::jsonb ->> 'approval_id')::uuid), :'digest2',
  'and to its digest');                                                    -- 72
select is(pg_temp.approve(8, :'package2', :'digest2', 'hive-record', :'approve_key') ->> 'approval_id',
  :'approved'::jsonb ->> 'approval_id', 'the same key replays the same approval'); -- 73
select throws_ok(format($$select pg_temp.approve(9, %L, %L)$$, :'package2', :'digest2'),
  'P0001', 'case_not_approvable', 'an approved case is not approved twice'); -- 74
select is(pg_temp.trail_count('case.approved'), 1, 'the trail gained "approved"'); -- 75
select pg_temp.become_superuser() \gset
select is((select count(*)::int from public.case_attention_items
   where case_id = 'eeeeeeee-0000-4000-8000-0000000000a1'), 1,
  'no attention item was authored or removed');                            -- 76

-- ---------------------------------------------------------------------------
-- Material change: reopening supersedes the approval; an approver's HOLD;
-- lifting a hold.
-- ---------------------------------------------------------------------------
select pg_temp.impersonate_email('preparer.pat@example.invalid') \gset
select is(pg_temp.resume(9) ->> 'case_status', 'EVIDENCE_PENDING',
  'the preparer reopens an approved case for material change');            -- 77
select pg_temp.become_superuser() \gset
select is((select status || ':' || end_reason from public.case_approvals
   where id = (:'approved'::jsonb ->> 'approval_id')::uuid), 'SUPERSEDED:case_reopened',
  'and the approval ended as reopened');                                   -- 78
select pg_temp.impersonate_email('preparer.pat@example.invalid') \gset
select pg_temp.freeze(10) as frozen3 \gset
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('reviewer.rae@example.invalid') \gset
select pg_temp.start_review(11) as started3 \gset
select pg_temp.verdict(12, 'PASS') as passed3 \gset
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('approver.avery@example.invalid') \gset
select throws_ok($$select pg_temp.verdict(13, 'PASS')$$, 'P0001', 'invalid_verdict',
  'an approver''s PASS is an approval, not a verdict');                    -- 79
select is(pg_temp.verdict(13, 'HOLD', 'Authority question open (Synthetic).') ->> 'case_status', 'HOLD',
  'an approver puts a passed package on HOLD');                            -- 80
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('preparer.pat@example.invalid') \gset
select throws_ok('select pg_temp.resume(14)', '42501', null,
  'a preparer does not lift a hold');                                      -- 81
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('approver.avery@example.invalid') \gset
select is(pg_temp.resume(14) ->> 'case_status', 'EVIDENCE_PENDING', 'an approver lifts it'); -- 82

-- ---------------------------------------------------------------------------
-- Immutability, for every role including the owner.
-- ---------------------------------------------------------------------------
select pg_temp.become_superuser() \gset
select throws_ok(
  format($$update public.case_review_packages set manifest = '{}'::jsonb where id = %L$$,
         :'frozen3'::jsonb ->> 'package_id'),
  'P0001', 'a frozen package is immutable', 'a frozen package cannot be edited by anyone'); -- 83
select throws_ok(
  format($$update public.case_reviews set verdict = 'PASS' where id = %L$$,
         :'returned'::jsonb ->> 'review_id'),
  'P0001', 'a recorded verdict is immutable', 'nor a recorded verdict');   -- 84
select throws_ok(
  format($$update public.case_approvals set status = 'ACTIVE', ended_at = null, end_reason = null where id = %L$$,
         :'approved'::jsonb ->> 'approval_id'),
  'P0001', 'an ended approval is immutable', 'nor an ended approval');     -- 85

-- ---------------------------------------------------------------------------
-- Expiry: an approval past its date ends, and the case asks again.
-- ---------------------------------------------------------------------------
select pg_temp.impersonate_email('preparer.pat@example.invalid') \gset
select pg_temp.freeze(15) as frozen4 \gset
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('reviewer.rae@example.invalid') \gset
select pg_temp.start_review(16) as started4 \gset
select pg_temp.verdict(17, 'PASS') as passed4 \gset
select pg_temp.become_superuser() \gset
select (pg_temp.current_package()).id as package4 \gset
select (pg_temp.current_package()).manifest_digest as digest4 \gset
select pg_temp.impersonate_email('approver.avery@example.invalid') \gset
select pg_temp.approve(18, :'package4', :'digest4') as approved4 \gset
select pg_temp.become_superuser() \gset
-- The binding is immutable, so the clock is moved with the owner's
-- authority, trigger aside, exactly as a real 30 days would move it.
alter table public.case_approvals disable trigger case_approvals_lifecycle;
update public.case_approvals
   set approved_at = now() - interval '31 days', expires_at = now() - interval '1 minute'
 where id = (:'approved4'::jsonb ->> 'approval_id')::uuid;
alter table public.case_approvals enable trigger case_approvals_lifecycle;
select pg_temp.become_service_role() \gset
select is(public.expire_case_approvals(), 1, 'the sweep expires one approval'); -- 86
select pg_temp.become_superuser() \gset
select is((select status || ':' || end_reason from public.case_approvals
   where id = (:'approved4'::jsonb ->> 'approval_id')::uuid), 'EXPIRED:expired',
  'which ended as expired');                                               -- 87
select is(pg_temp.case_status(), 'APPROVAL_PENDING', 'and the case asks for approval again'); -- 88
select is(pg_temp.trail_count('case.approval_expired'), 1, 'told through the trail by HIVE'); -- 89
select pg_temp.impersonate_email('client.owner@example.invalid', 'aal1') \gset
select is((select count(*)::int from public.case_reviews) + (select count(*)::int from public.case_approvals), 0,
  'a client user still reads no review and no approval');                 -- 90

select * from finish();
rollback;
