-- Milestone 4: internal review and approval (WO-005).
--
-- A case's evidence is frozen into a review package by its preparer; a
-- conflict-free reviewer reads it and records exactly one of PASS,
-- RETURN, or HOLD; a conflict-free approver approves the exact package,
-- and the approval is bound to the actor, the role, the scope, the
-- package's digest and number, the case version, a destination, and an
-- expiry. Material change (a new package, the case reopened) supersedes
-- an approval; time expires it. An approval is a HIVE workflow record:
-- not a release, a reconciliation, a completion, or a filing
-- (PRODUCT.md), and nothing here touches the ledger or the record.
--
-- Every transition is a reviewed server function under the
-- protected-mutation contract (idempotency key, object version, exact
-- scope, server time, atomic audit receipt), runs as security definer,
-- re-derives the actor from auth.uid(), requires AAL2 and the exact role
-- membership in the exact scope, checks conflicts, and fails closed. The
-- three new tables are staff read surfaces at AAL2 (SELECT only, and
-- only through a staff membership in the row's own scope); clients hold
-- nothing on them and learn of the workflow through the case status and
-- the enumerated activity trail alone. Attention items and next actions
-- are not authored here: their wording is a communication contract.

-- ---------------------------------------------------------------------------
-- cases: an object version, so every transition names the state it read.
-- ---------------------------------------------------------------------------

alter table public.cases add column version integer not null default 1;

create trigger cases_version_bump
  before update on public.cases
  for each row execute function app_private.bump_version();

-- ---------------------------------------------------------------------------
-- activity_events: the case workflow's enumerated kinds. Still no free
-- text: a verdict's note never enters the trail (threat T3).
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
    'case.approval_expired'
  )
);

-- ---------------------------------------------------------------------------
-- case_review_packages: the frozen evidence. Immutable once frozen except
-- for being superseded by the next package.
-- ---------------------------------------------------------------------------

create table public.case_review_packages (
  id uuid primary key default gen_random_uuid(),
  environment_id uuid not null,
  client_id uuid not null,
  entity_id uuid not null,
  case_id uuid not null,
  package_number integer not null check (package_number >= 1),
  -- The manifest: the case's requests with their status and version, its
  -- submitted answers by id, version, and text digest, and its checked
  -- documents by id, digest, and size. Ids and digests only; no text.
  manifest jsonb not null,
  manifest_digest text not null check (manifest_digest ~ '^[0-9a-f]{64}$'),
  case_version integer not null,
  frozen_by uuid not null references auth.users (id),
  frozen_role text not null check (frozen_role = 'preparer'),
  frozen_at timestamptz not null default now(),
  superseded_at timestamptz,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  unique (case_id, package_number),
  unique (case_id, frozen_by, idempotency_key),
  unique (environment_id, client_id, entity_id, id),
  foreign key (environment_id, client_id, entity_id, case_id)
    references public.cases (environment_id, client_id, entity_id, id)
);

create unique index case_review_packages_current_idx
  on public.case_review_packages (case_id) where superseded_at is null;
create index case_review_packages_scope_idx
  on public.case_review_packages (environment_id, client_id, entity_id);

create function app_private.case_review_package_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.superseded_at is not null then
    raise exception 'a superseded package is immutable';
  end if;
  if new.id <> old.id
     or new.case_id <> old.case_id
     or new.package_number <> old.package_number
     or new.manifest <> old.manifest
     or new.manifest_digest <> old.manifest_digest
     or new.case_version <> old.case_version
     or new.frozen_by <> old.frozen_by
     or new.frozen_role <> old.frozen_role
     or new.frozen_at <> old.frozen_at
     or new.idempotency_key <> old.idempotency_key
     or new.created_at <> old.created_at then
    raise exception 'a frozen package is immutable';
  end if;
  return new;
end;
$$;

create trigger case_review_packages_scope_immutable
  before update on public.case_review_packages
  for each row execute function app_private.reject_scope_change();
create trigger case_review_packages_guard
  before update on public.case_review_packages
  for each row execute function app_private.case_review_package_guard();

-- ---------------------------------------------------------------------------
-- case_reviews: one verdict per role per package. A reviewer's review is
-- started (the case moves to IN_REVIEW) and then recorded; an approver's
-- RETURN or HOLD on a passed package is recorded in one step.
-- ---------------------------------------------------------------------------

