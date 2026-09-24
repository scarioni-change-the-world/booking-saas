-- A record of every email sent, kept as shape only.
--
-- bookings.email_status holds the latest attempt for a booking's current
-- state and nothing else — a confirmation that failed and was then
-- overwritten by a successful reminder leaves no trace, and the client
-- invite and the owner notification were never recorded anywhere at all.
-- So a business could edit its emails but could not answer the plain
-- question "did they arrive?".
--
-- One row per send: which kind, what happened, and which booking or client
-- it was about. Never the recipient's address, the subject or the body —
-- the booking or client id is enough for the business to find the person,
-- and a copy of every email ever sent is a store of personal data nobody
-- asked for. The error is kept because "the address was rejected" is the
-- one thing a business can act on; it is the mail server's words, not the
-- client's.
--
-- text + a check constraint rather than the email_template_kind values
-- directly, for the reason migration 0015 gives: a new kind is then one
-- constraint swap, not an ALTER TYPE.

create table email_sends (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  kind        text not null,
  status      text not null,
  booking_id  uuid references bookings(id) on delete set null,
  client_id   uuid references clients(id) on delete set null,
  error       text,
  created_at  timestamptz not null default now(),

  constraint email_sends_kind_known check (kind in (
    'booking_confirmed',
    'booking_rescheduled',
    'booking_cancelled',
    'owner_notification',
    'client_invite',
    'booking_reminder',
    'booking_pack_confirmed'
  )),
  constraint email_sends_status_known check (status in ('sent', 'failed', 'not_configured')),
  constraint email_sends_error_short check (error is null or length(error) <= 500)
);

create index email_sends_tenant_created_idx on email_sends (tenant_id, created_at desc);

-- Members read, as with every other table a business looks at. Writes come
-- from the server as each email goes out — under service_role for the
-- public booking page and the reminder run, under the signed-in admin for a
-- cancellation or a resent link — so members may insert their own tenant's
-- rows and nobody may change or remove one.
alter table email_sends enable row level security;
alter table email_sends force row level security;

create policy email_sends_read on email_sends
  for select to authenticated using (auth_is_tenant_member(tenant_id));
create policy email_sends_insert on email_sends
  for insert to authenticated with check (auth_is_tenant_member(tenant_id));

insert into schema_migrations (version) values ('0027_email_log')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
