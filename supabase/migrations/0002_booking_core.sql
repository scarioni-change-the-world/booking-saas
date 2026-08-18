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
