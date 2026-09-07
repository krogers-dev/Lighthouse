-- Milestone 1 read surfaces: requests and activity events.
--
-- Two new PROTECTED tables joining the six from Milestone 0. Both are
-- read-only from the mobile app in this milestone: `select` is the only
-- grant, so no write policy exists to get wrong. Both follow the
-- Milestone 0 scope pattern exactly rather than inventing a parallel
-- shape (WO-002 T1: policy drift between tables is the threat):
--
--   1. composite FK into public.cases so a row can never point at a case
--      in a different environment, client, or entity;
--   2. indexed policy columns;
--   3. a PERMISSIVE membership policy carrying pure scope logic;
--   4. a RESTRICTIVE staff-AAL2 policy ANDed on top, so a later
--      permissive policy cannot OR its way around the staff gate.

-- ---------------------------------------------------------------------------
-- requests (WO-002 R2)
-- ---------------------------------------------------------------------------

create table public.requests (
  id uuid primary key default gen_random_uuid(),
  environment_id uuid not null,
  client_id uuid not null,
  entity_id uuid not null,
  case_id uuid not null,
  title text not null,
  detail text not null,
  -- Who owns the next move on this request. A ROLE, never a person.
  owner_role text not null check (
    owner_role in ('client_user', 'intake', 'preparer', 'reviewer', 'approver')
  ),
  status text not null default 'OPEN' check (
    status in ('OPEN', 'ANSWERED', 'CLOSED', 'EXPIRED')
  ),
  requested_on date not null,
  due_on date,
  created_at timestamptz not null default now(),
  foreign key (environment_id, client_id, entity_id, case_id)
    references public.cases (environment_id, client_id, entity_id, id),
  -- A due date before the request existed is not a real due date.
  constraint requests_due_after_requested check (due_on is null or due_on >= requested_on)
);

create index requests_scope_idx on public.requests (environment_id, client_id, entity_id);
create index requests_case_idx on public.requests (case_id);

-- ---------------------------------------------------------------------------
-- activity_events (WO-002 R3, threat T3)
-- ---------------------------------------------------------------------------
--
-- DELIBERATELY has no free-text column. Activity is an append-only read
-- surface, and free text is exactly how excluded fields (personal names,
-- filenames, financial values, document content) leak into a screen, a
-- log, or a screenshot. A row carries only an enumerated event kind, an
-- acting ROLE label, and a server timestamp. Rendering is the client's
-- job: the enum maps to approved wording in the app, so the wording can
-- be corrected without a data migration and the database can never carry
-- a sentence somebody wrote.

create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  environment_id uuid not null,
  client_id uuid not null,
  entity_id uuid not null,
  case_id uuid not null,
  event_kind text not null check (
    event_kind in (
      'case.status_changed',
      'request.opened',
      'request.answered',
      'request.closed',
      'request.expired'
    )
  ),
  -- The acting role, never a personal name (Milestone 1 rule).
  actor_role text not null check (
    actor_role in ('client_user', 'intake', 'preparer', 'reviewer', 'approver', 'system')
  ),
  occurred_at timestamptz not null default now(),
  foreign key (environment_id, client_id, entity_id, case_id)
    references public.cases (environment_id, client_id, entity_id, id)
);

create index activity_events_scope_idx
  on public.activity_events (environment_id, client_id, entity_id);
create index activity_events_case_idx on public.activity_events (case_id);
-- Bounded newest-first reads (R3) without scanning the table.
create index activity_events_recent_idx
  on public.activity_events (environment_id, client_id, entity_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Least-privilege grants: read only, and only to authenticated.
-- ---------------------------------------------------------------------------

grant select on public.requests to authenticated;
grant select on public.activity_events to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: permissive scope + restrictive staff-AAL2, matching Milestone 0.
-- ---------------------------------------------------------------------------

alter table public.requests enable row level security;
alter table public.activity_events enable row level security;

create policy requests_select_by_membership
  on public.requests
  for select
  to authenticated
  using (
    exists (
      select 1 from public.memberships m
      where m.user_id = (select auth.uid())
        and m.environment_id = requests.environment_id
        and m.client_id = requests.client_id
        and m.entity_id = requests.entity_id
    )
  );

create policy activity_events_select_by_membership
  on public.activity_events
  for select
  to authenticated
  using (
    exists (
      select 1 from public.memberships m
      where m.user_id = (select auth.uid())
        and m.environment_id = activity_events.environment_id
        and m.client_id = activity_events.client_id
        and m.entity_id = activity_events.entity_id
    )
  );

create policy requests_staff_requires_aal2
  on public.requests
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

create policy activity_events_staff_requires_aal2
  on public.activity_events
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
