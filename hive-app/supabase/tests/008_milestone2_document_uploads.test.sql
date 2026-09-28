-- Milestone 2 (WO-003): document uploads — structure, the denial matrix,
-- the client transitions, the quarantine bucket policy, the privileged
-- scan interface, the expiry sweep, and the lifecycle trigger.
--
-- Seeded state this suite relies on (scripts/lib/synthetic-documents.mjs):
-- request A1-open carries one ACCEPTED and one REJECTED document, request
-- A1-answered one ACCEPTED, request B1-open one ACCEPTED. No seeded row is
-- in quarantine, so the transfers below are the suite's own.
begin;
select plan(84);

-- Definer rights: the suite resolves ids while impersonating client roles,
-- which hold no grant on auth.users.
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

create function pg_temp.become_service_role()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'service_role', true);
end;
$$;

-- A reservation on the A1 open request, with every argument defaulted to
-- an acceptable value so each refusal test changes exactly one thing.
create function pg_temp.begin_a1(
  p_key uuid,
  p_version integer default 1,
  p_mime text default 'application/pdf',
  p_size bigint default 1234,
  p_name text default 'statement (Synthetic).pdf',
  p_digest text default repeat('ab', 32),
  p_request uuid default 'dddddddd-0000-4000-8000-0000000000a1'
)
returns jsonb language sql as $$
  select public.begin_document_upload(
    '11111111-0000-4000-8000-000000000001',
    'aaaaaaaa-0000-4000-8000-000000000001',
    'aaaaaaaa-1111-4000-8000-000000000001',
    p_request, p_version, p_key, p_name, p_mime, p_size, p_digest)
$$;

-- Attempt a DELETE as the current (client) role, swallowing the storage
-- service's guard so the transaction survives; the caller asserts the
-- object is still there afterwards.
create function pg_temp.try_client_delete(p_path text)
returns text language plpgsql as $$
begin
  delete from storage.objects where bucket_id = 'hive-quarantine' and name = p_path;
  return 'no rows targeted';
exception when others then
  return 'refused: ' || sqlstate;
end;
$$;

create function pg_temp.begin_many(p_count integer)
returns integer language plpgsql as $$
declare i integer;
begin
  for i in 1..p_count loop
    perform pg_temp.begin_a1(gen_random_uuid(), 1, 'application/pdf', 100,
      'filler ' || i || ' (Synthetic).pdf');
  end loop;
  return p_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Structure: the table is held to the Milestone 0/1 shape; the bucket is
-- private and bounded; the scan interface is out of every client's reach.
-- ---------------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.document_uploads'::regclass),
  'document_uploads has row level security enabled');                       -- 1
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'document_uploads' and permissive = 'RESTRICTIVE'), 1,
  'document_uploads carries the restrictive staff-AAL2 layer');             -- 2
select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'document_uploads'
     and grantee = 'authenticated' and privilege_type <> 'SELECT'), 0,
  'document_uploads grants authenticated nothing but SELECT');              -- 3
select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'document_uploads' and grantee = 'anon'), 0,
  'document_uploads grants anon nothing at all');                           -- 4
select ok(
  (select count(*) from pg_indexes where schemaname = 'public'
    and tablename = 'document_uploads'
    and indexdef like '%environment_id, client_id, entity_id%') > 0,
  'document_uploads policy columns are indexed');                           -- 5
select is(
  (select public from storage.buckets where id = 'hive-quarantine'), false,
  'the quarantine bucket is private');                                      -- 6
select is(
  (select file_size_limit from storage.buckets where id = 'hive-quarantine'), 20971520::bigint,
  'the quarantine bucket refuses anything over 20 MB at the storage service too'); -- 7
select is(
  (select allowed_mime_types from storage.buckets where id = 'hive-quarantine'),
  array['application/pdf', 'image/png', 'image/jpeg', 'text/csv'],
  'the quarantine bucket accepts exactly the four approved types');         -- 8
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname like 'hive_%'), 1,
  'exactly one HIVE policy exists on storage.objects');                     -- 9