create table public.case_reviews (
  id uuid primary key default gen_random_uuid(),
  environment_id uuid not null,
  client_id uuid not null,
  entity_id uuid not null,
  case_id uuid not null,
  package_id uuid not null,
  reviewer_user_id uuid not null references auth.users (id),
  reviewer_role text not null check (reviewer_role in ('reviewer', 'approver')),
  status text not null default 'IN_PROGRESS' check (status in ('IN_PROGRESS', 'RECORDED')),
  verdict text check (verdict in ('PASS', 'RETURN', 'HOLD')),
  -- Staff-written free text on a staff-only row: bounded, printable, and
  -- shown to staff of the scope only. Never in activity or audit details.
  note text not null default '' check (
    char_length(note) <= 2000
    and note !~ E'[\\x01-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]'
  ),
  started_at timestamptz not null default now(),
  recorded_at timestamptz,
  start_key uuid not null,
  idempotency_key uuid,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (package_id, reviewer_role),
  unique (environment_id, client_id, entity_id, id),
  foreign key (environment_id, client_id, entity_id, case_id)
    references public.cases (environment_id, client_id, entity_id, id),
  foreign key (environment_id, client_id, entity_id, package_id)
    references public.case_review_packages (environment_id, client_id, entity_id, id),
  constraint case_reviews_recorded_iff
    check ((status = 'RECORDED') = (verdict is not null)),
  constraint case_reviews_recorded_at_iff
    check ((status = 'RECORDED') = (recorded_at is not null)),
  constraint case_reviews_recorded_key_iff
    check ((status = 'RECORDED') = (idempotency_key is not null))
);

create index case_reviews_scope_idx
  on public.case_reviews (environment_id, client_id, entity_id);
create index case_reviews_package_idx on public.case_reviews (package_id);

create function app_private.case_review_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.case_id <> old.case_id
     or new.package_id <> old.package_id
     or new.reviewer_user_id <> old.reviewer_user_id
     or new.reviewer_role <> old.reviewer_role
     or new.started_at <> old.started_at
     or new.start_key <> old.start_key
     or new.created_at <> old.created_at then
    raise exception 'case review identity is immutable';
  end if;
  if old.status = 'RECORDED' then
    raise exception 'a recorded verdict is immutable';
  end if;
  if new.status <> old.status and not (old.status = 'IN_PROGRESS' and new.status = 'RECORDED') then
    raise exception 'illegal case review transition % -> %', old.status, new.status;
  end if;
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

create trigger case_reviews_scope_immutable
  before update on public.case_reviews
  for each row execute function app_private.reject_scope_change();
create trigger case_reviews_lifecycle
  before update on public.case_reviews
  for each row execute function app_private.case_review_lifecycle();

-- ---------------------------------------------------------------------------
-- case_approvals: the binding. Everything an approval is bound to is a
-- column, immutable from insert; the only movement is ACTIVE ending by
-- expiry or supersession.
-- ---------------------------------------------------------------------------

create table public.case_approvals (
  id uuid primary key default gen_random_uuid(),
  environment_id uuid not null,
  client_id uuid not null,
  entity_id uuid not null,
  case_id uuid not null,
  package_id uuid not null,
  approver_user_id uuid not null references auth.users (id),
  approver_role text not null default 'approver' check (approver_role = 'approver'),
  package_number integer not null,
  package_digest text not null check (package_digest ~ '^[0-9a-f]{64}$'),
  case_version integer not null,
  -- The HIVE workflow record is the only destination an approval may
  -- name in this milestone. Drive filing, delivery, or anything external
  -- is a destination of its own, added here only with its own approval.
  destination text not null check (destination in ('hive-record')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'EXPIRED', 'SUPERSEDED')),
  approved_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  end_reason text check (end_reason in ('expired', 'package_superseded', 'case_reopened')),
  idempotency_key uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (package_id, approver_user_id, idempotency_key),
  unique (environment_id, client_id, entity_id, id),
  foreign key (environment_id, client_id, entity_id, case_id)
    references public.cases (environment_id, client_id, entity_id, id),
  foreign key (environment_id, client_id, entity_id, package_id)
    references public.case_review_packages (environment_id, client_id, entity_id, id),
  constraint case_approvals_active_open check ((status = 'ACTIVE') = (ended_at is null)),
  constraint case_approvals_end_reason_iff check ((status = 'ACTIVE') = (end_reason is null)),
  constraint case_approvals_expiry_after check (expires_at > approved_at)
);

create unique index case_approvals_active_idx
  on public.case_approvals (package_id) where status = 'ACTIVE';
create index case_approvals_scope_idx
  on public.case_approvals (environment_id, client_id, entity_id);
create index case_approvals_case_idx on public.case_approvals (case_id);

