-- Look up an existing login by email address.
--
-- The console invites a business's owner through Supabase's admin API, which
-- refuses any address that already has an account. That made the single most
-- common first action on the platform — the operator creating their own first
-- business, under the address they already sign in with — fail outright, and
-- roll the half-created business back. Reusing one login across businesses is
-- a real thing people do; it needed a way to find that login.
--
-- Supabase's client library has no "get user by email": listUsers pages
-- through every account on the project, which is a scan that gets slower
-- exactly as the platform succeeds. A function is exact and O(index).
--
-- security definer because auth.users belongs to the auth schema and is not
-- reachable through PostgREST at all. That grants no new power: execute is
-- service_role only, and service_role already bypasses RLS everywhere. The
-- return is a uuid and nothing else — no email, no password hash, no
-- metadata — so this cannot become a way to enumerate accounts even if the
-- grant were later widened by mistake.
--
-- search_path is pinned empty and every reference fully qualified, so a
-- schema planted earlier on someone's path cannot shadow auth.users inside a
-- definer function.

create or replace function public.auth_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id
  from auth.users
  where lower(email) = lower(trim(p_email))
    -- Soft-deleted accounts still occupy the row. Treating one as a live
    -- login would attach a business to an account nobody can sign into.
    and deleted_at is null
  limit 1;
$$;

revoke all on function public.auth_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.auth_user_id_by_email(text) to service_role;

-- PostgREST caches the set of callable functions; without this the first RPC
-- after deploying this migration returns "function not found" until the pool
-- happens to recycle.
notify pgrst, 'reload schema';