select is(
  (select cmd from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname like 'hive_%'), 'INSERT',
  'and it is an INSERT policy: no client can read back, list, overwrite, or delete'); -- 10
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and cmd in ('SELECT', 'UPDATE', 'DELETE', 'ALL')), 0,
  'storage.objects has no client-facing read, update, or delete policy anywhere'); -- 11
select is(
  has_function_privilege('anon',
    'public.begin_document_upload(uuid,uuid,uuid,uuid,integer,uuid,text,text,bigint,text)', 'execute'),
  false, 'anon cannot execute begin_document_upload');                      -- 12
select is(
  has_function_privilege('authenticated',
    'public.begin_document_upload(uuid,uuid,uuid,uuid,integer,uuid,text,text,bigint,text)', 'execute'),
  true, 'authenticated may call begin_document_upload (the function decides who)'); -- 13
select is(
  has_function_privilege('authenticated', 'public.begin_document_scan(uuid)', 'execute'),
  false, 'authenticated cannot execute begin_document_scan');               -- 14
select is(
  has_function_privilege('authenticated', 'public.record_document_scan(uuid,text,text)', 'execute'),
  false, 'authenticated cannot execute record_document_scan');              -- 15
select is(
  has_function_privilege('authenticated', 'public.expire_stale_document_uploads()', 'execute'),
  false, 'authenticated cannot execute the expiry sweep');                  -- 16
select is(
  has_function_privilege('service_role', 'public.record_document_scan(uuid,text,text)', 'execute'),
  true, 'the server role may record a scan verdict');                       -- 17

-- ---------------------------------------------------------------------------
-- The read surface: the same denial matrix as requests (threat T1).
-- ---------------------------------------------------------------------------
select pg_temp.become_anon() \gset
select throws_ok('select * from public.document_uploads', '42501', null,
  'anonymous cannot read document uploads');                                -- 18

select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('client.owner@example.invalid') \gset
select is((select count(*)::int from public.document_uploads), 3,
  'client A owner sees exactly the three documents in their scope');       -- 19
select is(
  (select count(*)::int from public.document_uploads
   where id = 'd0c0d0c0-0000-4000-8000-0000000000b1'), 0,
  'a guessed foreign document id returns zero rows, not an existence signal'); -- 20
select is(
  (select count(*)::int from public.document_uploads
   where client_id = 'bbbbbbbb-0000-4000-8000-000000000001'), 0,
  'sweeping another client id returns zero documents');                     -- 21
select throws_ok(
  $$insert into public.document_uploads
      (environment_id, client_id, entity_id, case_id, request_id, created_by, idempotency_key,
       display_name, mime_type, byte_size, client_digest, storage_path, expires_at)
    values ('11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
            'aaaaaaaa-1111-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-0000000000a1',
            'dddddddd-0000-4000-8000-0000000000a1', 'cccccccc-0000-4000-8000-000000000001',
            gen_random_uuid(), 'forged (Synthetic).pdf', 'application/pdf', 1,
            repeat('ab', 32), 'forged/path', now())$$,
  '42501', null, 'a client user cannot insert a document row directly');    -- 22
select throws_ok(
  $$update public.document_uploads set status = 'ACCEPTED'$$,
  '42501', null, 'a client user cannot update a document row directly');    -- 23
select throws_ok(
  $$delete from public.document_uploads$$,
  '42501', null, 'a client user cannot delete a document row');             -- 24

select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('nomember.norman@example.invalid') \gset
select is((select count(*)::int from public.document_uploads), 0,
  'a user with no membership sees zero documents');                         -- 25

select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('reviewer.rae@example.invalid', 'aal1') \gset
select is((select count(*)::int from public.document_uploads), 0,
  'staff at aal1 sees zero documents');                                     -- 26
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('reviewer.rae@example.invalid', 'aal2') \gset
select is((select count(*)::int from public.document_uploads), 3,
  'staff at aal2 sees exactly the documents of their one scope');           -- 27