create function app_private.case_approval_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.case_id <> old.case_id
     or new.package_id <> old.package_id
     or new.approver_user_id <> old.approver_user_id
     or new.approver_role <> old.approver_role
     or new.package_number <> old.package_number
     or new.package_digest <> old.package_digest
     or new.case_version <> old.case_version
     or new.destination <> old.destination
     or new.approved_at <> old.approved_at
     or new.expires_at <> old.expires_at
     or new.idempotency_key <> old.idempotency_key
     or new.created_at <> old.created_at then
    raise exception 'an approval''s binding is immutable';
  end if;
  if old.status <> 'ACTIVE' then
    raise exception 'an ended approval is immutable';
  end if;
  if new.status = 'ACTIVE' then
    raise exception 'an active approval changes only by ending';
  end if;
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

create trigger case_approvals_scope_immutable
  before update on public.case_approvals
  for each row execute function app_private.reject_scope_change();
create trigger case_approvals_lifecycle
  before update on public.case_approvals
  for each row execute function app_private.case_approval_lifecycle();

-- ---------------------------------------------------------------------------
-- Grants and policies: SELECT for staff of the row's scope, at AAL2. No
-- client role holds anything on these tables.
-- ---------------------------------------------------------------------------

grant select on public.case_review_packages to authenticated;
grant select on public.case_reviews to authenticated;
grant select on public.case_approvals to authenticated;

alter table public.case_review_packages enable row level security;
alter table public.case_reviews enable row level security;
alter table public.case_approvals enable row level security;

create policy case_review_packages_select_by_staff
  on public.case_review_packages for select to authenticated
  using (
    exists (
      select 1 from public.memberships m
      where m.user_id = (select auth.uid())
        and m.environment_id = case_review_packages.environment_id
        and m.client_id = case_review_packages.client_id
        and m.entity_id = case_review_packages.entity_id
        and m.role in ('intake', 'preparer', 'reviewer', 'approver')
    )
  );
create policy case_review_packages_staff_requires_aal2
  on public.case_review_packages as restrictive for select to authenticated
  using (
    (select coalesce(auth.jwt() ->> 'aal', 'aal1')) = 'aal2'
    or not exists (
      select 1 from public.memberships s
      where s.user_id = (select auth.uid()) and s.role <> 'client_user'
    )
  );

create policy case_reviews_select_by_staff
  on public.case_reviews for select to authenticated
  using (
    exists (
      select 1 from public.memberships m
      where m.user_id = (select auth.uid())
        and m.environment_id = case_reviews.environment_id
        and m.client_id = case_reviews.client_id
        and m.entity_id = case_reviews.entity_id
        and m.role in ('intake', 'preparer', 'reviewer', 'approver')
    )
  );
create policy case_reviews_staff_requires_aal2
  on public.case_reviews as restrictive for select to authenticated
  using (
    (select coalesce(auth.jwt() ->> 'aal', 'aal1')) = 'aal2'
    or not exists (
      select 1 from public.memberships s
      where s.user_id = (select auth.uid()) and s.role <> 'client_user'
    )
  );

create policy case_approvals_select_by_staff
  on public.case_approvals for select to authenticated
  using (
    exists (
      select 1 from public.memberships m
      where m.user_id = (select auth.uid())
        and m.environment_id = case_approvals.environment_id
        and m.client_id = case_approvals.client_id
        and m.entity_id = case_approvals.entity_id
        and m.role in ('intake', 'preparer', 'reviewer', 'approver')
    )
  );
create policy case_approvals_staff_requires_aal2
  on public.case_approvals as restrictive for select to authenticated
  using (
    (select coalesce(auth.jwt() ->> 'aal', 'aal1')) = 'aal2'
    or not exists (
      select 1 from public.memberships s
      where s.user_id = (select auth.uid()) and s.role <> 'client_user'
    )
  );

-- ---------------------------------------------------------------------------
-- Helpers (app_private, no API): the acting staff member, the manifest,
-- its digest, and the replay of a completed transition.
-- ---------------------------------------------------------------------------

/** The signed-in user, at AAL2, holding one of the named roles in the
 * exact scope. Every refusal is 42501, like a denied read. */
