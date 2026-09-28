-- Milestone 3: review and response (WO-004).
--
-- A client user answers an OPEN request in words: a draft kept with the
-- request on the server (never on the device, visible from any device),
-- citing the request's received documents, and an explicit submission
-- that moves exactly one thing, the request, to ANSWERED. No case status,
-- attention item, next action, or approval moves: an answer is a HIVE
-- record, not an accounting decision, and no one at Honeybee decides
-- anything here (PRODUCT.md, Milestone 3 exclusions). How Honeybee learns
-- of a submission is a communication contract that stays HOLD for Stacie;
-- nothing here notifies anyone.
--
-- Two tables, PROTECTED and scoped exactly like requests and documents:
--
--   request_answers            one per request; DRAFT -> SUBMITTED, then immutable
--   request_answer_citations   the received documents an answer points at
--
-- and a source link on requests: the document a question is ABOUT
-- (seeded only in this milestone; no client or staff write path).
--
-- Every write is a reviewed server function under the protected-mutation
-- contract (idempotency key, object version, exact scope, server time,
-- atomic audit receipt); clients hold SELECT and nothing else. Staff read
-- SUBMITTED answers at AAL2 and never a draft, and cannot write at all.

-- ---------------------------------------------------------------------------
-- The source link: which document a request is about. The composite key
-- on document_uploads makes a link outside the request's own scope
-- unrepresentable; the document may sit on another request of the case.
-- ---------------------------------------------------------------------------

alter table public.document_uploads
  add constraint document_uploads_scope_id_key unique (environment_id, client_id, entity_id, id);

alter table public.requests add column subject_document_id uuid;

alter table public.requests
  add constraint requests_subject_document_fkey
  foreign key (environment_id, client_id, entity_id, subject_document_id)
  references public.document_uploads (environment_id, client_id, entity_id, id);

create index requests_subject_document_idx
  on public.requests (subject_document_id) where subject_document_id is not null;

-- ---------------------------------------------------------------------------
-- request_answers
-- ---------------------------------------------------------------------------

create table public.request_answers (
  id uuid primary key default gen_random_uuid(),
  environment_id uuid not null,
  client_id uuid not null,
  entity_id uuid not null,
  case_id uuid not null,
  request_id uuid not null,
  -- The client user who wrote it; the only one who may keep writing it.
  created_by uuid not null references auth.users (id),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'SUBMITTED')),
  -- The answer itself: bounded, printable text (newline and tab allowed,
  -- other control characters not). Client-written free text on a
  -- PROTECTED row: it appears on the request only, never in activity,
  -- audit details, or a log.
  body text not null default '' check (
    char_length(body) <= 4000
    and body !~ E'[\\x01-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]'
  ),
  version integer not null default 1,
  -- The idempotency key of the submission that settled it.
  submit_key uuid,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One answer per request.
  unique (request_id),
  foreign key (environment_id, client_id, entity_id, case_id)
    references public.cases (environment_id, client_id, entity_id, id),
  foreign key (environment_id, client_id, entity_id, request_id)
    references public.requests (environment_id, client_id, entity_id, id),
  constraint request_answers_submitted_iff
    check ((status = 'SUBMITTED') = (submitted_at is not null)),
  constraint request_answers_submit_key_iff
    check ((status = 'SUBMITTED') = (submit_key is not null))
);

create index request_answers_scope_idx
  on public.request_answers (environment_id, client_id, entity_id);

grant select on public.request_answers to authenticated;

alter table public.request_answers enable row level security;

-- A client user in the scope sees the answer in every state (their own
-- draft from any device); staff in the scope see it once SUBMITTED and
-- never a draft. One permissive policy carries both, so nothing can OR
-- around the draft rule.
create policy request_answers_select_by_membership
  on public.request_answers
  for select
  to authenticated
  using (
    exists (
      select 1 from public.memberships m
      where m.user_id = (select auth.uid())
        and m.environment_id = request_answers.environment_id
        and m.client_id = request_answers.client_id
        and m.entity_id = request_answers.entity_id
        and (m.role = 'client_user' or request_answers.status = 'SUBMITTED')
    )
  );