select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('mixed.cross@example.invalid', 'aal1') \gset
select is((select count(*)::int from public.document_uploads), 0,
  'a mixed-role user at aal1 sees zero documents despite a client membership'); -- 28
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('mixed.cross@example.invalid', 'aal2') \gset
select is((select count(*)::int from public.document_uploads), 4,
  'a mixed-role user at aal2 sees exactly their two scopes (A1 and B1)');  -- 29

select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('client.second@example.invalid') \gset
select is((select count(*)::int from public.document_uploads), 1,
  'client B sees exactly their one document');                              -- 30

-- ---------------------------------------------------------------------------
-- begin_document_upload as the client owner: the reservation, its receipt,
-- idempotency, and every refusal token.
-- ---------------------------------------------------------------------------
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('client.owner@example.invalid') \gset

select (pg_temp.begin_a1('aaaa1111-0000-4000-8000-000000000001') ->> 'upload_id')::uuid as first_id \gset
select is(
  (select status from public.document_uploads where id = :'first_id'), 'UPLOADING',
  'a reservation starts in UPLOADING');                                     -- 31
select is(
  (select storage_path from public.document_uploads where id = :'first_id'),
  '11111111-0000-4000-8000-000000000001/aaaaaaaa-0000-4000-8000-000000000001/'
  || 'aaaaaaaa-1111-4000-8000-000000000001/dddddddd-0000-4000-8000-0000000000a1/' || :'first_id',
  'the reserved path is scope / request / upload id');                      -- 32
select is(
  (select created_by from public.document_uploads where id = :'first_id'),
  pg_temp.user_id_for('client.owner@example.invalid'),
  'the reservation is bound to the acting user');                           -- 33
select ok(
  (select expires_at between now() + interval '23 hours' and now() + interval '25 hours'
     from public.document_uploads where id = :'first_id'),
  'a transfer window of 24 hours');                                         -- 34
select is(
  (pg_temp.begin_a1('aaaa1111-0000-4000-8000-000000000001') ->> 'upload_id')::uuid, :'first_id'::uuid,
  'replaying the same idempotency key returns the same reservation');       -- 35
select is(
  (select count(*)::int from public.document_uploads
   where idempotency_key = 'aaaa1111-0000-4000-8000-000000000001'), 1,
  'and writes no second row');                                              -- 36

select throws_ok(
  $$select pg_temp.begin_a1(gen_random_uuid(), 1, 'application/pdf', 1234, 'x (Synthetic).pdf',
      repeat('ab', 32), 'dddddddd-0000-4000-8000-0000000000a2')$$,
  'P0001', 'request_closed', 'an answered request refuses a document');    -- 37
select throws_ok(
  $$select pg_temp.begin_a1(gen_random_uuid(), 2)$$,
  'P0001', 'request_changed', 'a stale request version is a conflict, never an overwrite'); -- 38
select throws_ok(
  $$select pg_temp.begin_a1(gen_random_uuid(), 1, 'application/zip')$$,
  'P0001', 'unsupported_type', 'a type outside the allowlist is refused'); -- 39
select throws_ok(
  $$select pg_temp.begin_a1(gen_random_uuid(), 1, 'application/pdf', 20971521)$$,
  'P0001', 'file_too_large', 'one byte over 20 MB is refused');            -- 40
select throws_ok(
  $$select pg_temp.begin_a1(gen_random_uuid(), 1, 'application/pdf', 0)$$,
  'P0001', 'empty_file', 'an empty file is refused');                      -- 41
select throws_ok(
  $$select pg_temp.begin_a1(gen_random_uuid(), 1, 'application/pdf', 1234, 'x (Synthetic).pdf', 'zz')$$,
  'P0001', 'invalid_digest', 'a malformed digest is refused');             -- 42
select throws_ok(
  $$select pg_temp.begin_a1(gen_random_uuid(), 1, 'application/pdf', 1234, '')$$,
  'P0001', 'invalid_name', 'an empty display name is refused');            -- 43
select throws_ok(
  $$select pg_temp.begin_a1(gen_random_uuid(), 1, 'application/pdf', 1234, 'x (Synthetic).pdf',
      repeat('ab', 32), 'dddddddd-0000-4000-8000-0000000000b1')$$,
  'P0001', 'request_not_found', 'a foreign request id inside the caller''s own scope is not found'); -- 44
