-- Milestone 5 (WO-006): source adapters — structure and grants; the
-- server-role adapter interface; a ledger reference recorded once,
-- replayed, refused, read by staff of the scope at AAL2 and by nobody
-- else, and immutable; a filing receipt's every precondition (an approved
-- case whose active approval covers a checked document), its binding to
-- the document's digest and the approved package, its replay, the read
-- matrix, and the read-only verification with both outcomes.
--
-- Seeded state this suite relies on: case A1 is EVIDENCE_PENDING at
-- version 1 with checked documents a1 (on the open request), a3 (on the
-- answered request), and a4 (on the question), and the refused document
-- a2; intake.beth holds intake on A1; preparer.pat, reviewer.rae, and
-- approver.avery hold their roles on A1.
begin;
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
create function pg_temp.approve(p_version integer, p_package uuid, p_digest text,
                                p_key uuid default gen_random_uuid())
returns jsonb language sql as $$
  select public.approve_case_package(
    '11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
    'aaaaaaaa-1111-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-0000000000a1',
    p_version, p_package, p_digest, 'hive-record', p_key)
$$;
create function pg_temp.file(p_version integer, p_document uuid, p_file_id text,
                             p_path text default '/Clients/Harbor Light Bakery LLC (Synthetic)/2025 books close (Synthetic)/bank-statement-2026-07 (Synthetic).pdf',
                             p_key uuid default gen_random_uuid())
returns jsonb language sql as $$
  select public.record_filing_receipt(
    '11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
    'aaaaaaaa-1111-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-0000000000a1',
    p_version, p_document, p_file_id, p_path, p_key)
$$;
create function pg_temp.reference(p_case uuid default 'eeeeeeee-0000-4000-8000-0000000000a1',
                                  p_name text default 'Operating account (Synthetic)')
returns jsonb language sql as $$
  select public.record_ledger_reference(
    p_case, 'realm-synthetic-a1', 'Account', 'acct-synthetic-operating', '3', p_name,
    '2026-09-28T12:00:00Z'::timestamptz, repeat('a', 64), 'HiveSyntheticLedger')
$$;
create function pg_temp.trail_count(p_kind text)
returns integer language sql as $$
  select count(*)::int from public.activity_events
   where case_id = 'eeeeeeee-0000-4000-8000-0000000000a1' and event_kind = p_kind
$$;

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.ledger_references'::regclass),
  'ledger_references has row level security enabled');                     -- 1
select ok((select relrowsecurity from pg_class where oid = 'public.filing_receipts'::regclass),
  'filing_receipts has row level security enabled');                       -- 2
select is((select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'ledger_references' and permissive = 'RESTRICTIVE'), 1,
  'ledger_references carries the restrictive staff-AAL2 layer');           -- 3
select is((select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'filing_receipts' and permissive = 'RESTRICTIVE'), 1,
  'filing_receipts carries the restrictive staff-AAL2 layer');             -- 4
select is((select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and table_name in ('ledger_references', 'filing_receipts')
     and grantee = 'authenticated' and privilege_type <> 'SELECT'), 0,
  'both tables grant authenticated nothing but SELECT');                   -- 5
select is((select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and table_name in ('ledger_references', 'filing_receipts')
     and grantee = 'anon'), 0,
  'and anon nothing at all');                                              -- 6
select ok((select pg_get_constraintdef(oid) from pg_constraint
   where conname = 'activity_events_event_kind_check') like '%record.verified%',
  'the activity vocabulary names the source kinds');                       -- 7
select is(has_function_privilege('anon',
  'public.record_filing_receipt(uuid,uuid,uuid,uuid,integer,uuid,text,text,uuid)', 'execute'), false,
  'anon cannot execute record_filing_receipt');                            -- 8
select is(has_function_privilege('authenticated',
  'public.record_ledger_reference(uuid,text,text,text,text,text,timestamptz,text,text)', 'execute'), false,
  'authenticated cannot execute the ledger adapter interface');            -- 9
select is(has_function_privilege('authenticated', 'public.verify_filing_receipt(uuid,text,text)', 'execute'), false,
  'authenticated cannot execute the record adapter interface');            -- 10
select ok(
  has_function_privilege('service_role',
    'public.record_ledger_reference(uuid,text,text,text,text,text,timestamptz,text,text)', 'execute')
  and has_function_privilege('service_role', 'public.verify_filing_receipt(uuid,text,text)', 'execute'),
  'the server role may run both adapter interfaces');                      -- 11

