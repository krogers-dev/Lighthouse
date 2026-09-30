-- Milestone 6 (WO-007): release controls.
--
-- Two controls the store release candidate needs, both server-decided:
--
--   1. The service kill switch. One public status row (open or paused, a
--      reason code, the minimum app version), readable by anyone through
--      one function, changed only by the server role with an idempotency
--      key and an append-only history. While paused, a restrictive policy
--      on every protected table (ANDed with the scope policies) returns
--      zero rows to every client and staff member, and the two helpers
--      every reviewed transition resolves its actor through refuse with
--      `service_paused`. Nothing is deleted or moved: source records and
--      audit history are preserved exactly (the brief: kill switches
--      preserve source records and audit history). The server-role
--      interfaces (scan, sweep, expiry, adapters, this switch) stay open
--      so operators can act.
--
--   2. Account deletion requests (a recorded release dependency). A
--      signed-in person asks for their access and sign-in account to be
--      deleted, with an idempotency key; may withdraw; the server role
--      completes it (memberships removed, the request kept as a record
--      with a pseudonymous subject reference, the auth user removed by
--      the operator tooling through the platform's admin API). Records
--      the firm holds for the business are not touched by any of this:
--      that separation is the retention explanation the screen carries.
--      Every step writes one audit receipt per scope the person held.
--
-- Both are provisional decisions under Kody's standing instruction,
-- recorded in security/APPROVALS.md.

-- ---------------------------------------------------------------------------
-- 1. Service status
-- ---------------------------------------------------------------------------

create table public.service_status (
  id integer primary key check (id = 1),
  state text not null check (state in ('open', 'paused')),
  reason_code text not null check (reason_code in ('none', 'maintenance', 'incident')),
  min_app_version text not null check (min_app_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  version integer not null default 1,
  changed_at timestamptz not null default now()
);

insert into public.service_status (id, state, reason_code, min_app_version)
values (1, 'open', 'none', '0.0.0');

create table public.service_status_changes (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  state text not null check (state in ('open', 'paused')),
  reason_code text not null check (reason_code in ('none', 'maintenance', 'incident')),
  min_app_version text not null,
  idempotency_key uuid not null unique,
  status_version integer not null
);

create trigger service_status_changes_append_only
  before update or delete on public.service_status_changes
  for each row execute function app_private.reject_mutation();

alter table public.service_status enable row level security;
alter table public.service_status_changes enable row level security;
-- No policies and no grants for client roles: the status reaches them only
-- through service_status_read(); the history is the server role's alone.

/** Whether the service is open. Evaluated inside policies as the calling
 * role, so client roles may execute it; it reads one public row and
 * nothing else. */
create function app_private.service_open()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.service_status s where s.id = 1 and s.state = 'open'
  )
$$;
revoke execute on function app_private.service_open() from public;
grant execute on function app_private.service_open() to anon, authenticated, service_role;

/** The status as the app reads it at boot and on foreground, before any
 * sign-in: state, reason, and the minimum app version. No user data. */
create function public.service_status_read()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'state', s.state,
    'reason_code', s.reason_code,
    'min_app_version', s.min_app_version,
    'version', s.version,
    'changed_at', s.changed_at
  )
  from public.service_status s where s.id = 1
$$;
revoke execute on function public.service_status_read() from public;
grant execute on function public.service_status_read() to anon, authenticated, service_role;

/** The switch. Server role only, and run AS the server role (not security
 * definer: require_server_role reads current_user, and service_role holds
 * the table privileges it needs); the same key replays the same result
 * and never writes twice; every change is appended to the history. */
create function public.set_service_state(
  p_state text,
  p_reason_code text,
  p_min_app_version text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_existing public.service_status_changes%rowtype;
  v_status public.service_status%rowtype;
  v_now timestamptz := now();
begin
  perform app_private.require_server_role();
  if p_idempotency_key is null then
    raise exception 'invalid_idempotency_key';
  end if;
  select * into v_existing
    from public.service_status_changes c where c.idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'state', v_existing.state, 'reason_code', v_existing.reason_code,
      'min_app_version', v_existing.min_app_version, 'version', v_existing.status_version,
      'replayed', true);
  end if;
  if p_state is null or p_state not in ('open', 'paused') then
    raise exception 'invalid_state';
  end if;
  if p_reason_code is null or p_reason_code not in ('none', 'maintenance', 'incident') then
    raise exception 'invalid_reason';
  end if;
  if p_min_app_version is null or p_min_app_version !~ '^[0-9]+\.[0-9]+\.[0-9]+$' then
    raise exception 'invalid_version';
  end if;
  update public.service_status
     set state = p_state, reason_code = p_reason_code, min_app_version = p_min_app_version,
         version = version + 1, changed_at = v_now
   where id = 1
   returning * into v_status;
  insert into public.service_status_changes (
    occurred_at, state, reason_code, min_app_version, idempotency_key, status_version
  ) values (
    v_now, p_state, p_reason_code, p_min_app_version, p_idempotency_key, v_status.version
  );
  return jsonb_build_object(
    'state', v_status.state, 'reason_code', v_status.reason_code,
    'min_app_version', v_status.min_app_version, 'version', v_status.version,
    'replayed', false);
