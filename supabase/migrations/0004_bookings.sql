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