-- ---------------------------------------------------------------------------
-- Ledger references: recorded by the adapter, read by staff of the scope.
-- ---------------------------------------------------------------------------
select pg_temp.impersonate_email('intake.beth@example.invalid') \gset
select throws_ok('select pg_temp.reference()', '42501', null,
  'staff cannot record a ledger reference themselves');                    -- 12
select pg_temp.become_service_role() \gset
select pg_temp.reference() as referenced \gset
select is((:'referenced'::jsonb ->> 'replayed')::boolean, false,
  'the adapter records a reference');                                      -- 13
select is(pg_temp.reference() ->> 'reference_id', :'referenced'::jsonb ->> 'reference_id',
  'the same object at the same version is one row');                       -- 14
select throws_ok($$select pg_temp.reference(p_name => E'bad\x01name')$$, 'P0001', 'invalid_text',
  'a control character in the label is refused');                          -- 15
select throws_ok($$select pg_temp.reference(p_case => gen_random_uuid())$$, 'P0001', 'case_not_found',
  'an unknown case is refused');                                           -- 16
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('intake.beth@example.invalid') \gset
select is((select count(*)::int from public.ledger_references), 1,
  'intake at AAL2 reads the reference');                                   -- 17
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('intake.beth@example.invalid', 'aal1') \gset
select is((select count(*)::int from public.ledger_references), 0,
  'the same intake at AAL1 reads nothing');                                -- 18
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('client.owner@example.invalid', 'aal1') \gset
select is((select count(*)::int from public.ledger_references), 0,
  'a client user reads no reference');                                     -- 19
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('mixed.cross@example.invalid') \gset
select is((select count(*)::int from public.ledger_references), 0,
  'staff elsewhere, a client here: nothing in this scope');                -- 20
select pg_temp.become_superuser() \gset
select is(pg_temp.trail_count('source.referenced'), 1,
  'the trail gained "source referenced" by HIVE');                         -- 21
select throws_ok(
  format($$update public.ledger_references set display_name = 'x' where id = %L$$,
         :'referenced'::jsonb ->> 'reference_id'),
  'P0001', 'a ledger reference is immutable', 'a reference cannot be edited by anyone'); -- 22

-- ---------------------------------------------------------------------------
-- Filing receipts: only approved, checked evidence, by intake or the
-- preparer, at AAL2, naming the exact bytes.
-- ---------------------------------------------------------------------------
select pg_temp.impersonate_email('intake.beth@example.invalid') \gset
select throws_ok(
  $$select pg_temp.file(1, 'd0c0d0c0-0000-4000-8000-0000000000a1', 'drv-synthetic-0001')$$,
  'P0001', 'case_not_approved', 'nothing is filed under a case that is not approved'); -- 23
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('preparer.pat@example.invalid') \gset
select pg_temp.freeze(1) as frozen \gset
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('reviewer.rae@example.invalid') \gset
select pg_temp.start_review(2) as started \gset
select pg_temp.verdict(3, 'PASS') as passed \gset
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('approver.avery@example.invalid') \gset
select pg_temp.approve(4, (:'frozen'::jsonb ->> 'package_id')::uuid, :'frozen'::jsonb ->> 'manifest_digest') as approved \gset
select is(:'approved'::jsonb ->> 'case_status', 'APPROVED', 'the case is approved (version 5)'); -- 24

select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('client.owner@example.invalid', 'aal1') \gset
select throws_ok(
  $$select pg_temp.file(5, 'd0c0d0c0-0000-4000-8000-0000000000a1', 'drv-synthetic-0001')$$,
  '42501', null, 'a client cannot record a filing receipt');               -- 25
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('reviewer.rae@example.invalid') \gset
select throws_ok(
  $$select pg_temp.file(5, 'd0c0d0c0-0000-4000-8000-0000000000a1', 'drv-synthetic-0001')$$,
  '42501', null, 'a reviewer holds no filing role');                       -- 26
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('intake.beth@example.invalid', 'aal1') \gset
select throws_ok(
  $$select pg_temp.file(5, 'd0c0d0c0-0000-4000-8000-0000000000a1', 'drv-synthetic-0001')$$,
  '42501', null, 'intake at AAL1 cannot file');                            -- 27
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('intake.beth@example.invalid') \gset
select throws_ok(
  $$select pg_temp.file(99, 'd0c0d0c0-0000-4000-8000-0000000000a1', 'drv-synthetic-0001')$$,
  'P0001', 'case_changed', 'a stale case version is a conflict');          -- 28
