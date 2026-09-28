-- Milestone 2: controlled document request (WO-003).
--
-- A client user answers an OPEN request with a document. The document is
-- picked with the system picker, checked and digested on the phone,
-- transferred into a PRIVATE quarantine bucket, and held there until a
-- privileged scan records a verdict. Nothing here files anything, and no
-- document ever becomes evidence on its own: an ACCEPTED upload is a HIVE
-- evidence REFERENCE; Google Drive stays the permanent record and filing
-- stays manual (PRODUCT.md, "Upload lifecycle").
--
-- Server lifecycle of one upload row (the device-side SELECTED state has
-- no row yet; a row exists from the moment a path is reserved):
--
--   UPLOADING -> QUARANTINED -> VALIDATING -> ACCEPTED | REJECTED
--        \             \             \
--         `-> EXPIRED   `-> EXPIRED   `-> EXPIRED
--
-- Every transition is a reviewed server function; the mobile app holds
-- SELECT on the table and nothing else, and the storage bucket accepts
-- exactly one INSERT per reserved path from the client user who reserved
-- it: no read-back, no listing, no overwrite, no delete. The protected
-- mutation contract of the brief is met by begin_document_upload:
-- idempotency key, object version (the request's), exact scope triple,
-- server time, atomic audit receipt.

-- ---------------------------------------------------------------------------
-- requests: a version for the protected-mutation contract, a composite key
-- so a document can never point at a request outside its own scope, and
-- the scope-immutability trigger the Milestone 0 tables carry.
-- ---------------------------------------------------------------------------

alter table public.requests add column version integer not null default 1;

alter table public.requests
  add constraint requests_scope_id_key unique (environment_id, client_id, entity_id, id);

create function app_private.bump_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.version := old.version + 1;
  return new;
end;
$$;

create trigger requests_version_bump
  before update on public.requests
  for each row execute function app_private.bump_version();

create trigger requests_scope_immutable
  before update on public.requests
  for each row execute function app_private.reject_scope_change();

-- ---------------------------------------------------------------------------
-- activity_events: four enumerated document kinds. Still no free text: a
-- document's name never enters the activity trail (threat T3).
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
    'document.expired'
  )
);

-- ---------------------------------------------------------------------------
-- document_uploads: one row per document transfer, PROTECTED and scoped
-- exactly like requests. Limits are constraints, not conventions.
-- ---------------------------------------------------------------------------

create table public.document_uploads (
  id uuid primary key default gen_random_uuid(),
  environment_id uuid not null,
  client_id uuid not null,
  entity_id uuid not null,
  case_id uuid not null,
  request_id uuid not null,
  -- The client user who reserved the path. The storage policy binds the
  -- one permitted INSERT to this user, and completion re-asserts it.
  created_by uuid not null references auth.users (id),
  idempotency_key uuid not null,
  status text not null default 'UPLOADING' check (
    status in ('UPLOADING', 'QUARANTINED', 'VALIDATING', 'ACCEPTED', 'REJECTED', 'EXPIRED')
  ),
  -- The name the client chose to show. Bounded and printable; it appears
  -- on the request only, never in activity, audit details, or a log.
  display_name text not null check (
    char_length(display_name) between 1 and 120 and display_name !~ '[[:cntrl:]]'
  ),
  mime_type text not null check (
    mime_type in ('application/pdf', 'image/png', 'image/jpeg', 'text/csv')
  ),
  byte_size bigint not null check (byte_size > 0 and byte_size <= 20971520),
  -- SHA-256 of the bytes as the phone read them, hex. The scan recomputes
  -- it over what actually arrived; a mismatch is a rejection, not a guess.
  client_digest text not null check (client_digest ~ '^[0-9a-f]{64}$'),
  storage_bucket text not null default 'hive-quarantine' check (storage_bucket = 'hive-quarantine'),
  storage_path text not null unique,
  version integer not null default 1,
  received_at timestamptz,
  checked_at timestamptz,
  -- UPLOADING: the transfer window. QUARANTINED / VALIDATING: retention.
  expires_at timestamptz not null,
  rejection_reason text check (
    rejection_reason is null
    or rejection_reason in (
      'digest_mismatch', 'size_mismatch', 'unsupported_content', 'malware_detected', 'scan_failed'
    )
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, created_by, idempotency_key),
  foreign key (environment_id, client_id, entity_id, case_id)
    references public.cases (environment_id, client_id, entity_id, id),
  foreign key (environment_id, client_id, entity_id, request_id)
    references public.requests (environment_id, client_id, entity_id, id),
  constraint document_uploads_reason_iff_rejected
    check ((status = 'REJECTED') = (rejection_reason is not null)),
  constraint document_uploads_received_once_past_upload
    check (status in ('UPLOADING', 'EXPIRED') or received_at is not null),
  constraint document_uploads_checked_when_final
    check (status not in ('ACCEPTED', 'REJECTED') or checked_at is not null)
);

create index document_uploads_scope_idx
  on public.document_uploads (environment_id, client_id, entity_id);
create index document_uploads_request_idx
  on public.document_uploads (request_id, created_at desc);
create index document_uploads_sweep_idx
  on public.document_uploads (status, expires_at);

grant select on public.document_uploads to authenticated;

alter table public.document_uploads enable row level security;

create policy document_uploads_select_by_membership
  on public.document_uploads
  for select
  to authenticated
  using (
    exists (
      select 1 from public.memberships m
      where m.user_id = (select auth.uid())
        and m.environment_id = document_uploads.environment_id
        and m.client_id = document_uploads.client_id
        and m.entity_id = document_uploads.entity_id
    )
  );

create policy document_uploads_staff_requires_aal2
  on public.document_uploads
  as restrictive
  for select
  to authenticated
  using (
    (select coalesce(auth.jwt() ->> 'aal', 'aal1')) = 'aal2'
    or not exists (
      select 1 from public.memberships s
      where s.user_id = (select auth.uid()) and s.role <> 'client_user'
    )
  );

create trigger document_uploads_scope_immutable
  before update on public.document_uploads
  for each row execute function app_private.reject_scope_change();

-- The lifecycle, enforced where every write lands. Identity columns are
-- immutable after insert; finished rows are immutable entirely; each
-- update bumps the version and the server timestamp.
create function app_private.document_upload_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.request_id <> old.request_id
     or new.case_id <> old.case_id
     or new.created_by <> old.created_by
     or new.idempotency_key <> old.idempotency_key
     or new.display_name <> old.display_name
     or new.mime_type <> old.mime_type
     or new.byte_size <> old.byte_size
     or new.client_digest <> old.client_digest
     or new.storage_bucket <> old.storage_bucket
     or new.storage_path <> old.storage_path
     or new.created_at <> old.created_at then
    raise exception 'document upload identity is immutable';
  end if;
  if new.status <> old.status then
    if not (
      (old.status = 'UPLOADING' and new.status in ('QUARANTINED', 'EXPIRED'))
      or (old.status = 'QUARANTINED' and new.status in ('VALIDATING', 'EXPIRED'))
      or (old.status = 'VALIDATING' and new.status in ('ACCEPTED', 'REJECTED', 'EXPIRED'))
    ) then
      raise exception 'illegal document upload transition % -> %', old.status, new.status;
    end if;
  elsif old.status in ('ACCEPTED', 'REJECTED', 'EXPIRED') then
    raise exception 'a finished document upload is immutable';
  end if;
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

create trigger document_uploads_lifecycle
  before update on public.document_uploads
  for each row execute function app_private.document_upload_lifecycle();

-- ---------------------------------------------------------------------------
-- The one permitted actor: a CLIENT USER acting inside an exact scope.
-- Staff never upload (the control is absent from their screens and the
-- server refuses them anyway), and a user who holds any staff membership
-- acts only at AAL2, the same rule RLS applies to every read.
-- ---------------------------------------------------------------------------

create function app_private.client_user_for_scope(
  p_environment_id uuid,
  p_client_id uuid,
  p_entity_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if exists (
       select 1 from public.memberships s where s.user_id = v_uid and s.role <> 'client_user'
     )
     and (select coalesce(auth.jwt() ->> 'aal', 'aal1')) <> 'aal2' then
    raise exception 'staff act only at aal2' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.user_id = v_uid
      and m.environment_id = p_environment_id
      and m.client_id = p_client_id
      and m.entity_id = p_entity_id
      and m.role = 'client_user'
  ) then
    raise exception 'no client membership in this scope' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- Client-callable transitions. Refusals other than authorization carry a
-- stable token as the message (SQLSTATE P0001), which the app maps to
-- client wording; authorization failures are 42501 (HTTP 403) exactly like
-- a denied read, so a foreign scope never learns more than "denied".
-- ---------------------------------------------------------------------------

create function public.begin_document_upload(
  p_environment_id uuid,
  p_client_id uuid,
  p_entity_id uuid,
  p_request_id uuid,
  p_request_version integer,
  p_idempotency_key uuid,
  p_display_name text,
  p_mime_type text,
  p_byte_size bigint,
  p_client_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_request public.requests%rowtype;
  v_existing public.document_uploads%rowtype;
  v_live integer;
  v_id uuid;
  v_path text;
  v_expires timestamptz;
begin
  v_uid := app_private.client_user_for_scope(p_environment_id, p_client_id, p_entity_id);

  -- Idempotent: the same key from the same actor on the same request
  -- returns the same reservation and writes nothing.
  select * into v_existing
    from public.document_uploads u
   where u.request_id = p_request_id
     and u.created_by = v_uid
     and u.idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'upload_id', v_existing.id,
      'storage_bucket', v_existing.storage_bucket,
      'storage_path', v_existing.storage_path,
      'status', v_existing.status,
      'expires_at', v_existing.expires_at
    );
  end if;

  select * into v_request
    from public.requests r
   where r.id = p_request_id
     and r.environment_id = p_environment_id
     and r.client_id = p_client_id
     and r.entity_id = p_entity_id
     for update;
  if not found then
    raise exception 'request_not_found';
  end if;
  if v_request.status <> 'OPEN' then
    raise exception 'request_closed';
  end if;
  if v_request.version <> p_request_version then
    raise exception 'request_changed';
  end if;
  if p_mime_type is null
     or p_mime_type not in ('application/pdf', 'image/png', 'image/jpeg', 'text/csv') then
    raise exception 'unsupported_type';
  end if;
  if p_byte_size is null or p_byte_size <= 0 then
    raise exception 'empty_file';
  end if;
  if p_byte_size > 20971520 then
    raise exception 'file_too_large';
  end if;
  if p_client_digest is null or p_client_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_digest';
  end if;
  if p_display_name is null
     or char_length(p_display_name) < 1
     or char_length(p_display_name) > 120
     or p_display_name ~ '[[:cntrl:]]' then
    raise exception 'invalid_name';
  end if;
  if p_idempotency_key is null then
    raise exception 'invalid_idempotency_key';
  end if;

  -- Ten documents per request: everything received or accepted counts,
  -- and so does a transfer still inside its window.
  select count(*) into v_live
    from public.document_uploads u
   where u.request_id = p_request_id
     and (
       u.status in ('QUARANTINED', 'VALIDATING', 'ACCEPTED')
       or (u.status = 'UPLOADING' and u.expires_at > now())
     );
  if v_live >= 10 then
    raise exception 'too_many_documents';
  end if;

  v_id := gen_random_uuid();
  v_path := p_environment_id::text || '/' || p_client_id::text || '/' || p_entity_id::text
            || '/' || p_request_id::text || '/' || v_id::text;
  v_expires := now() + interval '24 hours';

  insert into public.document_uploads (
    id, environment_id, client_id, entity_id, case_id, request_id, created_by,
    idempotency_key, status, display_name, mime_type, byte_size, client_digest,
    storage_bucket, storage_path, expires_at
  ) values (
    v_id, p_environment_id, p_client_id, p_entity_id, v_request.case_id, p_request_id, v_uid,
    p_idempotency_key, 'UPLOADING', p_display_name, p_mime_type, p_byte_size, p_client_digest,
    'hive-quarantine', v_path, v_expires
  );

  perform app_private.append_audit(
    v_uid, p_environment_id, p_client_id, p_entity_id,
    'document.upload_begun', 'upload:' || v_id::text,
    jsonb_build_object(
      'request_id', p_request_id,
      'request_version', p_request_version,
      'byte_size', p_byte_size,
      'mime_type', p_mime_type
    )
  );

  return jsonb_build_object(
    'upload_id', v_id,
    'storage_bucket', 'hive-quarantine',
    'storage_path', v_path,
    'status', 'UPLOADING',
    'expires_at', v_expires
  );
end;
$$;

create function public.complete_document_upload(p_upload_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.document_uploads%rowtype;
  v_metadata jsonb;
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select * into v_row from public.document_uploads u where u.id = p_upload_id for update;
  if not found or v_row.created_by <> v_uid then
    -- Someone else's reservation and a nonexistent one look the same.
    raise exception 'upload not found' using errcode = '42501';
  end if;
  perform app_private.client_user_for_scope(v_row.environment_id, v_row.client_id, v_row.entity_id);

  if v_row.status <> 'UPLOADING' then
    if v_row.status = 'EXPIRED' then
      raise exception 'transfer_expired';
    end if;
    -- Already completed: say so, change nothing.
    return jsonb_build_object(
      'upload_id', v_row.id, 'status', v_row.status, 'received_at', v_row.received_at
    );
  end if;
  if v_row.expires_at <= v_now then
    raise exception 'transfer_expired';
  end if;

  -- The object must actually be there, in this bucket, at exactly the
  -- reserved path, with exactly the declared size. The storage service
  -- records size and mimetype in the object's metadata on every upload.
  select o.metadata into v_metadata
    from storage.objects o
   where o.bucket_id = v_row.storage_bucket and o.name = v_row.storage_path;
  if not found then
    raise exception 'transfer_incomplete';
  end if;
  if (v_metadata ->> 'size') is null or (v_metadata ->> 'size')::bigint <> v_row.byte_size then
    raise exception 'size_mismatch';
  end if;

  update public.document_uploads
     set status = 'QUARANTINED',
         received_at = v_now,
         expires_at = v_now + interval '30 days'
   where id = p_upload_id;

  insert into public.activity_events (
    environment_id, client_id, entity_id, case_id, event_kind, actor_role, occurred_at
  ) values (
    v_row.environment_id, v_row.client_id, v_row.entity_id, v_row.case_id,
    'document.received', 'client_user', v_now
  );

  perform app_private.append_audit(
    v_uid, v_row.environment_id, v_row.client_id, v_row.entity_id,
    'document.received', 'upload:' || v_row.id::text,
    jsonb_build_object(
      'request_id', v_row.request_id, 'byte_size', v_row.byte_size, 'mime_type', v_row.mime_type
    )
  );

  return jsonb_build_object('upload_id', v_row.id, 'status', 'QUARANTINED', 'received_at', v_now);
end;
$$;

-- ---------------------------------------------------------------------------
-- The privileged scan interface: reachable only by the server role. There
-- is no real scanner yet (HOLD until Kody approves one); the local lane
-- runs a NAMED SYNTHETIC scanner that recomputes the digest and size over
-- what arrived and refuses a planted synthetic marker. Whatever scans, it
-- speaks to the database only through these two functions and the sweep.
--
-- These three run as their CALLER, not as a definer: the server role holds
-- every table privilege and bypasses RLS on every lane, so it needs no
-- borrowed authority, and a caller-privilege function cannot be turned
-- into an escalation path if a grant is ever widened by mistake. The
-- execute grant below is the gate; require_server_role is the belt to
-- that brace, and it reads the role the connection actually runs as.
-- ---------------------------------------------------------------------------

create function app_private.require_server_role()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if current_user <> 'service_role'
     and not coalesce(
       (select r.rolsuper from pg_catalog.pg_roles r where r.rolname = current_user), false
     ) then
    raise exception 'server role required' using errcode = '42501';
  end if;
end;
$$;

create function public.begin_document_scan(p_upload_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_row public.document_uploads%rowtype;
begin
  perform app_private.require_server_role();
  select * into v_row from public.document_uploads u where u.id = p_upload_id for update;
  if not found then
    raise exception 'upload_not_found';
  end if;
  if v_row.status = 'VALIDATING' then
    return jsonb_build_object('upload_id', v_row.id, 'status', v_row.status);
  end if;
  if v_row.status <> 'QUARANTINED' then
    raise exception 'not_in_quarantine';
  end if;
  update public.document_uploads set status = 'VALIDATING' where id = p_upload_id;
  perform app_private.append_audit(
    null, v_row.environment_id, v_row.client_id, v_row.entity_id,
    'document.scan_begun', 'upload:' || v_row.id::text,
    jsonb_build_object('request_id', v_row.request_id)
  );
  return jsonb_build_object('upload_id', v_row.id, 'status', 'VALIDATING');
end;
$$;

create function public.record_document_scan(
  p_upload_id uuid,
  p_verdict text,
  p_reason text default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_row public.document_uploads%rowtype;
  v_now timestamptz := now();
  v_kind text;
  v_status text;
begin
  perform app_private.require_server_role();
  if p_verdict is null or p_verdict not in ('accepted', 'rejected') then
    raise exception 'invalid_verdict';
  end if;
  if p_verdict = 'rejected' and (
       p_reason is null
       or p_reason not in (
         'digest_mismatch', 'size_mismatch', 'unsupported_content', 'malware_detected', 'scan_failed'
       )
     ) then
    raise exception 'invalid_reason';
  end if;
  if p_verdict = 'accepted' and p_reason is not null then
    raise exception 'invalid_reason';
  end if;
  select * into v_row from public.document_uploads u where u.id = p_upload_id for update;
  if not found then
    raise exception 'upload_not_found';
  end if;
  if v_row.status <> 'VALIDATING' then
    raise exception 'not_validating';
  end if;

  if p_verdict = 'accepted' then
    update public.document_uploads
       set status = 'ACCEPTED', checked_at = v_now
     where id = p_upload_id;
    v_kind := 'document.checked';
    v_status := 'ACCEPTED';
  else
    update public.document_uploads
       set status = 'REJECTED', checked_at = v_now, rejection_reason = p_reason
     where id = p_upload_id;
    v_kind := 'document.not_accepted';
    v_status := 'REJECTED';
  end if;

  insert into public.activity_events (
    environment_id, client_id, entity_id, case_id, event_kind, actor_role, occurred_at
  ) values (
    v_row.environment_id, v_row.client_id, v_row.entity_id, v_row.case_id, v_kind, 'system', v_now
  );
  perform app_private.append_audit(
    null, v_row.environment_id, v_row.client_id, v_row.entity_id,
    v_kind, 'upload:' || v_row.id::text,
    jsonb_build_object('request_id', v_row.request_id, 'verdict', p_verdict, 'reason', p_reason)
  );
  return jsonb_build_object('upload_id', v_row.id, 'status', v_status, 'checked_at', v_now);
end;
$$;

-- The expiry sweep. A transfer that never completed is simply expired; a
-- received document past its quarantine retention is expired AND told to
-- the client through the activity trail.
create function public.expire_stale_document_uploads()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_row public.document_uploads%rowtype;
  v_count integer := 0;
  v_now timestamptz := now();
begin
  perform app_private.require_server_role();
  for v_row in
    select * from public.document_uploads u
     where u.status in ('UPLOADING', 'QUARANTINED', 'VALIDATING')
       and u.expires_at <= v_now
     order by u.created_at
     for update
  loop
    update public.document_uploads set status = 'EXPIRED' where id = v_row.id;
    if v_row.status <> 'UPLOADING' then
      insert into public.activity_events (
        environment_id, client_id, entity_id, case_id, event_kind, actor_role, occurred_at
      ) values (
        v_row.environment_id, v_row.client_id, v_row.entity_id, v_row.case_id,
        'document.expired', 'system', v_now
      );
    end if;
    perform app_private.append_audit(
      null, v_row.environment_id, v_row.client_id, v_row.entity_id,
      'document.expired', 'upload:' || v_row.id::text,
      jsonb_build_object('request_id', v_row.request_id, 'from_status', v_row.status)
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges: nothing is callable by default. The two client
-- transitions are callable by authenticated users (the functions decide
-- who among them); the scan interface and the sweep by the server role
-- alone. app_private stays unexposed exactly as the grants migration left
-- it, so client_user_for_scope and require_server_role have no API at all.
-- ---------------------------------------------------------------------------

revoke execute on function public.begin_document_upload(uuid, uuid, uuid, uuid, integer, uuid, text, text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.begin_document_upload(uuid, uuid, uuid, uuid, integer, uuid, text, text, bigint, text)
  to authenticated, service_role;

revoke execute on function public.complete_document_upload(uuid) from public, anon, authenticated;
grant execute on function public.complete_document_upload(uuid) to authenticated, service_role;

revoke execute on function public.begin_document_scan(uuid) from public, anon, authenticated;
grant execute on function public.begin_document_scan(uuid) to service_role;

revoke execute on function public.record_document_scan(uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_document_scan(uuid, text, text) to service_role;

revoke execute on function public.expire_stale_document_uploads() from public, anon, authenticated;
grant execute on function public.expire_stale_document_uploads() to service_role;

revoke execute on function app_private.client_user_for_scope(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function app_private.require_server_role() from public, anon, authenticated;
-- The three caller-privilege server functions call this belt-and-brace check
-- as the server role, which therefore needs to execute it.
grant execute on function app_private.require_server_role() to service_role;
revoke execute on function app_private.bump_version() from public, anon, authenticated;
revoke execute on function app_private.document_upload_lifecycle() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The quarantine bucket: private, bounded, and writable exactly once per
-- reserved path by the client user who reserved it. No policy grants
-- SELECT, UPDATE, or DELETE to any client role, so a client can never read
-- a quarantined object back, list the bucket, overwrite an object, or
-- remove one; the storage service refuses each of those at RLS.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'hive-quarantine',
  'hive-quarantine',
  false,
  20971520,
  array['application/pdf', 'image/png', 'image/jpeg', 'text/csv']
)
on conflict (id) do nothing;

create policy hive_quarantine_insert_reserved_path
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'hive-quarantine'
    and exists (
      select 1
        from public.document_uploads u
       where u.storage_bucket = 'hive-quarantine'
         and u.storage_path = storage.objects.name
         and u.status = 'UPLOADING'
         and u.expires_at > now()
         and u.created_by = (select auth.uid())
         and exists (
           select 1 from public.memberships m
            where m.user_id = (select auth.uid())
              and m.environment_id = u.environment_id
              and m.client_id = u.client_id
              and m.entity_id = u.entity_id
              and m.role = 'client_user'
         )
         and (
           (select coalesce(auth.jwt() ->> 'aal', 'aal1')) = 'aal2'
           or not exists (
             select 1 from public.memberships s
              where s.user_id = (select auth.uid()) and s.role <> 'client_user'
           )
         )
    )
  );
