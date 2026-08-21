-- Restrictive staff-AAL2 separation (second RETURN directive, area 3).
--
-- 20260821120004 folded the staff-AAL2 invariant into the permissive
-- scope policies. Permissive policies OR together, so any later
-- permissive policy added to one of these tables would have bypassed the
-- staff gate entirely. The invariant is a boundary rule, not a grant:
-- it now lives in AS RESTRICTIVE policies (ANDed with whatever the
-- permissive layer allows), and the scope policies go back to pure
-- membership scope checks.
--
-- Invariant (unchanged): if the current user holds ANY staff membership,
-- every protected select requires an aal2 JWT claim; a missing claim
-- counts as aal1 and fails closed. A user's own rows in
-- public.memberships stay visible at AAL1 (ids and roles only — the
-- documented exception for MFA routing; SECURITY.md).

-- 1. Scope policies: pure membership scope checks (permissive layer).

drop policy environments_select_by_membership on public.environments;
drop policy clients_select_by_membership on public.clients;
drop policy entities_select_by_membership on public.entities;
drop policy cases_select_by_membership on public.cases;
drop policy case_attention_items_select_by_membership on public.case_attention_items;
drop policy case_next_actions_select_by_membership on public.case_next_actions;

create policy environments_select_by_membership
  on public.environments
  for select
  to authenticated
  using (
    exists (
      select 1 from public.memberships m
      where m.user_id = (select auth.uid())
        and m.environment_id = environments.id
    )
  );

create policy clients_select_by_membership
  on public.clients
  for select
  to authenticated
  using (
    exists (
      select 1 from public.memberships m
      where m.user_id = (select auth.uid())
        and m.environment_id = clients.environment_id
        and m.client_id = clients.id
    )
  );

create policy entities_select_by_membership
  on public.entities
  for select
  to authenticated
  using (
    exists (
      select 1 from public.memberships m
      where m.user_id = (select auth.uid())
        and m.environment_id = entities.environment_id
        and m.client_id = entities.client_id
        and m.entity_id = entities.id
    )
  );

create policy cases_select_by_membership
  on public.cases
  for select
  to authenticated
  using (
    exists (
      select 1 from public.memberships m
      where m.user_id = (select auth.uid())
        and m.environment_id = cases.environment_id
        and m.client_id = cases.client_id
        and m.entity_id = cases.entity_id
    )
  );

create policy case_attention_items_select_by_membership
  on public.case_attention_items
  for select
  to authenticated
  using (
    exists (
      select 1 from public.memberships m
      where m.user_id = (select auth.uid())
        and m.environment_id = case_attention_items.environment_id
        and m.client_id = case_attention_items.client_id
        and m.entity_id = case_attention_items.entity_id
    )
  );

create policy case_next_actions_select_by_membership
  on public.case_next_actions
  for select
  to authenticated
  using (
    exists (
      select 1 from public.memberships m
      where m.user_id = (select auth.uid())
        and m.environment_id = case_next_actions.environment_id
        and m.client_id = case_next_actions.client_id
        and m.entity_id = case_next_actions.entity_id
    )
  );

-- 2. Staff-AAL2 invariant: restrictive layer. ANDed with the permissive
--    layer, so no future permissive policy can bypass it.

create policy environments_staff_requires_aal2
  on public.environments
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

create policy clients_staff_requires_aal2
  on public.clients
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

create policy entities_staff_requires_aal2
  on public.entities
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

create policy cases_staff_requires_aal2
  on public.cases
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

create policy case_attention_items_staff_requires_aal2
  on public.case_attention_items
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

create policy case_next_actions_staff_requires_aal2
  on public.case_next_actions
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