select throws_ok(
  $$select pg_temp.file(5, 'd0c0d0c0-0000-4000-8000-0000000000b1', 'drv-synthetic-0001')$$,
  'P0001', 'document_not_filable', 'a document of another case is not filed here'); -- 29
select throws_ok(
  $$select pg_temp.file(5, 'd0c0d0c0-0000-4000-8000-0000000000a2', 'drv-synthetic-0001')$$,
  'P0001', 'document_not_filable', 'a refused document is never filed');   -- 30
-- A document checked AFTER the freeze is not covered by the approval.
select pg_temp.become_superuser() \gset
insert into public.document_uploads (
  id, environment_id, client_id, entity_id, case_id, request_id, created_by, idempotency_key,
  status, display_name, mime_type, byte_size, client_digest, storage_path, version,
  received_at, checked_at, expires_at
) values (
  'd0c0d0c0-0000-4000-8000-0000000000a9', '11111111-0000-4000-8000-000000000001',
  'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-1111-4000-8000-000000000001',
  'eeeeeeee-0000-4000-8000-0000000000a1', 'dddddddd-0000-4000-8000-0000000000a1',
  pg_temp.user_id_for('client.owner@example.invalid'), gen_random_uuid(),
  'ACCEPTED', 'late-arrival (Synthetic).pdf', 'application/pdf', 100, repeat('9', 64),
  '11111111-0000-4000-8000-000000000001/aaaaaaaa-0000-4000-8000-000000000001/aaaaaaaa-1111-4000-8000-000000000001/dddddddd-0000-4000-8000-0000000000a1/d0c0d0c0-0000-4000-8000-0000000000a9',
  3, now(), now(), now() + interval '30 days'
);
select pg_temp.impersonate_email('intake.beth@example.invalid') \gset
select throws_ok(
  $$select pg_temp.file(5, 'd0c0d0c0-0000-4000-8000-0000000000a9', 'drv-synthetic-0001')$$,
  'P0001', 'document_not_approved', 'a document the approval does not cover is not filed under it'); -- 31
select throws_ok(
  $$select pg_temp.file(5, 'd0c0d0c0-0000-4000-8000-0000000000a1', 'bad id!')$$,
  'P0001', 'invalid_file_id', 'a Drive file id is an identifier');         -- 32
select throws_ok(
  $$select pg_temp.file(5, 'd0c0d0c0-0000-4000-8000-0000000000a1', 'drv-synthetic-0001', E'/bad\x01path')$$,
  'P0001', 'invalid_path', 'a control character in the path is refused');   -- 33
select throws_ok(
  format($$select pg_temp.file(5, 'd0c0d0c0-0000-4000-8000-0000000000a1', 'drv-synthetic-0001', %L)$$,
         '/' || repeat('x', 240)),
  'P0001', 'invalid_path', 'the 241st character of a path is refused');    -- 34
select throws_ok(
  $$select pg_temp.file(5, 'd0c0d0c0-0000-4000-8000-0000000000a1', 'drv-synthetic-0001', '   ')$$,
  'P0001', 'invalid_path', 'a blank path is nothing at all and is refused');  -- 34b

select gen_random_uuid() as file_key \gset
select pg_temp.file(5, 'd0c0d0c0-0000-4000-8000-0000000000a1', 'drv-synthetic-0001', p_key => :'file_key') as filed \gset
select is(:'filed'::jsonb ->> 'status', 'RECORDED', 'intake records a filing receipt');  -- 35
select is(:'filed'::jsonb ->> 'claimed_digest',
  (select client_digest from public.document_uploads where id = 'd0c0d0c0-0000-4000-8000-0000000000a1'),
  'bound to the document''s exact bytes');                                 -- 36
select is(:'filed'::jsonb ->> 'package_id', :'frozen'::jsonb ->> 'package_id',
  'and to the approved package');                                          -- 37
select is((select filed_role from public.filing_receipts where id = (:'filed'::jsonb ->> 'receipt_id')::uuid),
  'intake', 'recorded under the intake role');                             -- 38