create policy request_answers_staff_requires_aal2
  on public.request_answers
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

create trigger request_answers_scope_immutable
  before update on public.request_answers
  for each row execute function app_private.reject_scope_change();

-- The lifecycle: identity immutable after insert; DRAFT -> SUBMITTED the
-- only transition; a submitted answer immutable entirely; every update
-- bumps the version and the server timestamp.
create function app_private.request_answer_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.request_id <> old.request_id
     or new.case_id <> old.case_id
     or new.created_by <> old.created_by
     or new.created_at <> old.created_at then
    raise exception 'request answer identity is immutable';
  end if;
  if old.status = 'SUBMITTED' then
    raise exception 'a submitted answer is immutable';
  end if;
  if new.status <> old.status and not (old.status = 'DRAFT' and new.status = 'SUBMITTED') then
    raise exception 'illegal request answer transition % -> %', old.status, new.status;
  end if;
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

create trigger request_answers_lifecycle
  before update on public.request_answers
  for each row execute function app_private.request_answer_lifecycle();

-- ---------------------------------------------------------------------------
-- request_answer_citations: the received documents an answer points at.
-- Scope columns are carried for the policy and the index and must equal
-- the answer's (the trigger below holds them to it).
-- ---------------------------------------------------------------------------

create table public.request_answer_citations (
  -- A surrogate id beside the natural key, so every protected table has
  -- the one id column the reach proofs select.
  id uuid not null unique default gen_random_uuid(),
  answer_id uuid not null references public.request_answers (id) on delete cascade,
  document_id uuid not null,
  environment_id uuid not null,
  client_id uuid not null,
  entity_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (answer_id, document_id),
  foreign key (environment_id, client_id, entity_id, document_id)
    references public.document_uploads (environment_id, client_id, entity_id, id)
);

create index request_answer_citations_scope_idx
  on public.request_answer_citations (environment_id, client_id, entity_id);
create index request_answer_citations_document_idx
  on public.request_answer_citations (document_id);

grant select on public.request_answer_citations to authenticated;

alter table public.request_answer_citations enable row level security;

-- Visibility follows the answer: the answer's own policy runs inside this
-- subquery as the caller, so a draft's citations are as private as the
-- draft, and a submitted answer's are readable to staff at AAL2.
create policy request_answer_citations_select_by_answer
  on public.request_answer_citations
  for select
  to authenticated
  using (
    exists (
      select 1 from public.request_answers a
      where a.id = request_answer_citations.answer_id
        and a.environment_id = request_answer_citations.environment_id
        and a.client_id = request_answer_citations.client_id
        and a.entity_id = request_answer_citations.entity_id
    )
  );

create policy request_answer_citations_staff_requires_aal2
  on public.request_answer_citations
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

-- Citations change only while the answer is a draft, and only in the
-- answer's own scope.
create function app_private.request_answer_citation_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_answer public.request_answers%rowtype;
  v_answer_id uuid := coalesce(new.answer_id, old.answer_id);