select throws_ok(
  $$select public.begin_document_upload(
      '11111111-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001',
      'bbbbbbbb-1111-4000-8000-000000000001', 'dddddddd-0000-4000-8000-0000000000b1', 1,
      gen_random_uuid(), 'x (Synthetic).pdf', 'application/pdf', 1234, repeat('ab', 32))$$,
  '42501', null, 'a scope the caller has no client membership in is denied outright'); -- 45

-- The cap: one seeded ACCEPTED plus the reservation above make two live;
-- eight more make ten; the eleventh is refused.
select is(pg_temp.begin_many(8), 8, 'eight more reservations fit under the cap'); -- 46
select throws_ok(
  $$select pg_temp.begin_a1(gen_random_uuid())$$,
  'P0001', 'too_many_documents', 'the eleventh live document on a request is refused'); -- 47

-- ---------------------------------------------------------------------------
-- The transfer and its completion: the bucket admits exactly the reserved
-- path from exactly the reserving user, and completion checks the object.
-- ---------------------------------------------------------------------------
select (select storage_path from public.document_uploads where id = :'first_id') as first_path \gset

select throws_ok(
  format('select public.complete_document_upload(%L)', :'first_id'),
  'P0001', 'transfer_incomplete', 'completion before any object exists is refused'); -- 48
select throws_ok(
  $$insert into storage.objects (bucket_id, name, metadata)
    values ('hive-quarantine', 'not/a/reserved/path', '{"size": 1}'::jsonb)$$,
  '42501', null, 'the bucket refuses an object at an unreserved path');    -- 49
select lives_ok(
  format($$insert into storage.objects (bucket_id, name, owner_id, metadata)
           values ('hive-quarantine', %L, %L, '{"size": 99, "mimetype": "application/pdf"}'::jsonb)$$,
         :'first_path', pg_temp.user_id_for('client.owner@example.invalid')::text),
  'the reserving client user may insert the object at the reserved path'); -- 50
select is(
  (select count(*)::int from storage.objects where bucket_id = 'hive-quarantine'), 0,
  'and can never read it back: no SELECT policy, zero rows');              -- 51
select throws_ok(
  format($$insert into storage.objects (bucket_id, name, metadata)
           values ('hive-quarantine', %L, '{"size": 1234}'::jsonb)$$, :'first_path'),
  '23505', null, 'a second object at the same path is a unique violation, not an overwrite'); -- 52
select throws_ok(
  format('select public.complete_document_upload(%L)', :'first_id'),
  'P0001', 'size_mismatch', 'an object whose stored size differs from the declaration is refused'); -- 53

select pg_temp.become_superuser() \gset
update storage.objects set metadata = '{"size": 1234, "mimetype": "application/pdf"}'::jsonb
 where bucket_id = 'hive-quarantine' and name = :'first_path';
select is(
  (select count(*)::int from storage.objects where bucket_id = 'hive-quarantine' and name = :'first_path'), 1,
  'the object row exists (seen by the superuser)');                         -- 54

select pg_temp.impersonate_email('client.second@example.invalid') \gset
select throws_ok(
  format('select public.complete_document_upload(%L)', :'first_id'),
  '42501', null, 'another client cannot complete someone else''s reservation'); -- 55
select throws_ok(
  format($$insert into storage.objects (bucket_id, name, metadata)
           values ('hive-quarantine', %L, '{"size": 1234}'::jsonb)$$,
         replace(:'first_path', :'first_id', 'ffffffff-0000-4000-8000-000000000000')),
  '42501', null, 'another client cannot write under the reserving scope');  -- 56

select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('client.owner@example.invalid') \gset
select is(
  (public.complete_document_upload(:'first_id') ->> 'status'), 'QUARANTINED',
  'completion moves the document into quarantine');                        -- 57
select is(
  (select version from public.document_uploads where id = :'first_id'), 2,
  'the transition bumped the version');                                     -- 58
select ok(
  (select received_at is not null
     and expires_at between now() + interval '29 days' and now() + interval '31 days'
     from public.document_uploads where id = :'first_id'),
  'received now, retained for 30 days');                                    -- 59