select is(pg_temp.file(5, 'd0c0d0c0-0000-4000-8000-0000000000a1', 'drv-synthetic-0001', p_key => :'file_key') ->> 'receipt_id',
  :'filed'::jsonb ->> 'receipt_id', 'the same key replays the same receipt'); -- 39
select throws_ok(
  $$select pg_temp.file(5, 'd0c0d0c0-0000-4000-8000-0000000000a1', 'drv-synthetic-0001')$$,
  'P0001', 'receipt_exists', 'the same document at the same Drive object is one receipt'); -- 40
select is(pg_temp.trail_count('record.filed'), 1, 'the trail gained "filed to the record"'); -- 41
select pg_temp.become_superuser() \gset
select ok((select details ? 'drive_path' = false and details ? 'receipt_id'
   from public.audit_receipts
   where object_ref = 'case:eeeeeeee-0000-4000-8000-0000000000a1' and action = 'record.filed'),
  'the audit receipt carries ids, never the path');                        -- 42
select pg_temp.impersonate_email('intake.beth@example.invalid') \gset
select is((select count(*)::int from public.filing_receipts), 1, 'intake reads the receipt'); -- 43
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('client.owner@example.invalid', 'aal1') \gset
select is((select count(*)::int from public.filing_receipts), 0, 'a client user reads no receipt'); -- 44
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('preparer.pat@example.invalid') \gset
select is((select count(*)::int from public.filing_receipts), 1, 'the preparer reads it too'); -- 45
select pg_temp.file(5, 'd0c0d0c0-0000-4000-8000-0000000000a3', 'drv-synthetic-0002',
  '/Clients/Harbor Light Bakery LLC (Synthetic)/2025 books close (Synthetic)/statement-2025-11 (Synthetic).pdf') as filed2 \gset
select is((select filed_role from public.filing_receipts where id = (:'filed2'::jsonb ->> 'receipt_id')::uuid),
  'preparer', 'the preparer records a receipt under the preparer role');   -- 46

-- ---------------------------------------------------------------------------
-- Verification: the adapter's read-only check, both outcomes.
-- ---------------------------------------------------------------------------
select pg_temp.become_superuser() \gset
select pg_temp.impersonate_email('intake.beth@example.invalid') \gset
select throws_ok(
  format($$select public.verify_filing_receipt(%L, %L, 'HiveSyntheticDrive')$$,
         :'filed'::jsonb ->> 'receipt_id', :'filed'::jsonb ->> 'claimed_digest'),
  '42501', null, 'staff cannot verify a receipt themselves');              -- 47
select pg_temp.become_service_role() \gset
select is(
  public.verify_filing_receipt((:'filed'::jsonb ->> 'receipt_id')::uuid,
    :'filed'::jsonb ->> 'claimed_digest', 'HiveSyntheticDrive') ->> 'status',
  'VERIFIED', 'the record holding the claimed bytes verifies the receipt'); -- 48
select is(
  public.verify_filing_receipt((:'filed2'::jsonb ->> 'receipt_id')::uuid,
    repeat('0', 63) || 'f', 'HiveSyntheticDrive') ->> 'status',
  'MISMATCH', 'the record holding other bytes is a mismatch');             -- 49
select is(
  (public.verify_filing_receipt((:'filed'::jsonb ->> 'receipt_id')::uuid,
    repeat('0', 64), 'HiveSyntheticDrive') ->> 'replayed')::boolean,
  true, 'a settled receipt is returned as it stands, never re-verified');  -- 50
select pg_temp.become_superuser() \gset
select is(pg_temp.trail_count('record.verified') || ':' || pg_temp.trail_count('record.mismatch'), '1:1',
  'the trail carries one verification and one mismatch, by HIVE');         -- 51
select throws_ok(
  format($$update public.filing_receipts set status = 'RECORDED', verified_at = null, adapter_name = null where id = %L$$,
         :'filed'::jsonb ->> 'receipt_id'),
  'P0001', 'a verified filing receipt is immutable', 'a verified receipt cannot be edited by anyone'); -- 52
select pg_temp.impersonate_email('client.owner@example.invalid', 'aal1') \gset
select is((select count(*)::int from public.filing_receipts) + (select count(*)::int from public.ledger_references), 0,
  'a client user still reads no receipt and no reference');               -- 53

select * from finish();
rollback;
