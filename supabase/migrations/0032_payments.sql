-- Payments, both ways, through Stripe.
--
-- 1. A business pays intro: one subscription per business (Stripe Billing).
--    Stripe is the source of truth; these columns are what its webhooks last
--    said, so a page can show the state without asking Stripe on every load.
--
-- 2. A client pays the business: each business connects its own Stripe
--    account (Connect, Standard) and is the seller. intro takes no cut and
--    never holds the money. A service decides whether clients pay online:
--    not at all, in full, or a deposit.
--
-- A booking that needs paying is not written until Stripe says it is paid.
-- Until then the chosen times are held in `payments` (status 'open', with an
-- expiry), and shown as busy to everybody else. An expired hold frees its
-- times by itself: every reader ignores an 'open' row past its expiry, so no
-- scheduled job is needed.

-- ── A business paying intro ────────────────────────────────────────────────
alter table tenants add column stripe_customer_id               text;
alter table tenants add column stripe_subscription_id           text;
alter table tenants add column subscription_status              text;
alter table tenants add column subscription_current_period_end  timestamptz;

-- ── A business being paid ─────────────────────────────────────────────────
alter table tenants add column stripe_account_id      text;
alter table tenants add column stripe_charges_enabled boolean not null default false;

create unique index tenants_stripe_customer_idx on tenants (stripe_customer_id) where stripe_customer_id is not null;
create unique index tenants_stripe_account_idx  on tenants (stripe_account_id)  where stripe_account_id  is not null;

-- ── How a service is paid ─────────────────────────────────────────────────
alter table event_types add column payment_mode text not null default 'none';
alter table event_types add column deposit_minor integer;
alter table event_types add constraint event_types_payment_mode_known
  check (payment_mode in ('none', 'full', 'deposit'));
alter table event_types add constraint event_types_deposit_positive
  check (deposit_minor is null or deposit_minor > 0);

-- ── A client's payment: a hold while they pay, then the record of it ──────
create table payments (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references tenants(id) on delete cascade,
  event_type_id               uuid references event_types(id) on delete set null,
  -- 'single' or 'pack'; which booking path completes it.
  kind                        text not null,
  -- open: held, waiting for Stripe. paid: bookings written. expired: never
  -- paid. failed: paid, but the time had gone, so it was refunded.
  -- refunded: paid, then refunded on cancellation.
  status                      text not null default 'open',
  amount_minor                integer not null,
  currency                    text not null,
  -- 'full' or 'deposit', as the service was set when the client paid.
  payment_mode                text not null,
  -- What to book once paid: name, email, notes, slots, response and client.
  booking_input               jsonb not null,
  -- The times held, for the availability of everybody else.
  slot_ranges                 jsonb not null default '[]'::jsonb,
  expires_at                  timestamptz,
  stripe_account_id           text not null,
  stripe_checkout_session_id  text,
  stripe_payment_intent_id    text,
  refunded_minor              integer not null default 0,
  paid_at                     timestamptz,
  created_at                  timestamptz not null default now(),
  constraint payments_kind_known   check (kind in ('single', 'pack')),
  constraint payments_status_known check (status in ('open', 'paid', 'expired', 'failed', 'refunded')),
  constraint payments_mode_known   check (payment_mode in ('full', 'deposit')),
  constraint payments_amount_positive check (amount_minor > 0)
);

create index payments_tenant_open_idx on payments (tenant_id, expires_at) where status = 'open';
create unique index payments_checkout_session_idx on payments (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

alter table payments enable row level security;
-- Read by the business's own team; written only by the server.
create policy payments_read on payments
  for select to authenticated using (auth_is_tenant_member(tenant_id));

alter table bookings add column payment_id uuid references payments(id) on delete set null;
create index bookings_payment_idx on bookings (payment_id) where payment_id is not null;

-- ── Stripe webhook events already handled ─────────────────────────────────
-- Stripe may send the same event more than once. Recording each id makes
-- handling it a second time a no-op.
create table stripe_events (
  id          text primary key,
  type        text not null,
  received_at timestamptz not null default now()
);
alter table stripe_events enable row level security;

insert into schema_migrations (version) values ('0032_payments')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
