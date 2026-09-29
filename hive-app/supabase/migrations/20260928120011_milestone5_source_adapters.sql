-- Milestone 5: source adapters (WO-006).
--
-- Two kinds of source record, both READ-ONLY toward the systems they
-- name. A ledger reference points at an object in QuickBooks Online (the
-- ledger, read-only from HIVE's perspective) as an identifier, a version,
-- an as-of time, and a digest of what the adapter read: never an amount,
-- a balance, or an account number, and never written back. A filing
-- receipt records that a person filed a checked, approved document to
-- Google Drive (the permanent record) by hand, naming the Drive object
-- and the exact bytes (the document's digest); the adapter then verifies,
-- read-only, that the object holds those bytes. HIVE never mutates Drive
-- and never becomes the record.
--
-- Every row names the adapter that produced or verified it, so a
-- synthetic reference can never pass for a live one. No live adapter
-- exists: integrations are HOLD, and the local lanes run the named
-- synthetic adapters (scripts/lib/synthetic-ledger.mjs,
-- scripts/lib/synthetic-drive.mjs) through the server-role interface
-- below, exactly as the document scanner runs. Both tables are staff
-- reads at AAL2; clients learn of a filing through the enumerated trail.

-- ---------------------------------------------------------------------------
-- activity_events: the source kinds. Still no free text.
-- ---------------------------------------------------------------------------

alter table public.activity_events drop constraint activity_events_event_kind_check;
alter table public.activity_events add constraint activity_events_event_kind_check check (
  event_kind in (
    'case.status_changed',
    'request.opened',
    'request.answered',
    'request.closed',
    'request.expired',
    'document.received',
    'document.checked',
    'document.not_accepted',
    'document.expired',
    'case.package_frozen',
    'case.review_started',
    'case.review_passed',
    'case.returned',
    'case.held',
    'case.approved',
    'case.resumed',
    'case.approval_expired',
    'source.referenced',
    'record.filed',
    'record.verified',
    'record.mismatch'
  )
);

-- ---------------------------------------------------------------------------
-- ledger_references: read-only pointers into the ledger, append-only.
-- ---------------------------------------------------------------------------

create table public.ledger_references (
  id uuid primary key default gen_random_uuid(),
  environment_id uuid not null,
  client_id uuid not null,
  entity_id uuid not null,
  case_id uuid not null,
  source text not null check (source = 'qbo'),
  realm_id text not null check (realm_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  object_type text not null check (
    object_type in ('Account', 'JournalEntry', 'Invoice', 'Bill', 'Payment', 'Report')
  ),
  object_id text not null check (object_id ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$'),
  object_version text not null check (object_version ~ '^[A-Za-z0-9._-]{1,64}$'),
  -- The object's own label, bounded and printable; never a value.
  display_name text not null check (
    char_length(display_name) between 1 and 120
    and display_name !~ E'[\\x00-\\x1F\\x7F]'
  ),
  as_of timestamptz not null,
  object_digest text not null check (object_digest ~ '^[0-9a-f]{64}$'),
  adapter_name text not null check (adapter_name ~ '^[A-Za-z][A-Za-z0-9]{2,63}$'),
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (case_id, source, realm_id, object_type, object_id, object_version),
  unique (environment_id, client_id, entity_id, id),
  foreign key (environment_id, client_id, entity_id, case_id)
    references public.cases (environment_id, client_id, entity_id, id)
);

create index ledger_references_scope_idx
  on public.ledger_references (environment_id, client_id, entity_id);
create index ledger_references_case_idx on public.ledger_references (case_id);

create function app_private.ledger_reference_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'a ledger reference is immutable';
end;
$$;

create trigger ledger_references_immutable
  before update on public.ledger_references
  for each row execute function app_private.ledger_reference_guard();

-- ---------------------------------------------------------------------------
-- filing_receipts: a person filed approved evidence to the record; the
-- adapter verified, read-only, that the record holds those bytes.
-- ---------------------------------------------------------------------------

create table public.filing_receipts (
  id uuid primary key default gen_random_uuid(),
  environment_id uuid not null,
  client_id uuid not null,
  entity_id uuid not null,
  case_id uuid not null,
  document_id uuid not null,
  -- The approved package the document was filed under.
  package_id uuid not null,
  drive_file_id text not null check (drive_file_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
  drive_path text not null check (
    char_length(drive_path) between 1 and 240
    and drive_path !~ E'[\\x00-\\x1F\\x7F]'
  ),
  -- The bytes the person says they filed: the document's own digest.
  claimed_digest text not null check (claimed_digest ~ '^[0-9a-f]{64}$'),
  filed_by uuid not null references auth.users (id),
  filed_role text not null check (filed_role in ('intake', 'preparer')),
  filed_at timestamptz not null default now(),
  status text not null default 'RECORDED' check (status in ('RECORDED', 'VERIFIED', 'MISMATCH')),
  verified_at timestamptz,
  found_digest text check (found_digest is null or found_digest ~ '^[0-9a-f]{64}$'),
  adapter_name text check (adapter_name is null or adapter_name ~ '^[A-Za-z][A-Za-z0-9]{2,63}$'),
  idempotency_key uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id, drive_file_id),
  unique (environment_id, client_id, entity_id, id),
  foreign key (environment_id, client_id, entity_id, case_id)
    references public.cases (environment_id, client_id, entity_id, id),
  foreign key (environment_id, client_id, entity_id, document_id)
    references public.document_uploads (environment_id, client_id, entity_id, id),
  foreign key (environment_id, client_id, entity_id, package_id)
    references public.case_review_packages (environment_id, client_id, entity_id, id),
  constraint filing_receipts_verified_iff check ((status = 'RECORDED') = (verified_at is null)),
  constraint filing_receipts_adapter_iff check ((status = 'RECORDED') = (adapter_name is null))
);

create index filing_receipts_scope_idx
  on public.filing_receipts (environment_id, client_id, entity_id);
create index filing_receipts_case_idx on public.filing_receipts (case_id);
create index filing_receipts_document_idx on public.filing_receipts (document_id);

create function app_private.filing_receipt_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.case_id <> old.case_id
     or new.document_id <> old.document_id
     or new.package_id <> old.package_id
     or new.drive_file_id <> old.drive_file_id
     or new.drive_path <> old.drive_path
     or new.claimed_digest <> old.claimed_digest
     or new.filed_by <> old.filed_by
     or new.filed_role <> old.filed_role
     or new.filed_at <> old.filed_at
     or new.idempotency_key <> old.idempotency_key
     or new.created_at <> old.created_at then
    raise exception 'filing receipt identity is immutable';
  end if;
  if old.status <> 'RECORDED' then
    raise exception 'a verified filing receipt is immutable';
  end if;
  if new.status = 'RECORDED' then
    raise exception 'a recorded receipt changes only by verification';
  end if;
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

create trigger filing_receipts_scope_immutable
  before update on public.filing_receipts
  for each row execute function app_private.reject_scope_change();
create trigger filing_receipts_lifecycle
  before update on public.filing_receipts
  for each row execute function app_private.filing_receipt_lifecycle();

-- ---------------------------------------------------------------------------
-- Grants and policies: SELECT for staff of the row's scope, at AAL2.
-- ---------------------------------------------------------------------------

grant select on public.ledger_references to authenticated;
grant select on public.filing_receipts to authenticated;

alter table public.ledger_references enable row level security;
alter table public.filing_receipts enable row level security;

create policy ledger_references_select_by_staff
  on public.ledger_references for select to authenticated
  using (
    exists (
      select 1 from public.memberships m
      where m.user_id = (select auth.uid())
        and m.environment_id = ledger_references.environment_id
        and m.client_id = ledger_references.client_id
        and m.entity_id = ledger_references.entity_id
        and m.role in ('intake', 'preparer', 'reviewer', 'approver')
    )
  );
create policy ledger_references_staff_requires_aal2
  on public.ledger_references as restrictive for select to authenticated
  using (
    (select coalesce(auth.jwt() ->> 'aal', 'aal1')) = 'aal2'
    or not exists (
      select 1 from public.memberships s
      where s.user_id = (select auth.uid()) and s.role <> 'client_user'
    )
  );

create policy filing_receipts_select_by_staff
  on public.filing_receipts for select to authenticated
  using (
    exists (
      select 1 from public.memberships m
      where m.user_id = (select auth.uid())
        and m.environment_id = filing_receipts.environment_id
        and m.client_id = filing_receipts.client_id
        and m.entity_id = filing_receipts.entity_id
        and m.role in ('intake', 'preparer', 'reviewer', 'approver')
    )
  );
create policy filing_receipts_staff_requires_aal2
  on public.filing_receipts as restrictive for select to authenticated
  using (
    (select coalesce(auth.jwt() ->> 'aal', 'aal1')) = 'aal2'
    or not exists (
      select 1 from public.memberships s
      where s.user_id = (select auth.uid()) and s.role <> 'client_user'
    )
  );

-- ---------------------------------------------------------------------------
-- The adapter interface: server role only, no borrowed authority.
-- ---------------------------------------------------------------------------

/** A ledger reference as the adapter read it. Idempotent on the object's
 * identity and version: the same object at the same version is one row. */
create function public.record_ledger_reference(
  p_case_id uuid,
  p_realm_id text,
  p_object_type text,
  p_object_id text,
  p_object_version text,
  p_display_name text,
  p_as_of timestamptz,
  p_object_digest text,
  p_adapter_name text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_case public.cases%rowtype;
  v_existing public.ledger_references%rowtype;
  v_id uuid;
  v_now timestamptz := now();
begin
  perform app_private.require_server_role();
  select * into v_case from public.cases c where c.id = p_case_id;
  if not found then
    raise exception 'case_not_found';
  end if;
  if p_display_name is null or p_display_name ~ E'[\\x00-\\x1F\\x7F]'
     or char_length(p_display_name) not between 1 and 120 then
    raise exception 'invalid_text';
  end if;
  select * into v_existing
    from public.ledger_references r
   where r.case_id = p_case_id and r.source = 'qbo' and r.realm_id = p_realm_id
     and r.object_type = p_object_type and r.object_id = p_object_id
     and r.object_version = p_object_version;
  if found then
    return jsonb_build_object('reference_id', v_existing.id, 'replayed', true);
  end if;
  v_id := gen_random_uuid();
  insert into public.ledger_references (
    id, environment_id, client_id, entity_id, case_id, source, realm_id,
    object_type, object_id, object_version, display_name, as_of, object_digest,
    adapter_name, recorded_at
  ) values (
    v_id, v_case.environment_id, v_case.client_id, v_case.entity_id, p_case_id, 'qbo', p_realm_id,
    p_object_type, p_object_id, p_object_version, p_display_name, p_as_of, p_object_digest,
    p_adapter_name, v_now
  );
  perform app_private.record_case_event(v_case, 'source.referenced', 'system', v_now);
  perform app_private.append_audit(
    null, v_case.environment_id, v_case.client_id, v_case.entity_id,
    'source.referenced', 'case:' || p_case_id::text,
    jsonb_build_object(
      'reference_id', v_id,
      'object_type', p_object_type,
      'object_id', p_object_id,
      'object_version', p_object_version,
      'adapter', p_adapter_name
    )
  );
  return jsonb_build_object('reference_id', v_id, 'replayed', false);
end;
$$;

/** A person files an approved, checked document to the record by hand and
 * says so: which document, which Drive object, and the exact bytes (the
 * document's digest). Intake or the preparer, at AAL2, on an APPROVED case
 * whose active approval covers that document. */
create function public.record_filing_receipt(
  p_environment_id uuid,
  p_client_id uuid,
  p_entity_id uuid,
  p_case_id uuid,
  p_case_version integer,
  p_document_id uuid,
  p_drive_file_id text,
  p_drive_path text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_case public.cases%rowtype;
  v_approval public.case_approvals%rowtype;
  v_package public.case_review_packages%rowtype;
  v_document public.document_uploads%rowtype;
  v_replay jsonb;
  v_role text;
  v_path text;
  v_id uuid;
  v_now timestamptz := now();
  v_result jsonb;
begin
  if p_idempotency_key is null then
    raise exception 'invalid_idempotency_key';
  end if;
  v_uid := app_private.staff_member_for_scope(
    p_environment_id, p_client_id, p_entity_id, array['intake', 'preparer']);
  v_replay := app_private.case_replay(v_uid, p_case_id, p_idempotency_key);
  if v_replay is not null then
    return v_replay;
  end if;
  v_case := app_private.lock_case_at(
    p_environment_id, p_client_id, p_entity_id, p_case_id, p_case_version);
  if v_case.status <> 'APPROVED' then
    raise exception 'case_not_approved';
  end if;
  select * into v_approval
    from public.case_approvals a
   where a.case_id = p_case_id and a.status = 'ACTIVE';
  if not found then
    raise exception 'case_not_approved';
  end if;
  select * into v_package from public.case_review_packages p where p.id = v_approval.package_id;

  select * into v_document
    from public.document_uploads d
   where d.id = p_document_id
     and d.case_id = p_case_id
     and d.environment_id = p_environment_id
     and d.client_id = p_client_id
     and d.entity_id = p_entity_id;
  if not found or v_document.status <> 'ACCEPTED' then
    raise exception 'document_not_filable';
  end if;
  -- Only evidence the approval covers is filed under it.
  if not (v_package.manifest -> 'documents') @> jsonb_build_array(jsonb_build_object('id', p_document_id)) then
    raise exception 'document_not_approved';
  end if;
  if p_drive_file_id is null or p_drive_file_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' then
    raise exception 'invalid_file_id';
  end if;
  -- The path is what a person typed: trimmed, and blank is nothing at all.
  v_path := btrim(p_drive_path);
  if v_path is null or char_length(v_path) not between 1 and 240
     or v_path ~ E'[\\x00-\\x1F\\x7F]' then
    raise exception 'invalid_path';
  end if;
  if exists (
    select 1 from public.filing_receipts f
     where f.document_id = p_document_id and f.drive_file_id = p_drive_file_id
  ) then
    raise exception 'receipt_exists';
  end if;
  select m.role into v_role
    from public.memberships m
   where m.user_id = v_uid
     and m.environment_id = p_environment_id
     and m.client_id = p_client_id
     and m.entity_id = p_entity_id
     and m.role in ('intake', 'preparer')
   order by m.role
   limit 1;

  v_id := gen_random_uuid();
  insert into public.filing_receipts (
    id, environment_id, client_id, entity_id, case_id, document_id, package_id,
    drive_file_id, drive_path, claimed_digest, filed_by, filed_role, filed_at,
    status, idempotency_key
  ) values (
    v_id, p_environment_id, p_client_id, p_entity_id, p_case_id, p_document_id, v_package.id,
    p_drive_file_id, v_path, v_document.client_digest, v_uid, v_role, v_now,
    'RECORDED', p_idempotency_key
  );
  perform app_private.record_case_event(v_case, 'record.filed', v_role, v_now);

  v_result := jsonb_build_object(
    'receipt_id', v_id,
    'status', 'RECORDED',
    'claimed_digest', v_document.client_digest,
    'package_id', v_package.id,
    'case_version', v_case.version
  );
  perform app_private.append_audit(
    v_uid, p_environment_id, p_client_id, p_entity_id,
    'record.filed', 'case:' || p_case_id::text,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'receipt_id', v_id,
      'document_id', p_document_id,
      'package_id', v_package.id,
      'role', v_role,
      'result', v_result
    )
  );
  return v_result;
end;
$$;

/** The adapter's read-only check of the record: the Drive object holds
 * the claimed bytes (VERIFIED) or it does not, or is not there (MISMATCH).
 * A settled receipt is returned as it stands. */
create function public.verify_filing_receipt(
  p_receipt_id uuid,
  p_found_digest text,
  p_adapter_name text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_receipt public.filing_receipts%rowtype;
  v_case public.cases%rowtype;
  v_status text;
  v_now timestamptz := now();
begin
  perform app_private.require_server_role();
  select * into v_receipt from public.filing_receipts f where f.id = p_receipt_id for update;
  if not found then
    raise exception 'receipt_not_found';
  end if;
  if v_receipt.status <> 'RECORDED' then
    return jsonb_build_object(
      'receipt_id', v_receipt.id, 'status', v_receipt.status, 'verified_at', v_receipt.verified_at,
      'replayed', true
    );
  end if;
  if p_found_digest is not null and p_found_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_digest';
  end if;
  v_status := case when p_found_digest = v_receipt.claimed_digest then 'VERIFIED' else 'MISMATCH' end;
  update public.filing_receipts
     set status = v_status, verified_at = v_now, found_digest = p_found_digest,
         adapter_name = p_adapter_name
   where id = v_receipt.id;
  select * into v_case from public.cases c where c.id = v_receipt.case_id;
  perform app_private.record_case_event(
    v_case, case when v_status = 'VERIFIED' then 'record.verified' else 'record.mismatch' end,
    'system', v_now);
  perform app_private.append_audit(
    null, v_receipt.environment_id, v_receipt.client_id, v_receipt.entity_id,
    case when v_status = 'VERIFIED' then 'record.verified' else 'record.mismatch' end,
    'case:' || v_receipt.case_id::text,
    jsonb_build_object(
      'receipt_id', v_receipt.id,
      'document_id', v_receipt.document_id,
      'status', v_status,
      'adapter', p_adapter_name
    )
  );
  return jsonb_build_object(
    'receipt_id', v_receipt.id, 'status', v_status, 'verified_at', v_now, 'replayed', false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges: the adapter interface for the server role alone;
-- the filing receipt for authenticated (the function decides who).
-- ---------------------------------------------------------------------------

revoke execute on function public.record_ledger_reference(uuid, text, text, text, text, text, timestamptz, text, text)
  from public, anon, authenticated;
grant execute on function public.record_ledger_reference(uuid, text, text, text, text, text, timestamptz, text, text)
  to service_role;

revoke execute on function public.record_filing_receipt(uuid, uuid, uuid, uuid, integer, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.record_filing_receipt(uuid, uuid, uuid, uuid, integer, uuid, text, text, uuid)
  to authenticated, service_role;

revoke execute on function public.verify_filing_receipt(uuid, text, text) from public, anon, authenticated;
grant execute on function public.verify_filing_receipt(uuid, text, text) to service_role;

revoke execute on function app_private.ledger_reference_guard() from public, anon, authenticated;
revoke execute on function app_private.filing_receipt_lifecycle() from public, anon, authenticated;