create function app_private.staff_member_for_scope(
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

/** The evidence a review sees, as ids, statuses, versions, digests, and
 * sizes: every request of the case, every submitted answer (its text as a
 * digest), every checked document. Deterministic: sorted by id, and jsonb
 * normalizes key order, so the same evidence always digests the same, and
 * a digest recomputed later still matches until the evidence changes (the
 * case's own version is recorded on the package, not inside the manifest). */
create function app_private.build_case_manifest(p_case_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'case_id', c.id,
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'status', r.status, 'version', r.version)
                       order by r.id)
        from public.requests r where r.case_id = c.id), '[]'::jsonb),
    'answers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'request_id', a.request_id, 'version', a.version,
               'body_sha256', encode(sha256(convert_to(a.body, 'UTF8')), 'hex'))
               order by a.id)
        from public.request_answers a where a.case_id = c.id and a.status = 'SUBMITTED'), '[]'::jsonb),
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id, 'request_id', d.request_id, 'client_digest', d.client_digest,
               'byte_size', d.byte_size)
               order by d.id)
        from public.document_uploads d where d.case_id = c.id and d.status = 'ACCEPTED'), '[]'::jsonb)
  )
  from public.cases c where c.id = p_case_id
$$;

create function app_private.manifest_digest(p_manifest jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(p_manifest::text, 'UTF8')), 'hex')
$$;

/** A completed transition's own result, when the same actor repeats the
 * same key on the same case: the audit receipt is the record of the
 * mutation, so a lost response can never move a case twice. */