select is(
  (public.complete_document_upload(:'first_id') ->> 'status'), 'QUARANTINED',
  'completing twice reports the same state and changes nothing');           -- 60
select is(
  (select count(*)::int from public.activity_events
   where case_id = 'eeeeeeee-0000-4000-8000-0000000000a1'
     and event_kind = 'document.received' and actor_role = 'client_user'), 1,
  'the client sees "document received" in the activity trail');             -- 61
select is(
  (select count(*)::int from storage.objects where bucket_id = 'hive-quarantine'), 0,
  'a received object is still invisible to its uploader');                  -- 62
-- A client DELETE is refused one of two ways depending on the lane: the
-- storage service's own guard raises ("Direct deletion from storage tables
-- is not allowed"), and without it RLS simply targets no row. Either way
-- the object must remain, which is the assertion that matters.
select pg_temp.try_client_delete(:'first_path') as delete_outcome \gset
select pg_temp.become_superuser() \gset
select is(
  (select count(*)::int from storage.objects where bucket_id = 'hive-quarantine' and name = :'first_path'), 1,
  'and a client DELETE removes nothing');                                   -- 63
select is(
  (select array_agg(action order by occurred_at) from public.audit_receipts
    where object_ref = 'upload:' || :'first_id'),
  array['document.upload_begun', 'document.received'],
  'each transition left an audit receipt');                                 -- 64

-- ---------------------------------------------------------------------------
-- Who may reserve at all: staff never; a mixed-role user only at AAL2.
-- ---------------------------------------------------------------------------
select pg_temp.impersonate_email('reviewer.rae@example.invalid', 'aal2') \gset
select throws_ok(
  $$select pg_temp.begin_a1(gen_random_uuid())$$,
  '42501', null, 'staff cannot reserve an upload even at aal2');           -- 65
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('mixed.same@example.invalid', 'aal1') \gset
select throws_ok(
  $$select pg_temp.begin_a1(gen_random_uuid())$$,
  '42501', null, 'a client user who also holds a staff role is refused at aal1'); -- 66
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('mixed.same@example.invalid', 'aal2') \gset
-- Their own reservation on the answered request would be refused as
-- closed; use a fresh open request slot by reserving on A1-open with a
-- fresh key — the cap counts all users' live documents, so one is freed
-- below by expiring a filler first. Simpler: the refusal token proves the
-- authorization passed and the request rule fired.
select throws_ok(
  $$select pg_temp.begin_a1(gen_random_uuid())$$,
  'P0001', 'too_many_documents', 'the same user at aal2 passes authorization (and meets the cap)'); -- 67

-- ---------------------------------------------------------------------------
-- The scan interface: clients cannot reach it; the server role walks the
-- document through VALIDATING to a verdict, and the trail says so.
-- ---------------------------------------------------------------------------
select throws_ok(
  format('select public.begin_document_scan(%L)', :'first_id'),
  '42501', null, 'a client cannot begin a scan');                           -- 68

select pg_temp.become_service_role() \gset
select is(
  (public.begin_document_scan(:'first_id') ->> 'status'), 'VALIDATING',
  'the server role moves a quarantined document into validation');         -- 69
select throws_ok(
  format('select public.record_document_scan(%L, %L)', :'first_id', 'maybe'),
  'P0001', 'invalid_verdict', 'a verdict outside accepted/rejected is refused'); -- 70
select throws_ok(
  format('select public.record_document_scan(%L, %L)', :'first_id', 'rejected'),
  'P0001', 'invalid_reason', 'a rejection without an enumerated reason is refused'); -- 71
select is(
  (public.record_document_scan(:'first_id', 'accepted') ->> 'status'), 'ACCEPTED',
  'an accepted verdict settles the document');                              -- 72
select throws_ok(
  format('select public.record_document_scan(%L, %L)', :'first_id', 'accepted'),
  'P0001', 'not_validating', 'a settled document takes no second verdict'); -- 73
