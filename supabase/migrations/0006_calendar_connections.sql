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
