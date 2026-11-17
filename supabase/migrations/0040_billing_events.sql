-- Billing history for the owner console: one row each time a business's
-- billing state changes (trial, free, active, past_due, cancelled, deleted).
--
-- Account facts only, never anything inside a business: no names, no
-- services, no clients. tenant_id has no foreign key on purpose, so the
-- history of a deleted business survives its deletion (its row says
-- 'deleted'); tenant_created_at is copied in for the same reason, so a
-- sign-up month can still be counted after the business is gone.
--
-- Written by the server only (service role). No policies: nobody signed in
-- to a business can read it.

create table if not exists billing_events (
  id                bigint generated always as identity primary key,
  tenant_id         uuid not null,
  state             text not null,
  founding          boolean not null default false,
  tenant_created_at timestamptz not null,
  occurred_at       timestamptz not null default now(),
  -- The first row of each business that existed before this migration:
  -- its state on the day history started, not the day it changed.
  backfilled        boolean not null default false,

  constraint billing_events_state_known
    check (state in ('trial', 'free', 'active', 'past_due', 'cancelled', 'deleted'))
);

create index if not exists billing_events_tenant_time on billing_events (tenant_id, occurred_at desc);
create index if not exists billing_events_time on billing_events (occurred_at);

alter table billing_events enable row level security;
alter table billing_events force row level security;

-- Where every existing business stands today.
insert into billing_events (tenant_id, state, founding, tenant_created_at, occurred_at, backfilled)
select
  t.id,
  case
    when t.free_access then 'free'
    when t.subscription_status = 'past_due' then 'past_due'
    when t.plan = 'cancelled' then 'cancelled'
    when t.plan = 'trial' then 'trial'
    else 'active'
  end,
  coalesce(t.founding, false),
  t.created_at,
  now(),
  true
from tenants t
where t.status <> 'deleted'
  and not exists (select 1 from billing_events e where e.tenant_id = t.id);

insert into schema_migrations (version) values ('0040_billing_events')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
