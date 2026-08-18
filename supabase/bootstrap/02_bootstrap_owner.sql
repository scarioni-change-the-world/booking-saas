-- =============================================================================
-- booking-saas — link your login to the demo tenant
-- =============================================================================
-- Run this AFTER full_setup.sql, and after creating a user in the Supabase
-- dashboard (Authentication -> Users -> Add user).
--
-- Why this is a manual step: there is no signup flow yet, so nothing creates
-- the tenant_members row that grants you admin access. Without it every
-- /api/admin/... route returns 404 — deliberately, since that is what stops a
-- signed-in user administering a tenant they do not belong to.
--
-- Milestone 2's onboarding wizard replaces this.
-- =============================================================================

-- >>> CHANGE THIS to the email you registered in the dashboard <<<
insert into tenant_members (tenant_id, user_id, role)
select
  '00000000-0000-4000-8000-000000000001',  -- the demo-coaching tenant
  u.id,
  'owner'
from auth.users u
where u.email = 'you@example.com'
on conflict (tenant_id, user_id) do update set role = 'owner';

-- Verification. One row means you are in; zero rows means the email did not
-- match a user — check for a typo rather than re-running.
select
  t.slug        as tenant,
  u.email       as member,
  m.role
from tenant_members m
join tenants t on t.id = m.tenant_id
join auth.users u on u.id = m.user_id;
