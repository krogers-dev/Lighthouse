-- The malware scanner's receipts (WO-015): a verdict names the engine and
-- the signature database it judged with; the older three-argument call
-- still records; the labels are bounded; nobody but the server role may
-- record.
--
-- Seeded state this suite relies on: client.owner holds client_user on
-- A1; the A1 open request dddddddd-…a1 accepts reservations.
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

create function pg_temp.become_service_role()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'service_role', true);
end;
$$;

create function pg_temp.reserve(p_key uuid, p_name text)
returns jsonb language sql as $$
  select public.begin_document_upload(
    '11111111-0000-4000-8000-000000000001',
    'aaaaaaaa-0000-4000-8000-000000000001',
    'aaaaaaaa-1111-4000-8000-000000000001',
    'dddddddd-0000-4000-8000-0000000000a1', 1, p_key, p_name,
    'application/pdf', 1234, repeat('ab', 32))
$$;

-- ---------------------------------------------------------------------------
-- The interface: one overload, the server role's alone.
-- ---------------------------------------------------------------------------
select is(
  has_function_privilege('authenticated', 'public.record_document_scan(uuid,text,text,text,text)', 'execute'),
  false, 'authenticated cannot execute record_document_scan');              -- 1
select is(
  has_function_privilege('service_role', 'public.record_document_scan(uuid,text,text,text,text)', 'execute'),
  true, 'the server role may record a scan verdict');                       -- 2
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'record_document_scan'), 1,
  'exactly one record_document_scan exists (the old signature is gone)');   -- 3

-- ---------------------------------------------------------------------------
-- Two documents received and entering validation.
-- ---------------------------------------------------------------------------
select pg_temp.impersonate_email('client.owner@example.invalid') \gset
select (pg_temp.reserve('11111111-1111-4111-8111-000000000001', 'scanned (Synthetic).pdf') ->> 'upload_id') as first_id,
       (pg_temp.reserve('11111111-1111-4111-8111-000000000001', 'scanned (Synthetic).pdf') ->> 'storage_path') as first_path \gset
select (pg_temp.reserve('11111111-1111-4111-8111-000000000002', 'older call (Synthetic).pdf') ->> 'upload_id') as second_id,
       (pg_temp.reserve('11111111-1111-4111-8111-000000000002', 'older call (Synthetic).pdf') ->> 'storage_path') as second_path \gset
select pg_temp.become_superuser() \gset
insert into storage.objects (bucket_id, name, metadata)
  values ('hive-quarantine', :'first_path', '{"size": 1234, "mimetype": "application/pdf"}'::jsonb),
         ('hive-quarantine', :'second_path', '{"size": 1234, "mimetype": "application/pdf"}'::jsonb);
select pg_temp.impersonate_email('client.owner@example.invalid') \gset
select public.complete_document_upload(:'first_id');
select public.complete_document_upload(:'second_id');
select pg_temp.become_service_role() \gset
select is(
  (public.begin_document_scan(:'first_id') ->> 'status'), 'VALIDATING',
  'the server role moves the first document into validation');             -- 4
select public.begin_document_scan(:'second_id');

-- ---------------------------------------------------------------------------
-- The labels are bounded, and a version needs an engine.
-- ---------------------------------------------------------------------------
select throws_ok(
  format('select public.record_document_scan(%L, %L, null, %L, %L)', :'first_id', 'accepted', E'Clam\tAV', '1.4.3'),
  'P0001', 'invalid_scanner', 'a control character in the scanner name is refused'); -- 5
select throws_ok(
  format('select public.record_document_scan(%L, %L, null, null, %L)', :'first_id', 'accepted', '1.4.3'),
  'P0001', 'invalid_scanner', 'a version without an engine name is refused'); -- 6
select throws_ok(
  format('select public.record_document_scan(%L, %L, null, %L, null)', :'first_id', 'accepted', repeat('x', 121)),
  'P0001', 'invalid_scanner', 'a 121-character scanner name is refused');   -- 7

-- ---------------------------------------------------------------------------
-- A named verdict, and the receipt that names it.
-- ---------------------------------------------------------------------------
select is(
  (public.record_document_scan(:'first_id', 'accepted', null, '  ClamAV ', 'ClamAV 1.4.3 (signatures 27500)') ->> 'status'),
  'ACCEPTED', 'an accepted verdict from a named scanner settles the document'); -- 8
select is(
  (select details ->> 'scanner' || ' / ' || (details ->> 'scanner_version')
     from public.audit_receipts
    where object_ref = 'upload:' || :'first_id' and action = 'document.checked'),
  'ClamAV / ClamAV 1.4.3 (signatures 27500)',
  'the receipt names the engine (trimmed) and the signature version');      -- 9

-- The older call still records; its receipt names no scanner.
select public.record_document_scan(:'second_id', 'rejected', 'scan_failed');
select is(
  (select (details ? 'scanner') and (details -> 'scanner') = 'null'::jsonb
     from public.audit_receipts
    where object_ref = 'upload:' || :'second_id' and action = 'document.not_accepted'),
  true, 'a verdict recorded without a scanner carries a null scanner, not a missing key'); -- 10

select * from finish();
rollback;