begin
  select * into v_answer from public.request_answers a where a.id = v_answer_id;
  if not found then
    if tg_op = 'DELETE' then
      -- The answer itself is being removed (the synthetic lanes' checked
      -- reset, with the table owner's authority): its citations go with it.
      return old;
    end if;
    raise exception 'citation without an answer';
  end if;
  if v_answer.status <> 'DRAFT' then
    raise exception 'citations of a submitted answer are immutable';
  end if;
  if tg_op = 'INSERT' and (
       new.environment_id <> v_answer.environment_id
       or new.client_id <> v_answer.client_id
       or new.entity_id <> v_answer.entity_id
     ) then
    raise exception 'a citation carries its answer''s scope';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'citations are inserted and deleted, never updated';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger request_answer_citations_guard
  before insert or update or delete on public.request_answer_citations
  for each row execute function app_private.request_answer_citation_guard();

-- ---------------------------------------------------------------------------
-- Client-callable transitions. Refusals are stable tokens (SQLSTATE
-- P0001) the app words; authorization failures are 42501 like a denied
-- read. Both re-derive the actor from auth.uid() and require a
-- client_user membership in the exact scope (staff are refused).
-- ---------------------------------------------------------------------------

/** The documents an answer may cite: received on the same request. */
create function app_private.citable_document_count(
  p_request_id uuid,
  p_document_ids uuid[]
)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::integer
    from unnest(p_document_ids) as wanted(document_id)
    join public.document_uploads u
      on u.id = wanted.document_id
     and u.request_id = p_request_id
     and u.status in ('QUARANTINED', 'VALIDATING', 'ACCEPTED')
$$;

create function public.save_request_answer_draft(
  p_environment_id uuid,
  p_client_id uuid,
  p_entity_id uuid,
  p_request_id uuid,
  p_request_version integer,
  p_body text,
  p_cited_document_ids uuid[],
  p_answer_version integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_request public.requests%rowtype;
  v_answer public.request_answers%rowtype;
  v_ids uuid[] := coalesce(p_cited_document_ids, array[]::uuid[]);
  v_distinct uuid[];
  v_now timestamptz := now();
  v_id uuid;
begin
  v_uid := app_private.client_user_for_scope(p_environment_id, p_client_id, p_entity_id);

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
    -- The most specific refusal: a request this caller's own submission
    -- settled says so, rather than reading as closed by someone else.
    if exists (
      select 1 from public.request_answers a
       where a.request_id = p_request_id and a.status = 'SUBMITTED'
    ) then
      raise exception 'already_submitted';
    end if;
    raise exception 'request_closed';
  end if;
  if v_request.version <> p_request_version then
    raise exception 'request_changed';
  end if;

  if p_body is null then
    raise exception 'invalid_text';
  end if;
  if char_length(p_body) > 4000 then
    raise exception 'answer_too_long';
  end if;
  if p_body ~ E'[\\x01-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]' then
    raise exception 'invalid_text';
  end if;

  select array_agg(distinct d) into v_distinct from unnest(v_ids) as d;
  v_distinct := coalesce(v_distinct, array[]::uuid[]);
  if array_length(v_distinct, 1) > 20 then
    raise exception 'too_many_citations';
  end if;
  if array_length(v_distinct, 1) > 0
     and app_private.citable_document_count(p_request_id, v_distinct) <> array_length(v_distinct, 1) then
    raise exception 'invalid_document';
  end if;

  select * into v_answer
    from public.request_answers a
   where a.request_id = p_request_id
     for update;
  if found then
    if v_answer.status = 'SUBMITTED' then
      raise exception 'already_submitted';
    end if;
    if v_answer.created_by <> v_uid then
      -- Another client user of the same workspace holds the draft; the
      -- record is one per request, and the screen says whose it is.
      raise exception 'answer_changed';
    end if;
    if p_answer_version is null or p_answer_version <> v_answer.version then
      raise exception 'answer_changed';
    end if;
    update public.request_answers set body = p_body where id = v_answer.id;
    delete from public.request_answer_citations where answer_id = v_answer.id;
    v_id := v_answer.id;
  else
    if p_answer_version is not null then
      raise exception 'answer_changed';
    end if;
    v_id := gen_random_uuid();
    insert into public.request_answers (
      id, environment_id, client_id, entity_id, case_id, request_id, created_by, status, body
    ) values (
      v_id, p_environment_id, p_client_id, p_entity_id, v_request.case_id, p_request_id, v_uid,
      'DRAFT', p_body
    );
  end if;

  insert into public.request_answer_citations (
    answer_id, document_id, environment_id, client_id, entity_id
  )
  select v_id, d, p_environment_id, p_client_id, p_entity_id from unnest(v_distinct) as d;

  select * into v_answer from public.request_answers a where a.id = v_id;

  perform app_private.append_audit(
    v_uid, p_environment_id, p_client_id, p_entity_id,
    'answer.draft_saved', 'answer:' || v_id::text,
    jsonb_build_object(
      'request_id', p_request_id,
      'request_version', p_request_version,
      'body_length', char_length(p_body),
      'citations', coalesce(array_length(v_distinct, 1), 0),
      'answer_version', v_answer.version
    )
  );

  return jsonb_build_object(
    'answer_id', v_answer.id,
    'status', v_answer.status,
    'version', v_answer.version,
    'updated_at', v_answer.updated_at
  );
end;
$$;

create function public.submit_request_answer(
  p_answer_id uuid,
  p_answer_version integer,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_answer public.request_answers%rowtype;
  v_request public.requests%rowtype;
  v_citations uuid[];
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'invalid_idempotency_key';
  end if;
  select * into v_answer from public.request_answers a where a.id = p_answer_id for update;
  if not found or v_answer.created_by <> v_uid then
    -- Someone else's answer and a nonexistent one look the same.
    raise exception 'answer not found' using errcode = '42501';
  end if;
  perform app_private.client_user_for_scope(v_answer.environment_id, v_answer.client_id, v_answer.entity_id);

  if v_answer.status = 'SUBMITTED' then
    if v_answer.submit_key = p_idempotency_key then
      -- The confirmation was lost on the way back: say it again, change nothing.
      return jsonb_build_object(
        'answer_id', v_answer.id, 'status', v_answer.status,
        'version', v_answer.version, 'submitted_at', v_answer.submitted_at
      );
    end if;
    raise exception 'already_submitted';
  end if;
  if v_answer.version <> p_answer_version then
    raise exception 'answer_changed';
  end if;

  select * into v_request from public.requests r where r.id = v_answer.request_id for update;
  if v_request.status <> 'OPEN' then
    raise exception 'request_closed';
  end if;
  if btrim(v_answer.body) = '' then
    raise exception 'empty_answer';
  end if;

  select array_agg(c.document_id) into v_citations
    from public.request_answer_citations c where c.answer_id = v_answer.id;
  if v_citations is not null
     and app_private.citable_document_count(v_answer.request_id, v_citations) <> array_length(v_citations, 1) then
    -- A cited document was refused or expired since the draft was saved.
    raise exception 'invalid_document';
  end if;

  update public.request_answers
     set status = 'SUBMITTED', submitted_at = v_now, submit_key = p_idempotency_key
   where id = v_answer.id;

  -- Exactly one thing moves: the request. Nothing about the case does.
  update public.requests set status = 'ANSWERED' where id = v_request.id;

  insert into public.activity_events (
    environment_id, client_id, entity_id, case_id, event_kind, actor_role, occurred_at
  ) values (
    v_answer.environment_id, v_answer.client_id, v_answer.entity_id, v_answer.case_id,
    'request.answered', 'client_user', v_now
  );

  perform app_private.append_audit(
    v_uid, v_answer.environment_id, v_answer.client_id, v_answer.entity_id,
    'answer.submitted', 'answer:' || v_answer.id::text,
    jsonb_build_object(
      'request_id', v_answer.request_id,
      'request_version', v_request.version,
      'body_length', char_length(v_answer.body),
      'citations', coalesce(array_length(v_citations, 1), 0),
      'answer_version', v_answer.version + 1
    )
  );

  select * into v_answer from public.request_answers a where a.id = p_answer_id;
  return jsonb_build_object(
    'answer_id', v_answer.id, 'status', v_answer.status,
    'version', v_answer.version, 'submitted_at', v_answer.submitted_at
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges, as in Milestone 2: nothing callable by default.
-- ---------------------------------------------------------------------------

revoke execute on function public.save_request_answer_draft(uuid, uuid, uuid, uuid, integer, text, uuid[], integer)
  from public, anon, authenticated;
grant execute on function public.save_request_answer_draft(uuid, uuid, uuid, uuid, integer, text, uuid[], integer)
  to authenticated, service_role;

revoke execute on function public.submit_request_answer(uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.submit_request_answer(uuid, integer, uuid) to authenticated, service_role;

revoke execute on function app_private.citable_document_count(uuid, uuid[]) from public, anon, authenticated;
revoke execute on function app_private.request_answer_lifecycle() from public, anon, authenticated;
revoke execute on function app_private.request_answer_citation_guard() from public, anon, authenticated;
