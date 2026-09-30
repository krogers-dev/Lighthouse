-- Intake (WO-013, Milestone 7): staff open a case and ask the client for
-- what is needed.
--
-- Until now every case and every request came from the synthetic seed.
-- These are the reviewed server functions behind the staff screens:
--
--   open_case            intake opens a case as a DRAFT ("being set up")
--   record_case_intake   intake records the intake: DRAFT -> INTAKE_RECORDED
--   open_request         intake or the preparer asks the client for a
--                        document or an answer; the first request moves the
--                        case INTAKE_RECORDED -> EVIDENCE_PENDING
--   close_request        intake or the preparer closes a request
--   discard_case_draft   a draft with nothing in it is removed; its receipt
--                        outlives it
--
-- Each runs under the protected-mutation contract of Milestones 2 to 6:
-- security definer, the actor re-derived from auth.uid() at AAL2 with the
-- exact role membership in the exact scope, the object version the screen
-- read, an idempotency key made once per confirmation and replayed from
-- the receipt, server time, an atomic audit receipt, and an enumerated
-- activity event where the client should see the step. Titles and details
-- are the only free text a client will read that a person at Honeybee
-- wrote: bounded, printable, and never copied into a receipt or the
-- trail. Attention items and next actions are not authored here; their
-- wording is a communication contract (WO-005), and the app derives what
-- to show from the state (WO-013).
--
-- Every decision is provisional and recorded in security/APPROVALS.md.