create function app_private.case_replay(p_actor uuid, p_case_id uuid, p_key uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select r.details -> 'result'
    from public.audit_receipts r
   where r.actor_user_id = p_actor
     and r.object_ref = 'case:' || p_case_id::text
     and r.details ->> 'idempotency_key' = p_key::text
   order by r.occurred_at desc
   limit 1
$$;

/** The case, locked, in the exact scope, at the version the caller read. */
create function app_private.lock_case_at(
  p_environment_id uuid,
  p_client_id uuid,
  p_entity_id uuid,
  p_case_id uuid,
  p_case_version integer
)
returns public.cases
language plpgsql
set search_path = ''
as $$
declare
  v_case public.cases%rowtype;
begin
  select * into v_case
    from public.cases c
   where c.id = p_case_id
     and c.environment_id = p_environment_id
     and c.client_id = p_client_id
     and c.entity_id = p_entity_id
     for update;
  if not found then
    raise exception 'case_not_found';
  end if;
  if v_case.version <> p_case_version then
    raise exception 'case_changed';
  end if;
  return v_case;
end;
$$;

create function app_private.record_case_event(
  p_case public.cases,
  p_kind text,
  p_actor_role text,
  p_at timestamptz
)
returns void
language sql
set search_path = ''
as $$
  insert into public.activity_events (
    environment_id, client_id, entity_id, case_id, event_kind, actor_role, occurred_at
  ) values (
    (p_case).environment_id, (p_case).client_id, (p_case).entity_id, (p_case).id,
    p_kind, p_actor_role, p_at
  )
$$;

-- ---------------------------------------------------------------------------
-- Transitions. Refusals are stable tokens (SQLSTATE P0001) the app words;
-- authorization failures are 42501 like a denied read.
-- ---------------------------------------------------------------------------

/** The preparer freezes the case's evidence into the next package and
 * sends the case for review. From EVIDENCE_PENDING, or from APPROVED
 * (material change: the active approval is superseded). */
create function public.freeze_case_package(
  p_environment_id uuid,
  p_client_id uuid,
  p_entity_id uuid,
  p_case_id uuid,
  p_case_version integer,
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
  v_replay jsonb;
  v_now timestamptz := now();
  v_number integer;
  v_manifest jsonb;
  v_digest text;
  v_id uuid;
  v_result jsonb;
begin
  if p_idempotency_key is null then
    raise exception 'invalid_idempotency_key';
  end if;
  v_uid := app_private.staff_member_for_scope(
    p_environment_id, p_client_id, p_entity_id, array['preparer']);
  v_replay := app_private.case_replay(v_uid, p_case_id, p_idempotency_key);
  if v_replay is not null then
    return v_replay;
  end if;
  v_case := app_private.lock_case_at(
    p_environment_id, p_client_id, p_entity_id, p_case_id, p_case_version);
  if v_case.status not in ('EVIDENCE_PENDING', 'APPROVED') then
    raise exception 'case_not_freezable';
  end if;

  update public.case_review_packages
     set superseded_at = v_now
   where case_id = p_case_id and superseded_at is null;
  update public.case_approvals
     set status = 'SUPERSEDED', ended_at = v_now, end_reason = 'package_superseded'
   where case_id = p_case_id and status = 'ACTIVE';

  v_number := coalesce(
    (select max(p.package_number) from public.case_review_packages p where p.case_id = p_case_id), 0) + 1;
  v_manifest := app_private.build_case_manifest(p_case_id);
  v_digest := app_private.manifest_digest(v_manifest);
  v_id := gen_random_uuid();
  insert into public.case_review_packages (
    id, environment_id, client_id, entity_id, case_id, package_number,
    manifest, manifest_digest, case_version, frozen_by, frozen_role, frozen_at, idempotency_key
  ) values (
    v_id, p_environment_id, p_client_id, p_entity_id, p_case_id, v_number,
    v_manifest, v_digest, v_case.version, v_uid, 'preparer', v_now, p_idempotency_key
  );

  update public.cases
     set status = 'READY_FOR_REVIEW', status_changed_at = v_now
   where id = p_case_id;
  perform app_private.record_case_event(v_case, 'case.package_frozen', 'preparer', v_now);

  v_result := jsonb_build_object(
    'package_id', v_id,
    'package_number', v_number,
    'manifest_digest', v_digest,
    'case_status', 'READY_FOR_REVIEW',
    'case_version', v_case.version + 1
  );
  perform app_private.append_audit(
    v_uid, p_environment_id, p_client_id, p_entity_id,
    'case.package_frozen', 'case:' || p_case_id::text,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'package_id', v_id,
      'package_number', v_number,
      'manifest_digest', v_digest,
      'from_status', v_case.status,
      'result', v_result
    )
  );
  return v_result;
end;
$$;

/** A conflict-free reviewer takes the current package into review. */
create function public.start_case_review(
  p_environment_id uuid,
  p_client_id uuid,
  p_entity_id uuid,
  p_case_id uuid,
  p_case_version integer,
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
  v_package public.case_review_packages%rowtype;
  v_replay jsonb;
  v_now timestamptz := now();
  v_id uuid;
  v_result jsonb;
begin
  if p_idempotency_key is null then
    raise exception 'invalid_idempotency_key';
  end if;
  v_uid := app_private.staff_member_for_scope(
    p_environment_id, p_client_id, p_entity_id, array['reviewer']);
  v_replay := app_private.case_replay(v_uid, p_case_id, p_idempotency_key);
  if v_replay is not null then
    return v_replay;
  end if;
  v_case := app_private.lock_case_at(
    p_environment_id, p_client_id, p_entity_id, p_case_id, p_case_version);
  if v_case.status <> 'READY_FOR_REVIEW' then
    raise exception 'case_not_reviewable';
  end if;
  select * into v_package
    from public.case_review_packages p
   where p.case_id = p_case_id and p.superseded_at is null;
  if not found then
    raise exception 'package_missing';
  end if;
  if v_package.frozen_by = v_uid then
    -- The person who froze the evidence does not review it.
    raise exception 'conflict_of_interest';
  end if;
  if exists (
    select 1 from public.case_reviews r
     where r.package_id = v_package.id and r.reviewer_role = 'reviewer'
  ) then
    raise exception 'review_in_progress';
  end if;

  v_id := gen_random_uuid();
  insert into public.case_reviews (
    id, environment_id, client_id, entity_id, case_id, package_id,
    reviewer_user_id, reviewer_role, status, started_at, start_key
  ) values (
    v_id, p_environment_id, p_client_id, p_entity_id, p_case_id, v_package.id,
    v_uid, 'reviewer', 'IN_PROGRESS', v_now, p_idempotency_key
  );
  update public.cases set status = 'IN_REVIEW', status_changed_at = v_now where id = p_case_id;
  perform app_private.record_case_event(v_case, 'case.review_started', 'reviewer', v_now);

  v_result := jsonb_build_object(
    'review_id', v_id,
    'package_id', v_package.id,
    'case_status', 'IN_REVIEW',
    'case_version', v_case.version + 1
  );
  perform app_private.append_audit(
    v_uid, p_environment_id, p_client_id, p_entity_id,
    'case.review_started', 'case:' || p_case_id::text,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'review_id', v_id,
      'package_id', v_package.id,
      'result', v_result
    )
  );
  return v_result;
end;
$$;

/** The verdict. A reviewer records PASS, RETURN, or HOLD on the review
 * they started; an approver records RETURN or HOLD on a passed package
 * (PASS by an approver is approve_case_package). The note is bounded,
 * printable staff text on a staff-only row. */
create function public.record_case_verdict(
  p_environment_id uuid,
  p_client_id uuid,
  p_entity_id uuid,
  p_case_id uuid,
  p_case_version integer,
  p_verdict text,
  p_note text,
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
  v_package public.case_review_packages%rowtype;
  v_review public.case_reviews%rowtype;
  v_replay jsonb;
  v_now timestamptz := now();
  v_role text;
  v_note text := coalesce(p_note, '');
  v_status text;
  v_kind text;
  v_id uuid;
  v_result jsonb;
begin
  if p_idempotency_key is null then
    raise exception 'invalid_idempotency_key';
  end if;
  if p_verdict is null or p_verdict not in ('PASS', 'RETURN', 'HOLD') then
    raise exception 'invalid_verdict';
  end if;
  if char_length(v_note) > 2000 then
    raise exception 'note_too_long';
  end if;
  if v_note ~ E'[\\x01-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]' then
    raise exception 'invalid_text';
  end if;
  v_uid := app_private.staff_member_for_scope(
    p_environment_id, p_client_id, p_entity_id, array['reviewer', 'approver']);
  v_replay := app_private.case_replay(v_uid, p_case_id, p_idempotency_key);
  if v_replay is not null then
    return v_replay;
  end if;
  v_case := app_private.lock_case_at(
    p_environment_id, p_client_id, p_entity_id, p_case_id, p_case_version);
  select * into v_package
    from public.case_review_packages p
   where p.case_id = p_case_id and p.superseded_at is null;
  if not found then
    raise exception 'package_missing';
  end if;

  if v_case.status = 'IN_REVIEW' then
    v_role := 'reviewer';
    perform app_private.staff_member_for_scope(
      p_environment_id, p_client_id, p_entity_id, array['reviewer']);
    select * into v_review
      from public.case_reviews r
     where r.package_id = v_package.id and r.reviewer_role = 'reviewer'
       for update;
    if not found or v_review.reviewer_user_id <> v_uid or v_review.status <> 'IN_PROGRESS' then
      raise exception 'not_your_review';
    end if;
    update public.case_reviews
       set status = 'RECORDED', verdict = p_verdict, note = v_note,
           recorded_at = v_now, idempotency_key = p_idempotency_key
     where id = v_review.id;
    v_id := v_review.id;
  elsif v_case.status = 'APPROVAL_PENDING' then
    v_role := 'approver';
    perform app_private.staff_member_for_scope(
      p_environment_id, p_client_id, p_entity_id, array['approver']);
    if p_verdict = 'PASS' then
      raise exception 'invalid_verdict';
    end if;
    if v_package.frozen_by = v_uid or exists (
      select 1 from public.case_reviews r
       where r.package_id = v_package.id and r.reviewer_user_id = v_uid
    ) then
      raise exception 'conflict_of_interest';
    end if;
    v_id := gen_random_uuid();
    insert into public.case_reviews (
      id, environment_id, client_id, entity_id, case_id, package_id,
      reviewer_user_id, reviewer_role, status, verdict, note,
      started_at, recorded_at, start_key, idempotency_key
    ) values (
      v_id, p_environment_id, p_client_id, p_entity_id, p_case_id, v_package.id,
      v_uid, 'approver', 'RECORDED', p_verdict, v_note,
      v_now, v_now, p_idempotency_key, p_idempotency_key
    );
  else
    raise exception 'case_not_reviewable';
  end if;

  v_status := case p_verdict
    when 'PASS' then 'APPROVAL_PENDING'
    when 'RETURN' then 'RETURNED'
    else 'HOLD' end;
  v_kind := case p_verdict
    when 'PASS' then 'case.review_passed'
    when 'RETURN' then 'case.returned'
    else 'case.held' end;
  update public.cases set status = v_status, status_changed_at = v_now where id = p_case_id;
  perform app_private.record_case_event(v_case, v_kind, v_role, v_now);

  v_result := jsonb_build_object(
    'review_id', v_id,
    'package_id', v_package.id,
    'verdict', p_verdict,
    'case_status', v_status,
    'case_version', v_case.version + 1
  );
  perform app_private.append_audit(
    v_uid, p_environment_id, p_client_id, p_entity_id,
    'case.verdict_recorded', 'case:' || p_case_id::text,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'review_id', v_id,
      'package_id', v_package.id,
      'role', v_role,
      'verdict', p_verdict,
      'note_length', char_length(v_note),
      'result', v_result
    )
  );
  return v_result;
end;
$$;

/** Work resumes: a preparer takes a RETURNED case back to evidence, an
 * approver lifts a HOLD, and a preparer reopens an APPROVED case for
 * material change (its active approval ends as reopened). */
create function public.resume_case(
  p_environment_id uuid,
  p_client_id uuid,
  p_entity_id uuid,
  p_case_id uuid,
  p_case_version integer,
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
  v_replay jsonb;
  v_now timestamptz := now();
  v_role text;
  v_result jsonb;
begin
  if p_idempotency_key is null then
    raise exception 'invalid_idempotency_key';
  end if;
  v_uid := app_private.staff_member_for_scope(
    p_environment_id, p_client_id, p_entity_id, array['preparer', 'approver']);
  v_replay := app_private.case_replay(v_uid, p_case_id, p_idempotency_key);
  if v_replay is not null then
    return v_replay;
  end if;
  v_case := app_private.lock_case_at(
    p_environment_id, p_client_id, p_entity_id, p_case_id, p_case_version);
  if v_case.status in ('RETURNED', 'APPROVED') then
    v_role := 'preparer';
  elsif v_case.status = 'HOLD' then
    v_role := 'approver';
  else
    raise exception 'case_not_resumable';
  end if;
  perform app_private.staff_member_for_scope(
    p_environment_id, p_client_id, p_entity_id, array[v_role]);
  if v_case.status = 'APPROVED' then
    update public.case_approvals
       set status = 'SUPERSEDED', ended_at = v_now, end_reason = 'case_reopened'
     where case_id = p_case_id and status = 'ACTIVE';
  end if;
  update public.cases set status = 'EVIDENCE_PENDING', status_changed_at = v_now where id = p_case_id;
  perform app_private.record_case_event(v_case, 'case.resumed', v_role, v_now);

  v_result := jsonb_build_object(
    'case_status', 'EVIDENCE_PENDING',
    'case_version', v_case.version + 1,
    'from_status', v_case.status
  );
  perform app_private.append_audit(
    v_uid, p_environment_id, p_client_id, p_entity_id,
    'case.resumed', 'case:' || p_case_id::text,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'from_status', v_case.status,
      'role', v_role,
      'result', v_result
    )
  );
  return v_result;
end;
$$;

/** A conflict-free approver approves the exact package: the id and the
 * digest the screen showed, the case version it read, a named
 * destination, and an expiry set by the server. */
create function public.approve_case_package(
  p_environment_id uuid,
  p_client_id uuid,
  p_entity_id uuid,
  p_case_id uuid,
  p_case_version integer,
  p_package_id uuid,
  p_package_digest text,
  p_destination text,
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
  v_package public.case_review_packages%rowtype;
  v_replay jsonb;
  v_now timestamptz := now();
  v_expires timestamptz;
  v_id uuid;
  v_result jsonb;
begin
  if p_idempotency_key is null then
    raise exception 'invalid_idempotency_key';
  end if;
  v_uid := app_private.staff_member_for_scope(
    p_environment_id, p_client_id, p_entity_id, array['approver']);
  v_replay := app_private.case_replay(v_uid, p_case_id, p_idempotency_key);
  if v_replay is not null then
    return v_replay;
  end if;
  v_case := app_private.lock_case_at(
    p_environment_id, p_client_id, p_entity_id, p_case_id, p_case_version);
  if v_case.status <> 'APPROVAL_PENDING' then
    raise exception 'case_not_approvable';
  end if;
  select * into v_package
    from public.case_review_packages p
   where p.case_id = p_case_id and p.superseded_at is null;
  if not found or v_package.id <> p_package_id then
    raise exception 'package_changed';
  end if;
  if p_package_digest is null or v_package.manifest_digest <> p_package_digest then
    raise exception 'digest_mismatch';
  end if;
  if p_destination is null or p_destination <> 'hive-record' then
    raise exception 'invalid_destination';
  end if;
  if v_package.frozen_by = v_uid or exists (
    select 1 from public.case_reviews r
     where r.package_id = v_package.id and r.reviewer_user_id = v_uid
  ) then
    raise exception 'conflict_of_interest';
  end if;
  if not exists (
    select 1 from public.case_reviews r
     where r.package_id = v_package.id and r.reviewer_role = 'reviewer'
       and r.status = 'RECORDED' and r.verdict = 'PASS'
  ) then
    raise exception 'review_missing';
  end if;

  v_expires := v_now + interval '30 days';
  v_id := gen_random_uuid();
  insert into public.case_approvals (
    id, environment_id, client_id, entity_id, case_id, package_id,
    approver_user_id, approver_role, package_number, package_digest, case_version,
    destination, status, approved_at, expires_at, idempotency_key
  ) values (
    v_id, p_environment_id, p_client_id, p_entity_id, p_case_id, v_package.id,
    v_uid, 'approver', v_package.package_number, v_package.manifest_digest, v_case.version,
    p_destination, 'ACTIVE', v_now, v_expires, p_idempotency_key
  );
  update public.cases set status = 'APPROVED', status_changed_at = v_now where id = p_case_id;
  perform app_private.record_case_event(v_case, 'case.approved', 'approver', v_now);

  v_result := jsonb_build_object(
    'approval_id', v_id,
    'package_id', v_package.id,
    'package_digest', v_package.manifest_digest,
    'destination', p_destination,
    'approved_at', v_now,
    'expires_at', v_expires,
    'case_status', 'APPROVED',
    'case_version', v_case.version + 1
  );
  perform app_private.append_audit(
    v_uid, p_environment_id, p_client_id, p_entity_id,
    'case.approved', 'case:' || p_case_id::text,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'approval_id', v_id,
      'package_id', v_package.id,
      'package_digest', v_package.manifest_digest,
      'destination', p_destination,
      'expires_at', v_expires,
      'result', v_result
    )
  );
  return v_result;
end;
$$;

/** The expiry sweep, server role only: an approval past its expiry ends,
 * and a case still standing on it goes back to APPROVAL_PENDING, told
 * through the trail. */
create function public.expire_case_approvals()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_row public.case_approvals%rowtype;
  v_case public.cases%rowtype;
  v_count integer := 0;
  v_now timestamptz := now();
begin
  perform app_private.require_server_role();
  for v_row in
    select * from public.case_approvals a
     where a.status = 'ACTIVE' and a.expires_at <= v_now
     order by a.approved_at
     for update
  loop
    update public.case_approvals
       set status = 'EXPIRED', ended_at = v_now, end_reason = 'expired'
     where id = v_row.id;
    select * into v_case from public.cases c where c.id = v_row.case_id for update;
    if v_case.status = 'APPROVED' and exists (
      select 1 from public.case_review_packages p
       where p.id = v_row.package_id and p.superseded_at is null
    ) then
      update public.cases
         set status = 'APPROVAL_PENDING', status_changed_at = v_now
       where id = v_case.id;
      perform app_private.record_case_event(v_case, 'case.approval_expired', 'system', v_now);
    end if;
    perform app_private.append_audit(
      null, v_row.environment_id, v_row.client_id, v_row.entity_id,
      'case.approval_expired', 'case:' || v_row.case_id::text,
      jsonb_build_object('approval_id', v_row.id, 'package_id', v_row.package_id)
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges, as before: nothing callable by default.
-- ---------------------------------------------------------------------------

revoke execute on function public.freeze_case_package(uuid, uuid, uuid, uuid, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.freeze_case_package(uuid, uuid, uuid, uuid, integer, uuid)
  to authenticated, service_role;

revoke execute on function public.start_case_review(uuid, uuid, uuid, uuid, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.start_case_review(uuid, uuid, uuid, uuid, integer, uuid)
  to authenticated, service_role;

revoke execute on function public.record_case_verdict(uuid, uuid, uuid, uuid, integer, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.record_case_verdict(uuid, uuid, uuid, uuid, integer, text, text, uuid)
  to authenticated, service_role;

revoke execute on function public.resume_case(uuid, uuid, uuid, uuid, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.resume_case(uuid, uuid, uuid, uuid, integer, uuid)
  to authenticated, service_role;

revoke execute on function public.approve_case_package(uuid, uuid, uuid, uuid, integer, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.approve_case_package(uuid, uuid, uuid, uuid, integer, uuid, text, text, uuid)
  to authenticated, service_role;

revoke execute on function public.expire_case_approvals() from public, anon, authenticated;
grant execute on function public.expire_case_approvals() to service_role;

revoke execute on function app_private.staff_member_for_scope(uuid, uuid, uuid, text[])
  from public, anon, authenticated;
revoke execute on function app_private.build_case_manifest(uuid) from public, anon, authenticated;
revoke execute on function app_private.manifest_digest(jsonb) from public, anon, authenticated;
revoke execute on function app_private.case_replay(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function app_private.lock_case_at(uuid, uuid, uuid, uuid, integer)
  from public, anon, authenticated;
revoke execute on function app_private.record_case_event(public.cases, text, text, timestamptz)
  from public, anon, authenticated;
-- The expiry sweep runs as the server role (no borrowed authority) and
-- records the trail entry through this helper, as it records the audit
-- receipt through append_audit.
grant execute on function app_private.record_case_event(public.cases, text, text, timestamptz)
  to service_role;
revoke execute on function app_private.case_review_package_guard() from public, anon, authenticated;
revoke execute on function app_private.case_review_lifecycle() from public, anon, authenticated;
revoke execute on function app_private.case_approval_lifecycle() from public, anon, authenticated;
