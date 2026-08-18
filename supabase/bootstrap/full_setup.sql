-- =============================================================================
-- booking-saas — complete database setup
-- =============================================================================
-- Paste this whole file into the Supabase SQL editor and run it once.
--
-- It contains migrations 0001-0008 plus the development seed, in order, wrapped
-- in a single transaction: if anything fails, nothing is applied and you can
-- fix and re-run against a clean schema rather than a half-built one.
--
-- Safe to run only ONCE on a fresh project. Re-running fails on the first
-- CREATE TABLE, which is the intended behaviour — it stops you silently
-- double-seeding.
--
-- After this, see 02_bootstrap_owner.sql to link your login to the demo tenant.
-- =============================================================================

begin;


-- ==========================================================================
-- supabase/migrations/0001_tenancy.sql
-- ==========================================================================

-- Tenancy foundation.
--
-- The single-tenant reference implementation scoped everything to an implicit
-- `coach_settings` row with id = 1. Here the business is a first-class row in
-- `tenants`, and every other table carries `tenant_id`.

create extension if not exists "pgcrypto";

create type tenant_plan   as enum ('trial', 'starter', 'pro', 'cancelled');
create type tenant_status as enum ('active', 'suspended', 'deleted');
create type member_role   as enum ('owner', 'admin', 'member');

create table tenants (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  timezone    text not null default 'UTC',
  plan        tenant_plan   not null default 'trial',
  status      tenant_status not null default 'active',
  -- Branding drives both the widget and the email templates (brief 7.5).
  branding    jsonb not null default '{}'::jsonb,
  -- Domains permitted to embed this tenant's widget. Feeds the per-tenant
  -- frame-ancestors CSP that replaces the hard-coded vercel.json allowlist.
  embed_domains text[] not null default '{}',
  created_at  timestamptz not null default now(),

  constraint tenants_slug_format check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$')
);

-- Reserved slugs would otherwise collide with application routes.
create table reserved_slugs (slug text primary key);
insert into reserved_slugs (slug) values
  ('api'), ('app'), ('admin'), ('auth'), ('t'), ('manage'), ('login'),
  ('signup'), ('billing'), ('dashboard'), ('www'), ('static'), ('public');

alter table tenants add constraint tenants_slug_not_reserved
  check (slug not in (
    'api','app','admin','auth','t','manage','login',
    'signup','billing','dashboard','www','static','public'
  ));

