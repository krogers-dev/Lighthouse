-- HIVE Milestone 0: identity and isolation foundation.
--
-- Every domain row carries an immutable (environment_id, client_id,
-- entity_id) scope. Composite foreign keys make cross-boundary references
-- unrepresentable: a child row cannot point at a parent in another scope.
-- environment_id is defense in depth — each environment is a separate
-- Supabase project; nothing crosses environments even if a credential did.

-- Unexposed schema for privileged server-side logic. Not in the PostgREST
-- `schemas` list, so it has no API surface at all.
create schema if not exists app_private;

-- ---------------------------------------------------------------------------
-- Scope reference tables
-- ---------------------------------------------------------------------------

create table public.environments (
  id uuid primary key,
  name text not null unique,
  kind text not null check (kind in ('development', 'staging', 'production')),
  created_at timestamptz not null default now()
);

comment on table public.environments is
  'Defense-in-depth environment marker; real isolation is one Supabase project per environment.';

create table public.clients (
  id uuid primary key,
  environment_id uuid not null references public.environments (id),
  display_name text not null,
  created_at timestamptz not null default now(),
  unique (environment_id, id)
);

create table public.entities (
  id uuid primary key,
  environment_id uuid not null,
  client_id uuid not null,
  display_name text not null,
  created_at timestamptz not null default now(),
  unique (environment_id, client_id, id),
  foreign key (environment_id, client_id) references public.clients (environment_id, id)
);

-- ---------------------------------------------------------------------------
-- Memberships: the only source of scope authority. Server-controlled;
-- clients never insert, update, or delete these (no grants, no policies).
-- ---------------------------------------------------------------------------

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  environment_id uuid not null,
  client_id uuid not null,
  entity_id uuid not null,
  role text not null check (role in ('client_user', 'intake', 'preparer', 'reviewer', 'approver')),
  created_at timestamptz not null default now(),
  unique (user_id, environment_id, client_id, entity_id, role),
  foreign key (environment_id, client_id, entity_id)
    references public.entities (environment_id, client_id, id)
);

create index memberships_user_scope_idx
  on public.memberships (user_id, environment_id, client_id, entity_id);

-- ---------------------------------------------------------------------------
-- Workflow metadata (synthetic content only in Milestone 0)
-- ---------------------------------------------------------------------------

create table public.cases (
  id uuid primary key default gen_random_uuid(),
  environment_id uuid not null,
  client_id uuid not null,
  entity_id uuid not null,
  title text not null,
  status text not null default 'DRAFT' check (status in (
    'DRAFT', 'INTAKE_RECORDED', 'EVIDENCE_PENDING', 'READY_FOR_REVIEW',
    'IN_REVIEW', 'APPROVAL_PENDING', 'APPROVED', 'RETURNED', 'HOLD'
  )),
  status_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  -- Lets children FK onto the case *and* its scope in one constraint.
  unique (environment_id, client_id, entity_id, id),
  foreign key (environment_id, client_id, entity_id)
    references public.entities (environment_id, client_id, id)
);

create index cases_scope_idx on public.cases (environment_id, client_id, entity_id);

create table public.case_attention_items (
  id uuid primary key default gen_random_uuid(),
  environment_id uuid not null,
  client_id uuid not null,
  entity_id uuid not null,
  case_id uuid not null,
  summary text not null,
  created_at timestamptz not null default now(),
  -- The composite reference prevents an attention item from ever pointing
  -- at a case in a different environment, client, or entity.
  foreign key (environment_id, client_id, entity_id, case_id)
    references public.cases (environment_id, client_id, entity_id, id)
);

create index case_attention_items_scope_idx
  on public.case_attention_items (environment_id, client_id, entity_id);
create index case_attention_items_case_idx on public.case_attention_items (case_id);

create table public.case_next_actions (
  id uuid primary key default gen_random_uuid(),
  environment_id uuid not null,
  client_id uuid not null,
  entity_id uuid not null,
  case_id uuid not null,
  summary text not null,
  owner_role text not null check (owner_role in (
    'client_user', 'intake', 'preparer', 'reviewer', 'approver'
  )),
  created_at timestamptz not null default now(),
  foreign key (environment_id, client_id, entity_id, case_id)
    references public.cases (environment_id, client_id, entity_id, id)
);

create index case_next_actions_scope_idx
  on public.case_next_actions (environment_id, client_id, entity_id);
create index case_next_actions_case_idx on public.case_next_actions (case_id);

-- ---------------------------------------------------------------------------
-- Append-only audit receipts. Written only by privileged server logic;
-- clients hold no grant at all in Milestone 0.
-- ---------------------------------------------------------------------------

create table public.audit_receipts (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_user_id uuid,
  environment_id uuid not null,
  client_id uuid not null,
  entity_id uuid not null,
  action text not null,
  object_ref text not null,
  details jsonb not null default '{}'::jsonb,
  foreign key (environment_id, client_id, entity_id)
    references public.entities (environment_id, client_id, id)
);

create index audit_receipts_scope_idx
  on public.audit_receipts (environment_id, client_id, entity_id, occurred_at);

-- ---------------------------------------------------------------------------
-- Immutability triggers
-- ---------------------------------------------------------------------------

create function app_private.reject_scope_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.environment_id is distinct from old.environment_id
     or new.client_id is distinct from old.client_id
     or new.entity_id is distinct from old.entity_id then
    raise exception 'scope columns are immutable';
  end if;
  return new;
end;
$$;

-- clients and entities carry partial scope; any change to what they do
-- carry is a boundary change and is rejected outright.
create function app_private.reject_scope_change_partial()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'scope columns are immutable';
end;
$$;

create trigger clients_scope_immutable
  before update of environment_id on public.clients
  for each row execute function app_private.reject_scope_change_partial();

create trigger entities_scope_immutable
  before update of environment_id, client_id on public.entities
  for each row execute function app_private.reject_scope_change_partial();

create trigger memberships_scope_immutable
  before update on public.memberships
  for each row execute function app_private.reject_scope_change();

create trigger cases_scope_immutable
  before update on public.cases
  for each row execute function app_private.reject_scope_change();

create trigger case_attention_items_scope_immutable
  before update on public.case_attention_items
  for each row execute function app_private.reject_scope_change();

create trigger case_next_actions_scope_immutable
  before update on public.case_next_actions
  for each row execute function app_private.reject_scope_change();

create function app_private.reject_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit receipts are append-only';
end;
$$;

create trigger audit_receipts_append_only
  before update or delete on public.audit_receipts
  for each row execute function app_private.reject_mutation();

-- ---------------------------------------------------------------------------
-- Privileged server-side audit writer: the pattern for every future
-- sensitive transition. Unexposed schema, fixed search_path, no PUBLIC
-- execution (revokes are in the grants migration).
-- ---------------------------------------------------------------------------

create function app_private.append_audit(
  p_actor_user_id uuid,
  p_environment_id uuid,
  p_client_id uuid,
  p_entity_id uuid,
  p_action text,
  p_object_ref text,
  p_details jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_environment_id is null or p_client_id is null or p_entity_id is null then
    raise exception 'audit receipts require full scope';
  end if;
  insert into public.audit_receipts (
    actor_user_id, environment_id, client_id, entity_id, action, object_ref, details
  ) values (
    p_actor_user_id, p_environment_id, p_client_id, p_entity_id, p_action, p_object_ref, p_details
  ) returning id into v_id;
  return v_id;
end;
$$;
