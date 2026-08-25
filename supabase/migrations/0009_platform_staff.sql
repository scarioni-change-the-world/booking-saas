-- The company's own team — not any one tenant's.
--
-- Every business already has tenant_members: a list of who may run that one
-- business, with what role. This is the same pattern one level up: a list of
-- who works for the company running this whole app, with what role. It sits
-- outside every tenant rather than being a bigger role inside tenant_members,
-- because it is not a bigger version of the same thing — a platform admin has
-- no membership row in any business at all; they reach the console through
-- this table instead.
--
-- Three roles, so the one person running this today can bring on help later
-- without a rebuild:
--
--   owner    full control — businesses AND who else is on staff.
--   admin    day-to-day running of businesses (create, suspend, look things
--             up). Cannot add or remove other staff.
--   support  can look things up to help a stuck business. Cannot suspend,
--             delete, or create.
--
-- Only 'owner' is actually used today (there is exactly one row). admin and
-- support exist so the day a second or third person joins, that is a single
-- insert, not new tables and no rethinking of anything already built.

create type platform_role as enum ('owner', 'admin', 'support');

create table platform_staff (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       platform_role not null,
  -- Who added this person, for the same reason a paper trail is worth having
  -- anywhere access is granted. Null rather than blocked if that person's own
  -- account is later removed — the history should outlive the account.
  added_by   uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Every tenant gets its settings row automatically, the moment it exists.
--
-- tenant_settings has always been "one row per tenant, created alongside the
-- tenant" (see the comment in migration 0001) — but until now that was only
-- ever true because every tenant so far was created by hand in seed.sql,
-- where the person writing the SQL remembered to insert both rows together.
-- The console is the first real, non-seed way to create a tenant, so the
-- invariant needs to be real rather than remembered: a trigger, not a second
-- insert an API route has to get right every time.
-- ---------------------------------------------------------------------------
create function create_default_tenant_settings() returns trigger
language plpgsql as $$
begin
  insert into tenant_settings (tenant_id) values (new.id);
  return new;
end;
$$;

create trigger tenants_create_settings
  after insert on tenants
  for each row execute function create_default_tenant_settings();

-- ---------------------------------------------------------------------------
-- RLS. Defense in depth, exactly as for every other table — the console's own
-- API routes are what actually gate access (they run as service_role, which
-- bypasses this), but the day a browser ever queries this table directly,
-- these policies are what stand between it and every business's data.
-- ---------------------------------------------------------------------------
create or replace function auth_is_platform_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from platform_staff where user_id = auth.uid());
$$;

create or replace function auth_is_platform_owner()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from platform_staff where user_id = auth.uid() and role = 'owner'
  );
$$;

revoke all on function auth_is_platform_staff() from public, anon;
revoke all on function auth_is_platform_owner() from public, anon;
grant execute on function auth_is_platform_staff() to authenticated;
grant execute on function auth_is_platform_owner() to authenticated;

alter table platform_staff enable row level security;
alter table platform_staff force row level security;

-- Any staff member can see who else is on staff...
create policy platform_staff_read on platform_staff
  for select to authenticated using (auth_is_platform_staff());

-- ...but only an owner can change it — add, remove, or promote someone.
create policy platform_staff_write on platform_staff
  for all to authenticated
  using (auth_is_platform_owner()) with check (auth_is_platform_owner());