-- ---------------------------------------------------------------------------
-- The trail learns that intake was recorded. Still no free text.
-- ---------------------------------------------------------------------------
alter table public.activity_events drop constraint activity_events_event_kind_check;
alter table public.activity_events add constraint activity_events_event_kind_check check (
  event_kind in (
    'case.status_changed',
    'case.intake_recorded',
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
-- Helpers (app_private, no API).
-- ---------------------------------------------------------------------------

/** A title as it is stored: trimmed, single-spaced, two to 120
 * characters, one line. Null when it is not acceptable. */
create function app_private.clean_title(p_title text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_title text;
begin
  if p_title is null or p_title ~ E'[\\x01-\\x1F\\x7F]' then
    return null;
  end if;
  v_title := btrim(regexp_replace(p_title, ' +', ' ', 'g'));
  if char_length(v_title) < 2 or char_length(v_title) > 120 then
    return null;
  end if;
  return v_title;
end;
$$;
revoke execute on function app_private.clean_title(text) from public, anon, authenticated;

/** A detail as it is stored: trimmed, up to 2,000 characters, line breaks
 * and tabs allowed, no other control character; empty is allowed. Null
 * when it is not acceptable. */
create function app_private.clean_detail(p_detail text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_detail text;
begin
  if p_detail is null then
    return '';
  end if;
  if p_detail ~ E'[\\x01-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]' then
    return null;
  end if;
  v_detail := btrim(p_detail);
  if char_length(v_detail) > 2000 then
    return null;
  end if;
  return v_detail;
end;
$$;
revoke execute on function app_private.clean_detail(text) from public, anon, authenticated;

/** A completed creation's own result, when the same actor repeats the
 * same key in the same scope: creations have no object to key on before
 * they exist, so the receipt's action is the key's namespace. */
create function app_private.scope_replay(
  p_actor uuid,
  p_environment_id uuid,
  p_client_id uuid,
  p_entity_id uuid,
  p_action text,
  p_key uuid
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select r.details -> 'result'
    from public.audit_receipts r
   where r.actor_user_id = p_actor
     and r.environment_id = p_environment_id
     and r.client_id = p_client_id
     and r.entity_id = p_entity_id
     and r.action = p_action
     and r.details ->> 'idempotency_key' = p_key::text
   order by r.occurred_at desc
   limit 1
$$;
revoke execute on function app_private.scope_replay(uuid, uuid, uuid, uuid, text, uuid)
  from public, anon, authenticated;

/** The acting staff role for the trail: the first of the roles the
 * person holds in the scope, in the order given. */
create function app_private.acting_role(
  p_uid uuid,
  p_environment_id uuid,
  p_client_id uuid,
  p_entity_id uuid,
  p_roles text[]
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select r
    from unnest(p_roles) with ordinality as roles(r, ord)
   where exists (
     select 1 from public.memberships m
      where m.user_id = p_uid and m.environment_id = p_environment_id
        and m.client_id = p_client_id and m.entity_id = p_entity_id and m.role = roles.r)
   order by ord
   limit 1
$$;
revoke execute on function app_private.acting_role(uuid, uuid, uuid, uuid, text[])
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Bounds (provisional).
-- ---------------------------------------------------------------------------
create function app_private.intake_limits()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('max_drafts_per_scope', 20, 'max_open_requests_per_case', 50,
                            'max_due_in_days', 365)
$$;
revoke execute on function app_private.intake_limits() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Transitions. Refusals are stable tokens (SQLSTATE P0001) the app words;
-- authorization failures are 42501 like a denied read.
-- ---------------------------------------------------------------------------

/** Intake opens a case as a draft. No activity event: a draft is "being
 * set up" and the trail begins when intake is recorded. */
create function public.open_case(
  p_environment_id uuid,
  p_client_id uuid,
  p_entity_id uuid,
  p_title text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_replay jsonb;
  v_title text;
  v_id uuid;
  v_now timestamptz := now();
  v_result jsonb;
begin
  if p_idempotency_key is null then
    raise exception 'invalid_idempotency_key';
  end if;
  v_uid := app_private.staff_member_for_scope(
    p_environment_id, p_client_id, p_entity_id, array['intake']);
  v_replay := app_private.scope_replay(
    v_uid, p_environment_id, p_client_id, p_entity_id, 'case.opened', p_idempotency_key);
  if v_replay is not null then
    return v_replay;
  end if;
  v_title := app_private.clean_title(p_title);
  if v_title is null then
    raise exception 'invalid_title';
  end if;
  if (select count(*) from public.cases c
       where c.environment_id = p_environment_id and c.client_id = p_client_id
         and c.entity_id = p_entity_id and c.status = 'DRAFT')
     >= (app_private.intake_limits() ->> 'max_drafts_per_scope')::int then
    raise exception 'too_many_drafts';
  end if;

  v_id := gen_random_uuid();
  insert into public.cases (id, environment_id, client_id, entity_id, title, status,
                            status_changed_at, created_at)
  values (v_id, p_environment_id, p_client_id, p_entity_id, v_title, 'DRAFT', v_now, v_now);

  v_result := jsonb_build_object('case_id', v_id, 'case_status', 'DRAFT', 'case_version', 1);
  perform app_private.append_audit(
    v_uid, p_environment_id, p_client_id, p_entity_id,
    'case.opened', 'case:' || v_id::text,
    jsonb_build_object('idempotency_key', p_idempotency_key, 'result', v_result));
  return v_result;
end;
$$;
revoke execute on function public.open_case(uuid, uuid, uuid, text, uuid) from public, anon;
grant execute on function public.open_case(uuid, uuid, uuid, text, uuid) to authenticated;

/** Intake records the intake: the case is "received" and the trail begins. */
create function public.record_case_intake(
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
  v_result jsonb;
begin
  if p_idempotency_key is null then
    raise exception 'invalid_idempotency_key';
  end if;
  v_uid := app_private.staff_member_for_scope(
    p_environment_id, p_client_id, p_entity_id, array['intake']);
  v_replay := app_private.case_replay(v_uid, p_case_id, p_idempotency_key);
  if v_replay is not null then
    return v_replay;
  end if;
  v_case := app_private.lock_case_at(
    p_environment_id, p_client_id, p_entity_id, p_case_id, p_case_version);
  if v_case.status <> 'DRAFT' then
    raise exception 'case_not_draft';
  end if;

  update public.cases
     set status = 'INTAKE_RECORDED', status_changed_at = v_now
   where id = p_case_id;
  perform app_private.record_case_event(v_case, 'case.intake_recorded', 'intake', v_now);

  v_result := jsonb_build_object(
    'case_status', 'INTAKE_RECORDED', 'case_version', v_case.version + 1);
  perform app_private.append_audit(
    v_uid, p_environment_id, p_client_id, p_entity_id,
    'case.intake_recorded', 'case:' || p_case_id::text,
    jsonb_build_object('idempotency_key', p_idempotency_key, 'from_status', v_case.status,
                       'result', v_result));
  return v_result;
end;
$$;
revoke execute on function public.record_case_intake(uuid, uuid, uuid, uuid, integer, uuid)
  from public, anon;
grant execute on function public.record_case_intake(uuid, uuid, uuid, uuid, integer, uuid)
  to authenticated;

/** Intake or the preparer asks the client for something. The first
 * request moves a received case to waiting on documents; further ones
 * leave the case as it is. A question may be about one checked document
 * of the same case. */
create function public.open_request(
  p_environment_id uuid,
  p_client_id uuid,
  p_entity_id uuid,
  p_case_id uuid,
  p_case_version integer,
  p_title text,
  p_detail text,
  p_due_in_days integer default null,
  p_subject_document_id uuid default null,
  p_idempotency_key uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_role text;
  v_case public.cases%rowtype;
  v_replay jsonb;
  v_title text;
  v_detail text;
  v_id uuid;
  v_now timestamptz := now();
  v_today date := current_date;
  v_status text;
  v_version integer;
  v_result jsonb;
begin
  if p_idempotency_key is null then
    raise exception 'invalid_idempotency_key';
  end if;
  v_uid := app_private.staff_member_for_scope(
    p_environment_id, p_client_id, p_entity_id, array['intake', 'preparer']);
  v_replay := app_private.scope_replay(
    v_uid, p_environment_id, p_client_id, p_entity_id, 'request.opened', p_idempotency_key);
  if v_replay is not null then
    return v_replay;
  end if;
  v_role := app_private.acting_role(
    v_uid, p_environment_id, p_client_id, p_entity_id, array['intake', 'preparer']);
  v_title := app_private.clean_title(p_title);
  if v_title is null then
    raise exception 'invalid_title';
  end if;
  v_detail := app_private.clean_detail(p_detail);
  if v_detail is null then
    raise exception 'invalid_detail';
  end if;
  if p_due_in_days is not null
     and (p_due_in_days < 1
          or p_due_in_days > (app_private.intake_limits() ->> 'max_due_in_days')::int) then
    raise exception 'invalid_due';
  end if;
  v_case := app_private.lock_case_at(
    p_environment_id, p_client_id, p_entity_id, p_case_id, p_case_version);
  if v_case.status not in ('INTAKE_RECORDED', 'EVIDENCE_PENDING') then
    raise exception 'case_not_open_for_requests';
  end if;
  if p_subject_document_id is not null and not exists (
    select 1 from public.document_uploads d
     where d.id = p_subject_document_id and d.case_id = p_case_id
       and d.environment_id = p_environment_id and d.client_id = p_client_id
       and d.entity_id = p_entity_id and d.status = 'ACCEPTED'
  ) then
    raise exception 'document_not_checked';
  end if;
  if (select count(*) from public.requests r where r.case_id = p_case_id and r.status = 'OPEN')
     >= (app_private.intake_limits() ->> 'max_open_requests_per_case')::int then
    raise exception 'too_many_requests';
  end if;

  v_id := gen_random_uuid();
  insert into public.requests (
    id, environment_id, client_id, entity_id, case_id, title, detail, owner_role, status,
    requested_on, due_on, subject_document_id, created_at
  ) values (
    v_id, p_environment_id, p_client_id, p_entity_id, p_case_id, v_title, v_detail,
    'client_user', 'OPEN', v_today,
    case when p_due_in_days is null then null else v_today + p_due_in_days end,
    p_subject_document_id, v_now
  );
  if v_case.status = 'INTAKE_RECORDED' then
    update public.cases
       set status = 'EVIDENCE_PENDING', status_changed_at = v_now
     where id = p_case_id;
    v_status := 'EVIDENCE_PENDING';
    v_version := v_case.version + 1;
  else
    v_status := v_case.status;
    v_version := v_case.version;
  end if;
  perform app_private.record_case_event(v_case, 'request.opened', v_role, v_now);

  v_result := jsonb_build_object(
    'request_id', v_id, 'request_version', 1,
    'case_status', v_status, 'case_version', v_version);
  perform app_private.append_audit(
    v_uid, p_environment_id, p_client_id, p_entity_id,
    'request.opened', 'request:' || v_id::text,
    jsonb_build_object('idempotency_key', p_idempotency_key, 'case_id', p_case_id,
                       'acting_role', v_role, 'due_in_days', p_due_in_days,
                       'subject_document_id', p_subject_document_id, 'result', v_result));
  return v_result;
end;
$$;
revoke execute on function public.open_request(uuid, uuid, uuid, uuid, integer, text, text, integer, uuid, uuid)
  from public, anon;
grant execute on function public.open_request(uuid, uuid, uuid, uuid, integer, text, text, integer, uuid, uuid)
  to authenticated;

/** Intake or the preparer closes an open or answered request. Nothing on
 * the case moves. */
create function public.close_request(
  p_environment_id uuid,
  p_client_id uuid,
  p_entity_id uuid,
  p_request_id uuid,
  p_request_version integer,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_role text;
  v_request public.requests%rowtype;
  v_case public.cases%rowtype;
  v_replay jsonb;
  v_now timestamptz := now();
  v_result jsonb;
begin
  if p_idempotency_key is null then
    raise exception 'invalid_idempotency_key';
  end if;
  v_uid := app_private.staff_member_for_scope(
    p_environment_id, p_client_id, p_entity_id, array['intake', 'preparer']);
  select r.details -> 'result' into v_replay
    from public.audit_receipts r
   where r.actor_user_id = v_uid
     and r.object_ref = 'request:' || p_request_id::text
     and r.action = 'request.closed'
     and r.details ->> 'idempotency_key' = p_idempotency_key::text
   order by r.occurred_at desc
   limit 1;
  if v_replay is not null then
    return v_replay;
  end if;
  v_role := app_private.acting_role(
    v_uid, p_environment_id, p_client_id, p_entity_id, array['intake', 'preparer']);
  select * into v_request from public.requests r
   where r.id = p_request_id and r.environment_id = p_environment_id
     and r.client_id = p_client_id and r.entity_id = p_entity_id
   for update;
  if not found then
    raise exception 'request_not_found';
  end if;
  if v_request.version <> p_request_version then
    raise exception 'request_changed';
  end if;
  if v_request.status not in ('OPEN', 'ANSWERED') then
    raise exception 'request_not_closable';
  end if;
  select * into v_case from public.cases c where c.id = v_request.case_id;

  update public.requests set status = 'CLOSED' where id = p_request_id;
  perform app_private.record_case_event(v_case, 'request.closed', v_role, v_now);

  v_result := jsonb_build_object(
    'request_id', p_request_id, 'request_status', 'CLOSED',
    'request_version', v_request.version + 1);
  perform app_private.append_audit(
    v_uid, p_environment_id, p_client_id, p_entity_id,
    'request.closed', 'request:' || p_request_id::text,
    jsonb_build_object('idempotency_key', p_idempotency_key, 'case_id', v_request.case_id,
                       'acting_role', v_role, 'from_status', v_request.status,
                       'result', v_result));
  return v_result;
end;
$$;
revoke execute on function public.close_request(uuid, uuid, uuid, uuid, integer, uuid)
  from public, anon;
grant execute on function public.close_request(uuid, uuid, uuid, uuid, integer, uuid)
  to authenticated;

/** Intake discards a draft that holds nothing. The row goes; the receipt
 * stays, in the entity's scope. A draft that already holds anything, or
 * a case past its draft, is kept. */
create function public.discard_case_draft(
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
  v_result jsonb;
begin
  if p_idempotency_key is null then
    raise exception 'invalid_idempotency_key';
  end if;
  v_uid := app_private.staff_member_for_scope(
    p_environment_id, p_client_id, p_entity_id, array['intake']);
  v_replay := app_private.case_replay(v_uid, p_case_id, p_idempotency_key);
  if v_replay is not null then
    return v_replay;
  end if;
  v_case := app_private.lock_case_at(
    p_environment_id, p_client_id, p_entity_id, p_case_id, p_case_version);
  if v_case.status <> 'DRAFT' then
    raise exception 'case_not_draft';
  end if;

  begin
    delete from public.cases where id = p_case_id;
  exception when foreign_key_violation then
    raise exception 'case_has_children';
  end;

  v_result := jsonb_build_object('case_id', p_case_id, 'case_status', 'DRAFT',
                                 'case_version', v_case.version, 'discarded', true);
  perform app_private.append_audit(
    v_uid, p_environment_id, p_client_id, p_entity_id,
    'case.draft_discarded', 'case:' || p_case_id::text,
    jsonb_build_object('idempotency_key', p_idempotency_key, 'result', v_result));
  return v_result;
end;
$$;
revoke execute on function public.discard_case_draft(uuid, uuid, uuid, uuid, integer, uuid)
  from public, anon;
grant execute on function public.discard_case_draft(uuid, uuid, uuid, uuid, integer, uuid)
  to authenticated;