select is(
  (select count(*)::int from public.activity_events
   where case_id = 'eeeeeeee-0000-4000-8000-0000000000a1'
     and event_kind = 'document.checked' and actor_role = 'system'), 1,
  'the trail records the check with the system as actor');                  -- 74

-- A rejection, on one of the filler reservations completed by the superuser.
select pg_temp.become_superuser() \gset
-- Every filler shares the transaction's now() as created_at, so the rows
-- are ordered by id, which is stable for the rest of this transaction.
select id as filler_id, storage_path as filler_path from public.document_uploads
 where request_id = 'dddddddd-0000-4000-8000-0000000000a1' and status = 'UPLOADING'
 order by id limit 1 \gset
insert into storage.objects (bucket_id, name, metadata)
  values ('hive-quarantine', :'filler_path', '{"size": 100, "mimetype": "application/pdf"}'::jsonb);
select pg_temp.impersonate_email('client.owner@example.invalid') \gset
select is((public.complete_document_upload(:'filler_id') ->> 'status'), 'QUARANTINED',
  'a second document is received');                                         -- 75
select pg_temp.become_service_role() \gset
select is((public.begin_document_scan(:'filler_id') ->> 'status'), 'VALIDATING',
  'and enters validation');                                                 -- 76
select is(
  (public.record_document_scan(:'filler_id', 'rejected', 'malware_detected') ->> 'status'), 'REJECTED',
  'a rejected verdict settles it as not accepted');                         -- 77
select is(
  (select rejection_reason from public.document_uploads where id = :'filler_id'), 'malware_detected',
  'with its reason on the row');                                            -- 78

-- ---------------------------------------------------------------------------
-- The expiry sweep and the lifecycle trigger.
-- ---------------------------------------------------------------------------
select pg_temp.become_superuser() \gset
select id as stale_uploading from public.document_uploads
 where request_id = 'dddddddd-0000-4000-8000-0000000000a1' and status = 'UPLOADING'
 order by id limit 1 \gset
-- Only live rows can be aged: the lifecycle trigger refuses any update to a
-- settled row (asserted below), which is also why the sweep can never
-- touch first_id or filler_id.
update public.document_uploads set expires_at = now() - interval '1 minute'
 where id = :'stale_uploading';
select id as stale_received, storage_path as stale_received_path from public.document_uploads
 where request_id = 'dddddddd-0000-4000-8000-0000000000a1' and status = 'UPLOADING'
 order by id offset 1 limit 1 \gset
insert into storage.objects (bucket_id, name, metadata)
  values ('hive-quarantine', :'stale_received_path', '{"size": 100, "mimetype": "application/pdf"}'::jsonb);
select pg_temp.impersonate_email('client.owner@example.invalid') \gset
select is((public.complete_document_upload(:'stale_received') ->> 'status'), 'QUARANTINED',
  'a third document is received, to be expired below');                     -- 79
select pg_temp.become_superuser() \gset
update public.document_uploads set expires_at = now() - interval '1 minute' where id = :'stale_received';
select pg_temp.become_service_role() \gset
select is(public.expire_stale_document_uploads(), 2,
  'the sweep expires the stale transfer and the stale quarantined document'); -- 80
select is(
  (select count(*)::int from public.activity_events
   where case_id = 'eeeeeeee-0000-4000-8000-0000000000a1' and event_kind = 'document.expired'), 1,
  'only the document that had been received is announced as expired');     -- 81

select pg_temp.become_superuser() \gset
select throws_ok(
  format($$update public.document_uploads set status = 'QUARANTINED' where id = %L$$, :'first_id'),
  'P0001', null, 'a settled document cannot be moved back');                -- 82
select throws_ok(
  format($$update public.document_uploads set byte_size = 1 where id = %L$$, :'stale_uploading'),
  'P0001', 'document upload identity is immutable', 'identity columns never change'); -- 83
update public.requests set title = title where id = 'dddddddd-0000-4000-8000-0000000000a1';
select is(
  (select version from public.requests where id = 'dddddddd-0000-4000-8000-0000000000a1'), 2,
  'every request update bumps its version, so a client''s stale version conflicts'); -- 84

select * from finish();
rollback;
