-- Table privileges for service_role.
--
-- Supabase's "Automatically expose new tables" setting is what normally grants
-- table privileges to the Data API roles. Disabling it — the right call, since
-- it stops anon being granted access to every new table by default — also
-- withholds them from `service_role`, which is the role every server-side
-- request in this app runs as.
--
-- The distinction that makes this easy to get wrong: service_role carries
-- BYPASSRLS, so it ignores every policy in 0005. It does NOT bypass GRANTs.
-- Row-level security and table privileges are independent checks, and a role
-- needs to pass both. Without this migration the whole app fails with
-- "permission denied for table tenants" while the RLS model is perfectly fine.
--
-- Granting explicitly here is better than relying on the dashboard toggle
-- anyway: the privileges live in version control next to the policies they
-- accompany, rather than in a setting someone can flip without a trace.

grant usage on schema public to service_role;

grant select, insert, update, delete on all tables in schema public to service_role;

-- Future tables. Without this, migration 0008 would reintroduce the same
-- outage for whatever it creates.
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;

-- Deliberately NOT granted here:
--
--   anon           nothing, on any table. The public booking widget is served
--                  by route handlers, never by direct PostgREST access.
--
--   authenticated  nothing yet. The dashboard talks to this app's own /api
--                  routes, which authenticate the caller and then use
--                  service_role. The policies in 0005 are defence in depth
--                  until the day the browser queries Supabase directly — at
--                  which point add the grants in their own migration, so that
--                  opening the surface is a deliberate, reviewable act.
