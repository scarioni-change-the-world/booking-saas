-- Row-Level Security.
--
-- Brief 7.1 asks the isolation question directly and answers it: prefer real
-- RLS over disciplined app-level scoping, because one missed WHERE clause leaks
-- another tenant's client list. This migration is that choice, made concrete.
--
-- Two roles, two very different postures:
--
--   authenticated — the dashboard. Real policies, keyed on membership in
--                   tenant_members. A signed-in user of tenant A cannot read a
--                   row of tenant B even if the application forgets to filter.
--
--   anon          — denied everything, on every table. The public booking
--                   widget never talks to Postgres directly; it goes through
--                   server route handlers. This preserves the reference
--                   implementation's posture (RLS on, zero anon policies) for
--                   the public surface while adding genuine policies for the
--                   authenticated surface that did not exist before.
--
-- service_role bypasses RLS by design, so the server-side data layer in
-- src/lib/db/scope.ts is what keeps the public path honest. It makes tenant
-- scoping structural rather than remembered — see the note there.

-- ---------------------------------------------------------------------------
-- Membership helpers
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER, so the lookup inside a tenant_members policy does not
-- re-enter that same policy and recurse. search_path is pinned: a SECURITY
-- DEFINER function with a mutable search_path is a privilege-escalation hole.

create or replace function auth_is_tenant_member(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from tenant_members m
    where m.tenant_id = target and m.user_id = auth.uid()
  );
$$;

create or replace function auth_is_tenant_admin(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from tenant_members m
    where m.tenant_id = target
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin')
  );
$$;

revoke all on function auth_is_tenant_member(uuid) from public, anon;
revoke all on function auth_is_tenant_admin(uuid)  from public, anon;
grant execute on function auth_is_tenant_member(uuid) to authenticated;
grant execute on function auth_is_tenant_admin(uuid)  to authenticated;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere. Default deny; nothing is readable without a policy.
-- ---------------------------------------------------------------------------
alter table tenants                 enable row level security;
alter table tenant_members          enable row level security;
alter table tenant_settings         enable row level security;
alter table event_types             enable row level security;
alter table availability_rules      enable row level security;
alter table date_overrides          enable row level security;
alter table blocked_slots           enable row level security;
alter table qualification_questions enable row level security;
alter table qualification_responses enable row level security;
alter table bookings                enable row level security;
alter table reserved_slugs          enable row level security;

-- Force RLS for table owners too, so a future migration running as owner does
-- not quietly become the one context where isolation does not apply.
alter table tenants                 force row level security;
alter table tenant_members          force row level security;
alter table tenant_settings         force row level security;
alter table event_types             force row level security;
alter table availability_rules      force row level security;
alter table date_overrides          force row level security;
alter table blocked_slots           force row level security;
alter table qualification_questions force row level security;
alter table qualification_responses force row level security;
alter table bookings                force row level security;
alter table reserved_slugs          force row level security;

-- ---------------------------------------------------------------------------
-- tenants / tenant_members / tenant_settings
-- ---------------------------------------------------------------------------
create policy tenants_read_own on tenants
  for select to authenticated
  using (auth_is_tenant_member(id));

-- Tenant creation and deletion are provisioning concerns, handled server-side.
create policy tenants_update_own on tenants
  for update to authenticated
  using (auth_is_tenant_admin(id))
  with check (auth_is_tenant_admin(id));

create policy members_read on tenant_members
  for select to authenticated
  using (auth_is_tenant_member(tenant_id));

create policy members_write on tenant_members
  for all to authenticated
  using (auth_is_tenant_admin(tenant_id))
  with check (auth_is_tenant_admin(tenant_id));

create policy settings_read on tenant_settings
  for select to authenticated
  using (auth_is_tenant_member(tenant_id));

create policy settings_write on tenant_settings
  for update to authenticated
  using (auth_is_tenant_admin(tenant_id))
  with check (auth_is_tenant_admin(tenant_id));

-- ---------------------------------------------------------------------------
-- Tenant-scoped configuration tables
-- ---------------------------------------------------------------------------
-- Same shape for each: members read, admins write. The WITH CHECK clause is the
-- half that matters most — without it a member could move a row to another
-- tenant by updating tenant_id.

create policy event_types_read on event_types
  for select to authenticated using (auth_is_tenant_member(tenant_id));
create policy event_types_write on event_types
  for all to authenticated
  using (auth_is_tenant_admin(tenant_id)) with check (auth_is_tenant_admin(tenant_id));

create policy availability_read on availability_rules
  for select to authenticated using (auth_is_tenant_member(tenant_id));
create policy availability_write on availability_rules
  for all to authenticated
  using (auth_is_tenant_admin(tenant_id)) with check (auth_is_tenant_admin(tenant_id));

create policy overrides_read on date_overrides
  for select to authenticated using (auth_is_tenant_member(tenant_id));
create policy overrides_write on date_overrides
  for all to authenticated
  using (auth_is_tenant_admin(tenant_id)) with check (auth_is_tenant_admin(tenant_id));

create policy blocked_read on blocked_slots
  for select to authenticated using (auth_is_tenant_member(tenant_id));
-- Members (not just admins) block slots — it is day-to-day diary work.
create policy blocked_write on blocked_slots
  for all to authenticated
  using (auth_is_tenant_member(tenant_id)) with check (auth_is_tenant_member(tenant_id));

create policy questions_read on qualification_questions
  for select to authenticated using (auth_is_tenant_member(tenant_id));
create policy questions_write on qualification_questions
  for all to authenticated
  using (auth_is_tenant_admin(tenant_id)) with check (auth_is_tenant_admin(tenant_id));

-- ---------------------------------------------------------------------------
-- Personal data: responses and bookings
-- ---------------------------------------------------------------------------
-- Read-only to the dashboard. Bookings are created and cancelled through server
-- routes so that calendar sync and email stay on one path; the dashboard's
-- "cancel on the client's behalf" action calls that route rather than UPDATE.

create policy responses_read on qualification_responses
  for select to authenticated using (auth_is_tenant_member(tenant_id));

create policy bookings_read on bookings
  for select to authenticated using (auth_is_tenant_member(tenant_id));

-- ---------------------------------------------------------------------------
-- Nothing is granted to anon, anywhere. Stated explicitly rather than left
-- implicit, so a later `grant ... to anon` reads as the deliberate act it is.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