-- Team accounts (brief 7.1). One row per user per tenant.
create table tenant_members (
  tenant_id  uuid not null references tenants(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       member_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create index tenant_members_user_idx on tenant_members (user_id);

-- Was `coach_settings`. One row per tenant, created alongside the tenant.
create table tenant_settings (
  tenant_id                 uuid primary key references tenants(id) on delete cascade,
  booking_notice_hours      integer not null default 24,
  -- 0 means unlimited, matching the reference implementation.
  booking_window_days       integer not null default 60,
  disqualification_message  text not null default '',
  disqualification_redirect_url   text,
  disqualification_redirect_label text,
  notification_email        text,
  reply_to_email            text,
  updated_at                timestamptz not null default now(),

  constraint notice_hours_sane  check (booking_notice_hours between 0 and 8760),
  constraint window_days_sane   check (booking_window_days between 0 and 3650)
);

-- ==========================================================================
-- supabase/migrations/0002_booking_core.sql
-- ==========================================================================

-- Event types, availability rules, date overrides, ad-hoc blocks.

create table event_types (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  slug          text not null,
  name          text not null,
  description   text,
  duration_minutes       integer not null,
  buffer_before_minutes  integer not null default 0,
  buffer_after_minutes   integer not null default 0,
  color         text not null default '#111111',
  sort_order    integer not null default 0,

  -- Independent booleans, NOT opposites (brief 2.1). A type may be visible to
  -- both audiences, either, or neither. Treating this as one flag was a bug in
  -- an early version of the reference implementation.
  available_to_prospects        boolean not null default false,
  available_to_existing_clients boolean not null default false,

  active        boolean not null default true,
  created_at    timestamptz not null default now(),

  -- Was globally unique in the single-tenant system; now per tenant (brief 7.1).
  constraint event_types_slug_per_tenant unique (tenant_id, slug),
  constraint event_types_duration_sane check (duration_minutes between 5 and 1440),
  constraint event_types_buffers_sane
    check (buffer_before_minutes between 0 and 720 and buffer_after_minutes between 0 and 720)
);

create index event_types_tenant_idx on event_types (tenant_id, active, sort_order);

-- Weekly recurring availability. weekday follows Luxon: 1 = Monday .. 7 = Sunday.
create table availability_rules (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  weekday    smallint not null,
  start_time time not null,
  end_time   time not null,
  created_at timestamptz not null default now(),

  constraint availability_weekday_range check (weekday between 1 and 7),
  constraint availability_start_before_end check (start_time < end_time)
);

create index availability_rules_tenant_idx on availability_rules (tenant_id, weekday);

-- Whole-day closures (holidays) or special hours for a specific date.
create table date_overrides (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  date       date not null,
  is_closed  boolean not null default true,
  start_time time,
  end_time   time,
  note       text,
  created_at timestamptz not null default now(),

  -- Was unique on `date` alone in the single-tenant system (brief 7.1).
  constraint date_overrides_per_tenant unique (tenant_id, date),
  -- An open override must carry both ends of its special hours.
  constraint date_overrides_hours_complete check (
    is_closed or (start_time is not null and end_time is not null and start_time < end_time)
  )
);

-- Ad-hoc blocks placed from the admin day grid. Stored as absolute instants so
-- the slot engine can treat them exactly like any other busy interval.
create table blocked_slots (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  reason     text,
  created_at timestamptz not null default now(),

  constraint blocked_slots_start_before_end check (starts_at < ends_at)
);

create index blocked_slots_tenant_range_idx on blocked_slots (tenant_id, starts_at, ends_at);

-- ==========================================================================
-- supabase/migrations/0003_qualification.sql
-- ==========================================================================

-- The qualification gate — the product's differentiator (brief 1, 2.2).

create type question_kind      as enum ('text', 'yes_no', 'single_choice');
create type qualification_outcome as enum ('qualified', 'redirected');

create table qualification_questions (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  prompt     text not null,
  kind       question_kind not null,
  -- For single_choice: [{ "label": "...", "qualifies": true|false }, ...].
  -- Each option carries its own flag; ANY option with qualifies=false
  -- disqualifies the whole response (brief 2.2).
  options    jsonb not null default '[]'::jsonb,
  required   boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),

  -- yes_no and single_choice both need options; free text must not have them.
  constraint qualification_options_shape check (
    case kind
      when 'text' then jsonb_array_length(options) = 0
      else jsonb_array_length(options) > 0
    end
  )
);

create index qualification_questions_tenant_idx
  on qualification_questions (tenant_id, sort_order);

create table qualification_responses (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  -- Snapshot of the answers: [{ question_id, prompt, kind, answer, qualifies }].
  -- Denormalised on purpose so a later edit or hard delete of a question does
  -- not rewrite history the tenant may need to review.
  answers    jsonb not null,
  outcome    qualification_outcome not null,
  email      text,
  created_at timestamptz not null default now()
);

create index qualification_responses_tenant_idx
  on qualification_responses (tenant_id, created_at desc);

-- ==========================================================================
-- supabase/migrations/0004_bookings.sql
-- ==========================================================================

-- Bookings and the token-based self-service management path (brief 2.4).

create type booking_status as enum ('confirmed', 'cancelled');
-- brief 6.9: a swallowed calendar error must leave a trace on the row.
create type sync_status    as enum ('pending', 'synced', 'failed', 'not_configured');

create table bookings (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  event_type_id uuid not null references event_types(id) on delete restrict,

  -- The token IS the credential — no login (brief 2.4). Unguessable, unique.
  manage_token  text not null unique,

  starts_at     timestamptz not null,
  ends_at       timestamptz not null,

  name          text not null,
  email         text not null,
  notes         text,

  status              booking_status not null default 'confirmed',
  cancelled_at        timestamptz,
  cancellation_reason text,

  qualification_response_id uuid references qualification_responses(id) on delete set null,

  -- Calendar sync state. Failures are recorded rather than swallowed (brief 6.9)
  -- so the dashboard can surface a degraded integration (brief 6.8).
  calendar_event_id text,
  meeting_url       text,
  sync_status       sync_status not null default 'pending',
  sync_error        text,

  reminder_sent_at  timestamptz,
  created_at        timestamptz not null default now(),

  constraint bookings_start_before_end check (starts_at < ends_at),
  constraint bookings_cancelled_consistent check (
    (status = 'cancelled') = (cancelled_at is not null)
  )
);

create index bookings_tenant_range_idx on bookings (tenant_id, starts_at)
  where status = 'confirmed';
create index bookings_reminder_idx on bookings (starts_at)
  where status = 'confirmed' and reminder_sent_at is null;

-- Belt and braces against a double booking racing past the application check.
-- Only confirmed bookings participate; cancelling frees the slot (brief 2.4).
--
-- Scoped to the tenant, which is right while every tenant is one person with
-- one calendar. Round-robin and collective scheduling (brief 8) introduce a
-- host per booking, and this constraint must then be keyed on the host rather
-- than the tenant — otherwise two colleagues could never be booked at once.
create extension if not exists btree_gist;

alter table bookings add column period tstzrange
  generated always as (tstzrange(starts_at, ends_at, '[)')) stored;

alter table bookings add constraint bookings_no_overlap
  exclude using gist (
    tenant_id with =,
    period    with &&
  ) where (status = 'confirmed');

-- ==========================================================================
-- supabase/migrations/0005_rls.sql
-- ==========================================================================

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

-- ==========================================================================
-- supabase/migrations/0006_calendar_connections.sql
-- ==========================================================================

-- Per-tenant calendar connections.
--
-- One row per tenant per provider. Google today; the table is provider-keyed so
-- Microsoft 365 (brief 7.6) is a second row rather than a second table.

create type calendar_provider_id as enum ('google', 'microsoft');

-- Distinguishes "never connected" from "connected but the grant died", which
-- brief 6.3 makes an operational necessity rather than a nicety: a refresh
-- token issued while the OAuth app is in Testing mode expires after ~7 days,
-- and the failure otherwise looks identical to no connection at all.
create type calendar_connection_status as enum ('active', 'needs_reconnect', 'revoked');

create table calendar_connections (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  provider      calendar_provider_id not null,

  account_email text not null,
  -- The calendar written to and read for busy. 'primary' unless the tenant
  -- picks another.
  calendar_id   text not null default 'primary',

  -- Encrypted at rest with APP_SECRET (see src/lib/crypto.ts). service_role can
  -- read every row in this table, so storing a long-lived Google grant in
  -- plaintext would make a leaked database dump a leaked mailbox.
  refresh_token_encrypted text not null,

  -- Cached access token. Brief 7.7: the reference implementation refreshed on
  -- every single request, which does not survive many tenants — Google's quota
  -- is per OAuth client and shared across all of them.
  access_token_encrypted  text,
  access_token_expires_at timestamptz,

  -- The scopes this grant was actually issued with. Brief 6.4: changing the
  -- consent screen does not retroactively alter an existing token, so a
  -- connection can keep working for weeks and then break on the next reconnect.
  -- Recording what was granted is what makes that diagnosable.
  granted_scopes text[] not null default '{}',

  status calendar_connection_status not null default 'active',

  -- Brief 6.8: a health check that never called the provider is not a health
  -- check. Storing when it last ran lets the dashboard distinguish "checked and
  -- healthy" from "never checked".
  last_checked_at timestamptz,
  last_error      text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint calendar_connections_one_per_provider unique (tenant_id, provider)
);

create index calendar_connections_tenant_idx on calendar_connections (tenant_id);

alter table calendar_connections enable row level security;
alter table calendar_connections force row level security;

-- Members may see that a calendar is connected and whether it is healthy.
-- The token columns are never selected by the dashboard; the server-side
-- provider reads them as service_role. Splitting the secrets into a separate
-- table would be stricter, but the policy below is what actually gates the
-- dashboard, and the tokens are encrypted regardless.
create policy calendar_connections_read on calendar_connections
  for select to authenticated
  using (auth_is_tenant_member(tenant_id));

-- Connect and disconnect run through the OAuth routes, not through direct
-- writes, so there is deliberately no insert/update/delete policy here.

-- ==========================================================================
-- supabase/migrations/0007_service_role_grants.sql
-- ==========================================================================

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

-- ==========================================================================
-- supabase/migrations/0008_revoke_anon.sql
-- ==========================================================================

-- Close the anon grant on calendar_connections.
--
-- 0005 ends with `revoke all on all tables in schema public from anon`, which
-- covers every table existing at that moment. 0006 then creates
-- calendar_connections — after the revoke has already run. On a project where
-- Supabase's "automatically expose new tables" was enabled, that table therefore
-- received an anon grant that nothing took back.
--
-- It was not exploitable: calendar_connections has RLS enabled and forced with
-- no policy for anon, so the grant passed but the policy check denied. That is
-- one layer of defence on the table holding every tenant's encrypted Google
-- refresh token, where the design calls for two.
--
-- The lasting fix is the default-privileges line: a revoke is a snapshot and
-- goes stale the moment another migration adds a table, which is exactly how
-- this arose.

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- authenticated keeps its grants. Every table it can reach is gated by the
-- membership policies in 0005, verified to isolate tenants from each other, so
-- those policies now act as live enforcement rather than dormant defence. The
-- app does not rely on this — the dashboard goes through its own /api routes —
-- but leaving it working means a future browser-side query is not blocked by a
-- missing grant that looks like a policy bug.

-- ==========================================================================
-- supabase/seed.sql
-- ==========================================================================

-- Development seed: one tenant, exercising every branch of the gate.
--
-- Run against a local or development project only. Creates the demo tenant
-- referenced by e2e/booking.spec.ts.

insert into tenants (id, slug, name, timezone, plan, status, embed_domains)
values (
  '00000000-0000-4000-8000-000000000001',
  'demo-coaching',
  'Demo Coaching',
  'Europe/Madrid',
  'trial',
  'active',
  array['https://example.com']
);

insert into tenant_settings (
  tenant_id, booking_notice_hours, booking_window_days,
  disqualification_message, disqualification_redirect_url, disqualification_redirect_label,
  notification_email
) values (
  '00000000-0000-4000-8000-000000000001',
  24,
  60,
  E'Thank you for taking the time to answer.\n\nFrom what you have shared, one-to-one coaching is not the right fit right now — and that is completely fine. The free guide below covers the same ground and costs nothing.',
  'https://example.com/guide',
  'Get the free guide',
  'owner@example.com'
);

-- Two event types, one per audience, to keep the independent-booleans
-- behaviour visible in development (brief 2.1).
insert into event_types (
  tenant_id, slug, name, description, duration_minutes,
  buffer_before_minutes, buffer_after_minutes, sort_order,
  available_to_prospects, available_to_existing_clients
) values
  ('00000000-0000-4000-8000-000000000001', 'discovery', 'Discovery call',
   'A free 30-minute conversation', 30, 0, 15, 1, true, false),
  ('00000000-0000-4000-8000-000000000001', 'coaching', 'Coaching session',
   'A 60-minute working session', 60, 15, 15, 2, false, true);

-- Monday to Friday, 09:00-17:00.
insert into availability_rules (tenant_id, weekday, start_time, end_time)
select '00000000-0000-4000-8000-000000000001', weekday, '09:00', '17:00'
from generate_series(1, 5) as weekday;

insert into qualification_questions (tenant_id, prompt, kind, options, required, sort_order)
values
  ('00000000-0000-4000-8000-000000000001',
   'What would you most like to change in the next six months?',
   'text', '[]'::jsonb, true, 1),

  ('00000000-0000-4000-8000-000000000001',
   'Have you worked with a coach before?',
   'yes_no',
   '[{"label": "Yes", "qualifies": true}, {"label": "No", "qualifies": true}]'::jsonb,
   true, 2),

  -- The one disqualifying option in the reference implementation (brief 2.2).
  ('00000000-0000-4000-8000-000000000001',
   'What are you able to invest in this right now?',
   'single_choice',
   '[{"label": "Over 2.000 €", "qualifies": true},
     {"label": "500 - 2.000 €", "qualifies": true},
     {"label": "I can''t afford this right now", "qualifies": false}]'::jsonb,
   true, 3);

commit;

-- =============================================================================
-- Verification — expect: 12 tables, 12 rls enabled, 19 policies, 0 anon
-- policies, 12 tables granted to service_role, 1 tenant, 2 event types,
-- 3 questions, 5 availability rules.
-- =============================================================================
select 'tables'            as check, count(*)::text as value from pg_tables where schemaname = 'public'
union all select 'rls enabled',      count(*)::text from pg_tables t join pg_class c on c.relname = t.tablename
                                     where t.schemaname = 'public' and c.relrowsecurity
union all select 'policies',         count(*)::text from pg_policies where schemaname = 'public'
union all select 'policies for anon', count(*)::text from pg_policies where schemaname = 'public' and 'anon' = any(roles)
union all select 'service_role tables', count(distinct table_name)::text from information_schema.role_table_grants
                                     where table_schema = 'public' and grantee = 'service_role'
union all select 'anon tables (must be 0)', count(distinct table_name)::text from information_schema.role_table_grants
                                     where table_schema = 'public' and grantee = 'anon'
union all select 'tenants',          count(*)::text from tenants
union all select 'event types',      count(*)::text from event_types
union all select 'questions',        count(*)::text from qualification_questions
union all select 'availability rules', count(*)::text from availability_rules;
