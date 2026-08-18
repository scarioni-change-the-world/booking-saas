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
