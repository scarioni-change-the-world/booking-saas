-- Clients and package entitlements.
--
-- The feature this unlocks: a tenant sells a package of sessions (e.g. "10
-- coaching sessions"), and the client who bought it gets to book several of
-- them in one visit instead of coming back ten separate times. Everything
-- upstream of this migration already half-expected the idea — event_types
-- has carried `available_to_existing_clients` since milestone 1, and the
-- unlisted /t/[slug]/client door already served a different event-type list
-- to "existing clients" — but there was no real notion of *which* client,
-- or how many sessions they had left. This migration is that missing piece.
--
-- A client is not a login. There is no password, no session — the same
-- token-is-the-credential shape bookings already use for manage links,
-- because a customer coming back to redeem the rest of a package is exactly
-- that kind of low-friction, low-stakes access.

create table clients (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  name         text not null,
  email        text not null,
  -- The private link's credential — unguessable, unique, same shape as
  -- bookings.manage_token (see src/lib/tokens.ts, which this reuses as-is).
  access_token text not null unique,
  notes        text,
  created_at   timestamptz not null default now(),

  constraint clients_email_format check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

-- One client record per email per tenant — re-adding someone by the same
-- address tops up their existing record rather than silently forking it in
-- two, which would split their session history and their remaining balance
-- across two records that never talk to each other.
create unique index clients_tenant_email_idx on clients (tenant_id, lower(email));
create index clients_tenant_idx on clients (tenant_id);

-- A grant of N sessions for one specific session type. One active grant per
-- (client, event type) — topping up an existing package raises
-- total_sessions rather than creating a second, parallel grant, so a
-- client's balance for a given session type is always one number, not a sum
-- an admin has to add up by hand.
create table client_entitlements (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  client_id      uuid not null references clients(id) on delete cascade,
  -- restrict, not cascade: matches event_types' own on-delete-restrict from
  -- bookings (migration 0004) — a session type with an active package sold
  -- against it cannot simply vanish. "Delete" in the dashboard already means
  -- archive (active = false) for exactly this reason.
  event_type_id  uuid not null references event_types(id) on delete restrict,

  total_sessions integer not null,
  used_sessions  integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint entitlements_positive_total check (total_sessions > 0),
  constraint entitlements_used_in_range check (used_sessions >= 0 and used_sessions <= total_sessions)
);

create unique index entitlements_client_event_type_idx
  on client_entitlements (client_id, event_type_id);
create index entitlements_tenant_idx on client_entitlements (tenant_id);

-- Which booking (if any) drew down a package, so cancelling one correctly
-- hands the session back — see cancelBooking in src/lib/booking-service.ts.
-- Both nullable and both on delete set null: a booking's own history should
-- outlive the client record or the entitlement grant it was made under.
alter table bookings add column client_id uuid references clients(id) on delete set null;
alter table bookings add column entitlement_id uuid references client_entitlements(id) on delete set null;

-- ---------------------------------------------------------------------------
-- RLS. Same shape as every other tenant-scoped table: members read, admins
-- write — see migration 0005 for the helpers this reuses.
-- ---------------------------------------------------------------------------
alter table clients             enable row level security;
alter table client_entitlements enable row level security;
alter table clients             force row level security;
alter table client_entitlements force row level security;

create policy clients_read on clients
  for select to authenticated using (auth_is_tenant_member(tenant_id));
create policy clients_write on clients
  for all to authenticated
  using (auth_is_tenant_admin(tenant_id)) with check (auth_is_tenant_admin(tenant_id));

create policy entitlements_read on client_entitlements
  for select to authenticated using (auth_is_tenant_member(tenant_id));
create policy entitlements_write on client_entitlements
  for all to authenticated
  using (auth_is_tenant_admin(tenant_id)) with check (auth_is_tenant_admin(tenant_id));
