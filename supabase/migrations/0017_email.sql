-- Transactional email (brief 2.7, 7.5) — the gap the Google Calendar
-- integration was already built anticipating: every event.createEvent /
-- updateEvent / deleteEvent call passes sendUpdates=none specifically so
-- Google never emails an invite, because "this app owns all client
-- communication." Until now nothing filled that role, so nobody got any
-- email for anything — a booking, a reschedule, a cancellation.
--
-- Two pieces:
--
--   bookings.email_status / email_error — same shape and same reasoning as
--   sync_status/sync_error (migration 0004): a side effect that must never
--   block the booking itself (see createBooking's comment on brief 6.9),
--   with its outcome recorded rather than silently swallowed. Reused across
--   every stage a booking goes through — created, rescheduled, cancelled —
--   the same way sync_status already is, so this always reflects the most
--   recent transactional email attempt for that booking's current state.
--
--   email_templates — the tenant's own wording for each kind of email,
--   customisable the same way outcome_paths.message already is (migration
--   0011): one row per (tenant_id, kind), auto-seeded with sensible
--   defaults on tenant creation, only update is granted since nothing
--   creates or deletes a row after that. Subject and body are plain text
--   with {{token}} placeholders — not full HTML — for the same reason
--   outcome_paths.message is plain text: it keeps tenant-authored content
--   impossible to use to break the email's layout, and there is no
--   html/text-version mismatch to keep in sync.

create type email_status as enum ('pending', 'sent', 'failed', 'not_configured');

alter table bookings add column email_status email_status not null default 'pending';
alter table bookings add column email_error text;

create type email_template_kind as enum (
  'booking_confirmed',
  'booking_rescheduled',
  'booking_cancelled',
  'owner_notification'
);

create table email_templates (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  kind       email_template_kind not null,
  subject    text not null,
  body       text not null,
  updated_at timestamptz not null default now(),

  constraint email_templates_one_per_kind unique (tenant_id, kind)
);

create index email_templates_tenant_idx on email_templates (tenant_id);

-- ---------------------------------------------------------------------------
-- Seed all four kinds for every tenant that already exists, and for every
-- tenant from now on — same create_default_X + tenants_create_X trigger
-- pattern tenant_settings (migration 0009) and outcome_paths (migration
-- 0011) already use. Defaults are deliberately warm and short: they are a
-- real tenant's starting point, not filler copy nobody is meant to read.
-- ---------------------------------------------------------------------------
insert into email_templates (tenant_id, kind, subject, body)
select id, 'booking_confirmed'::email_template_kind,
       'You''re booked with {{tenantName}}',
       E'Hi {{clientName}},\n\nYou\'re all set for {{serviceName}} on {{dateTime}}. We\'ll see you then.\n\n{{tenantName}}'
from tenants
union all
select id, 'booking_rescheduled'::email_template_kind,
       'Your {{serviceName}} was moved',
       E'Hi {{clientName}},\n\nYour {{serviceName}} has been moved to {{dateTime}}.\n\n{{tenantName}}'
from tenants
union all
select id, 'booking_cancelled'::email_template_kind,
       'Your {{serviceName}} was cancelled',
       E'Hi {{clientName}},\n\nYour {{serviceName}} on {{dateTime}} has been cancelled. If this wasn\'t expected, just reply to this email.\n\n{{tenantName}}'
from tenants
union all
select id, 'owner_notification'::email_template_kind,
       'New booking: {{clientName}}',
       E'{{clientName}} ({{clientEmail}}) just booked {{serviceName}} for {{dateTime}}.'
from tenants;

create function create_default_email_templates() returns trigger
language plpgsql as $$
begin
  insert into email_templates (tenant_id, kind, subject, body) values
    (new.id, 'booking_confirmed',
     'You''re booked with {{tenantName}}',
     E'Hi {{clientName}},\n\nYou\'re all set for {{serviceName}} on {{dateTime}}. We\'ll see you then.\n\n{{tenantName}}'),
    (new.id, 'booking_rescheduled',
     'Your {{serviceName}} was moved',
     E'Hi {{clientName}},\n\nYour {{serviceName}} has been moved to {{dateTime}}.\n\n{{tenantName}}'),
    (new.id, 'booking_cancelled',
     'Your {{serviceName}} was cancelled',
     E'Hi {{clientName}},\n\nYour {{serviceName}} on {{dateTime}} has been cancelled. If this wasn\'t expected, just reply to this email.\n\n{{tenantName}}'),
    (new.id, 'owner_notification',
     'New booking: {{clientName}}',
     E'{{clientName}} ({{clientEmail}}) just booked {{serviceName}} for {{dateTime}}.');
  return new;
end;
$$;

create trigger tenants_create_email_templates
  after insert on tenants
  for each row execute function create_default_email_templates();

-- ---------------------------------------------------------------------------
-- RLS — same shape as outcome_paths (migration 0011): members read, admins
-- update. No insert/delete grant — the trigger is the only writer of new rows.
-- ---------------------------------------------------------------------------
alter table email_templates enable row level security;
alter table email_templates force row level security;

create policy email_templates_read on email_templates
  for select to authenticated using (auth_is_tenant_member(tenant_id));
create policy email_templates_write on email_templates
  for update to authenticated
  using (auth_is_tenant_admin(tenant_id)) with check (auth_is_tenant_admin(tenant_id));