end;
$$;
revoke execute on function public.set_service_state(text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.set_service_state(text, text, text, uuid) to service_role;

-- The gate: a restrictive layer on every protected table, for every
-- command, ANDed with the scope policies. Zero rows while paused; nothing
-- removed. audit_receipts carries no client policy at all and needs none.
create policy environments_service_open on public.environments
  as restrictive for all to authenticated
  using (app_private.service_open()) with check (app_private.service_open());
create policy clients_service_open on public.clients
  as restrictive for all to authenticated
  using (app_private.service_open()) with check (app_private.service_open());
create policy entities_service_open on public.entities
  as restrictive for all to authenticated
  using (app_private.service_open()) with check (app_private.service_open());
create policy memberships_service_open on public.memberships
  as restrictive for all to authenticated
  using (app_private.service_open()) with check (app_private.service_open());
create policy cases_service_open on public.cases
  as restrictive for all to authenticated
  using (app_private.service_open()) with check (app_private.service_open());
create policy case_attention_items_service_open on public.case_attention_items
  as restrictive for all to authenticated
  using (app_private.service_open()) with check (app_private.service_open());
create policy case_next_actions_service_open on public.case_next_actions
  as restrictive for all to authenticated
  using (app_private.service_open()) with check (app_private.service_open());
create policy requests_service_open on public.requests
  as restrictive for all to authenticated
  using (app_private.service_open()) with check (app_private.service_open());
create policy activity_events_service_open on public.activity_events
  as restrictive for all to authenticated
  using (app_private.service_open()) with check (app_private.service_open());
create policy document_uploads_service_open on public.document_uploads
  as restrictive for all to authenticated
  using (app_private.service_open()) with check (app_private.service_open());
create policy request_answers_service_open on public.request_answers
  as restrictive for all to authenticated
  using (app_private.service_open()) with check (app_private.service_open());
create policy request_answer_citations_service_open on public.request_answer_citations
  as restrictive for all to authenticated
  using (app_private.service_open()) with check (app_private.service_open());
create policy case_review_packages_service_open on public.case_review_packages
  as restrictive for all to authenticated
  using (app_private.service_open()) with check (app_private.service_open());
create policy case_reviews_service_open on public.case_reviews
  as restrictive for all to authenticated
  using (app_private.service_open()) with check (app_private.service_open());
create policy case_approvals_service_open on public.case_approvals
  as restrictive for all to authenticated
  using (app_private.service_open()) with check (app_private.service_open());
create policy ledger_references_service_open on public.ledger_references
  as restrictive for all to authenticated
  using (app_private.service_open()) with check (app_private.service_open());
create policy filing_receipts_service_open on public.filing_receipts
  as restrictive for all to authenticated
  using (app_private.service_open()) with check (app_private.service_open());

-- The two helpers every reviewed transition resolves its actor through
-- (WO-003 to WO-006) now refuse first when the service is paused. Bodies
-- otherwise verbatim from their migrations.
create or replace function app_private.client_user_for_scope(
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
  if not app_private.service_open() then
    raise exception 'service_paused';
  end if;
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

create or replace function app_private.staff_member_for_scope(
  p_environment_id uuid,
  p_client_id uuid,
  p_entity_id uuid,
  p_roles text[]
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
  if not app_private.service_open() then
    raise exception 'service_paused';
  end if;
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if (select coalesce(auth.jwt() ->> 'aal', 'aal1')) <> 'aal2' then
    raise exception 'staff act only at aal2' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.user_id = v_uid
      and m.environment_id = p_environment_id
      and m.client_id = p_client_id
      and m.entity_id = p_entity_id
      and m.role = any (p_roles)
  ) then
    raise exception 'no staff membership for this action in this scope' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Account deletion requests
-- ---------------------------------------------------------------------------

create table public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  -- Set null when the auth user is removed, so the record outlives the
  -- account it was about; subject_ref keeps a pseudonymous reference.
  user_id uuid references auth.users (id) on delete set null,
  subject_ref text not null,
  status text not null check (status in ('REQUESTED', 'WITHDRAWN', 'COMPLETED')),
  requested_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  completed_at timestamptz,
  idempotency_key uuid not null,
  withdraw_idempotency_key uuid,
  version integer not null default 1,
  unique (subject_ref, idempotency_key),
  check (
    (status = 'REQUESTED' and withdrawn_at is null and completed_at is null)
    or (status = 'WITHDRAWN' and withdrawn_at is not null and completed_at is null)
    or (status = 'COMPLETED' and completed_at is not null and withdrawn_at is null)
  )
);

create unique index account_deletion_requests_one_open
  on public.account_deletion_requests (subject_ref) where status = 'REQUESTED';
create index account_deletion_requests_user_idx
  on public.account_deletion_requests (user_id, requested_at desc);

/** One way only: REQUESTED -> WITHDRAWN | COMPLETED; the platform's set-null
 * of user_id on account removal is the only other change; never deleted. */
create function app_private.account_deletion_request_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'deletion requests are kept';
  end if;
  if new.subject_ref <> old.subject_ref or new.requested_at <> old.requested_at
     or new.idempotency_key <> old.idempotency_key then
    raise exception 'deletion requests are immutable';
  end if;
  if new.user_id is distinct from old.user_id and new.user_id is not null then
    raise exception 'deletion requests are immutable';
  end if;
  if new.status <> old.status then
    if old.status <> 'REQUESTED' then
      raise exception 'a settled deletion request does not change';
    end if;
    new.version := old.version + 1;
  elsif new.withdrawn_at is distinct from old.withdrawn_at
     or new.completed_at is distinct from old.completed_at then
    raise exception 'deletion requests are immutable';
  end if;
  return new;
end;
$$;

create trigger account_deletion_requests_guard
  before update or delete on public.account_deletion_requests
  for each row execute function app_private.account_deletion_request_guard();

alter table public.account_deletion_requests enable row level security;

-- A person reads their own requests; nobody writes the table directly.
-- Deliberately outside the service gate: a request already made stays
-- visible while the service is paused.
create policy account_deletion_requests_select_own
  on public.account_deletion_requests
  for select
  to authenticated
  using (user_id = (select auth.uid()));

grant select on public.account_deletion_requests to authenticated;

/** A signed-in person asks for their account to be deleted. Staff at
 * AAL2 only (a sensitive action); one open request at a time; the same
 * key replays the same request; one audit receipt per scope held. */
create function public.request_account_deletion(p_idempotency_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_existing public.account_deletion_requests%rowtype;
  v_id uuid;
  v_now timestamptz := now();
  v_scope record;
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
  if p_idempotency_key is null then
    raise exception 'invalid_idempotency_key';
  end if;
  select * into v_existing
    from public.account_deletion_requests r
   where r.subject_ref = 'user:' || v_uid::text and r.idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'request_id', v_existing.id, 'status', v_existing.status,
      'requested_at', v_existing.requested_at, 'replayed', true);
  end if;
  if exists (
    select 1 from public.account_deletion_requests r
     where r.subject_ref = 'user:' || v_uid::text and r.status = 'REQUESTED'
  ) then
    raise exception 'already_requested';
  end if;
  v_id := gen_random_uuid();
  insert into public.account_deletion_requests (
    id, user_id, subject_ref, status, requested_at, idempotency_key
  ) values (
    v_id, v_uid, 'user:' || v_uid::text, 'REQUESTED', v_now, p_idempotency_key
  );
  for v_scope in
    select distinct m.environment_id, m.client_id, m.entity_id
      from public.memberships m where m.user_id = v_uid
  loop
    perform app_private.append_audit(
      v_uid, v_scope.environment_id, v_scope.client_id, v_scope.entity_id,
      'account.deletion_requested', 'user:' || v_uid::text,
      jsonb_build_object('request_id', v_id, 'idempotency_key', p_idempotency_key,
                         'result', 'REQUESTED'));
  end loop;
  return jsonb_build_object(
    'request_id', v_id, 'status', 'REQUESTED', 'requested_at', v_now, 'replayed', false);
end;
$$;
revoke execute on function public.request_account_deletion(uuid) from public, anon;
grant execute on function public.request_account_deletion(uuid) to authenticated, service_role;

/** The person withdraws their open request. Same actor rules; the same
 * key replays; one audit receipt per scope held. */
create function public.withdraw_account_deletion(p_idempotency_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_open public.account_deletion_requests%rowtype;
  v_replayed public.account_deletion_requests%rowtype;
  v_now timestamptz := now();
  v_scope record;
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
  if p_idempotency_key is null then
    raise exception 'invalid_idempotency_key';
  end if;
  select * into v_replayed
    from public.account_deletion_requests r
   where r.subject_ref = 'user:' || v_uid::text
     and r.withdraw_idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'request_id', v_replayed.id, 'status', v_replayed.status,
      'withdrawn_at', v_replayed.withdrawn_at, 'replayed', true);
  end if;
  select * into v_open
    from public.account_deletion_requests r
   where r.subject_ref = 'user:' || v_uid::text and r.status = 'REQUESTED'
   for update;
  if not found then
    raise exception 'no_open_request';
  end if;
  update public.account_deletion_requests
     set status = 'WITHDRAWN', withdrawn_at = v_now, withdraw_idempotency_key = p_idempotency_key
   where id = v_open.id;
  for v_scope in
    select distinct m.environment_id, m.client_id, m.entity_id
      from public.memberships m where m.user_id = v_uid
  loop
    perform app_private.append_audit(
      v_uid, v_scope.environment_id, v_scope.client_id, v_scope.entity_id,
      'account.deletion_withdrawn', 'user:' || v_uid::text,
      jsonb_build_object('request_id', v_open.id, 'idempotency_key', p_idempotency_key,
                         'result', 'WITHDRAWN'));
  end loop;
  return jsonb_build_object(
    'request_id', v_open.id, 'status', 'WITHDRAWN', 'withdrawn_at', v_now, 'replayed', false);
end;
$$;
revoke execute on function public.withdraw_account_deletion(uuid) from public, anon;
grant execute on function public.withdraw_account_deletion(uuid) to authenticated, service_role;

/** The server role completes an open request: one audit receipt per scope
 * the person held, the memberships removed, the request marked. The auth
 * user itself is removed by the operator tooling through the platform's
 * admin API, which sets user_id null here and leaves the record. Nothing
 * the firm holds for the business is touched. */
create function public.complete_account_deletion(p_user_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_open public.account_deletion_requests%rowtype;
  v_now timestamptz := now();
  v_scope record;
  v_removed integer;
begin
  perform app_private.require_server_role();
  if p_user_id is null then
    raise exception 'invalid_user';
  end if;
  select * into v_open
    from public.account_deletion_requests r
   where r.subject_ref = 'user:' || p_user_id::text and r.status = 'REQUESTED'
   for update;
  if not found then
    raise exception 'no_open_request';
  end if;
  for v_scope in
    select distinct m.environment_id, m.client_id, m.entity_id
      from public.memberships m where m.user_id = p_user_id
  loop
    perform app_private.append_audit(
      null, v_scope.environment_id, v_scope.client_id, v_scope.entity_id,
      'account.deletion_completed', 'user:' || p_user_id::text,
      jsonb_build_object('request_id', v_open.id, 'result', 'COMPLETED'));
  end loop;
  delete from public.memberships where user_id = p_user_id;
  get diagnostics v_removed = row_count;
  update public.account_deletion_requests
     set status = 'COMPLETED', completed_at = v_now
   where id = v_open.id;
  return jsonb_build_object(
    'request_id', v_open.id, 'status', 'COMPLETED', 'completed_at', v_now,
    'memberships_removed', v_removed);
end;
$$;
revoke execute on function public.complete_account_deletion(uuid) from public, anon, authenticated;
grant execute on function public.complete_account_deletion(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Records outlive the accounts that made them
-- ---------------------------------------------------------------------------
-- The record tables keep who acted as a uuid (documents received, answers
-- given, packages frozen, verdicts, approvals, filings). Until now each of
-- those columns was a foreign key into auth.users, which made deleting an
-- account impossible while any record it made existed: the platform would
-- refuse the delete. Retention separates the two on purpose (PRODUCT.md:
-- access deletion versus records retained under an approved basis), so
-- the columns stay NOT NULL and keep their value as a pseudonymous
-- reference, and the constraints go. Memberships (access) still cascade
-- away with the account; audit receipts never referenced auth.users.
alter table public.document_uploads drop constraint document_uploads_created_by_fkey;
alter table public.request_answers drop constraint request_answers_created_by_fkey;
alter table public.case_review_packages drop constraint case_review_packages_frozen_by_fkey;
alter table public.case_reviews drop constraint case_reviews_reviewer_user_id_fkey;
alter table public.case_approvals drop constraint case_approvals_approver_user_id_fkey;
alter table public.filing_receipts drop constraint filing_receipts_filed_by_fkey;
