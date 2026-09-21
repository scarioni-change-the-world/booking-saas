-- A pack of appointments booked together.
--
-- Migration 0013 let a service *declare* itself a pack of N. Nothing could
-- actually book one: a client saw "part of an 8-session package" and then
-- booked a single appointment like any other, which is the gap between what
-- the marketing site shows — ten dates chosen in one flow — and what the
-- product did.
--
-- Deliberately two columns on bookings rather than a booking_packs table.
-- The alternative was tried on paper first and is worse here:
--
--   - A parent row means two statements, and two statements mean a window
--     where the pack exists and its appointments do not. Postgres makes a
--     single multi-row INSERT atomic against the exclusion constraint below,
--     so with the pack recorded on the rows themselves, ten appointments
--     either all exist or none do, with no cleanup path to get wrong.
--   - There is nothing a parent row would hold that the children do not. The
--     client, the service and the tenant are already on every booking.
--
-- pack_size is copied onto each row rather than read from event_types at
-- display time, and that denormalisation is the point: a business that later
-- edits a service from 8 sessions to 10 must not retroactively change what a
-- client already bought. The rows are written once, in one statement, and
-- never updated, so the usual objection — that copies drift — has no path to
-- happen here.
--
-- Cancelling one appointment of a pack leaves the rest alone. That is the
-- "stay flexible" half of the promise, and it falls out of these being
-- ordinary bookings: each keeps its own manage token, its own reminder and
-- its own calendar event.

alter table bookings add column pack_id   uuid;
alter table bookings add column pack_size integer;

-- Both or neither — the same paired-check shape migration 0013 used for
-- booking_mode/pack_size, for the same reason: a half-set pair is a state
-- no reader can interpret.
alter table bookings
  add constraint bookings_pack_paired
  check ((pack_id is null) = (pack_size is null));

-- Matches the ceiling the service declaration allows (migration 0014) and
-- the "up to ten" the product offers.
alter table bookings
  add constraint bookings_pack_size_sane
  check (pack_size is null or pack_size between 2 and 10);

-- Every read of a pack is "the other appointments in this one", so the index
-- is on pack_id alone, ordered use coming from starts_at in the query.
create index bookings_pack_idx on bookings (pack_id) where pack_id is not null;

-- The email a client gets for a whole programme.
--
-- Its own kind rather than reusing booking_confirmed, because the two say
-- genuinely different things: one confirms an appointment, the other
-- confirms ten and lists them. Folding them together would mean a business
-- editing their confirmation wording could never say anything about a
-- programme without it leaking onto every single booking.
--
-- Same shape as migrations 0020 and 0023 used for their new kinds, and for
-- the same reason: a tenant whose template row is missing gets nothing sent,
-- silently, and that is not a state worth allowing to exist.

alter table email_templates drop constraint email_templates_kind_known;

alter table email_templates
  add constraint email_templates_kind_known
  check (kind in (
    'booking_confirmed',
    'booking_rescheduled',
    'booking_cancelled',
    'owner_notification',
    'client_invite',
    'booking_reminder',
    'booking_pack_confirmed'
  ));

insert into email_templates (tenant_id, kind, subject, body)
select id, 'booking_pack_confirmed',
       'Your {{serviceName}} is booked',
       E'Hi {{clientName}},\n\nYour {{serviceName}} is booked — all {{packSize}} appointments, starting {{dateTime}}.\n\nEvery appointment is listed below, and each one can be changed or cancelled on its own if something comes up.\n\n{{tenantName}}'
from tenants
on conflict (tenant_id, kind) do nothing;

create or replace function create_default_email_templates() returns trigger
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
     E'{{clientName}} ({{clientEmail}}) just booked {{serviceName}} for {{dateTime}}.'),
    (new.id, 'client_invite',
     'Your booking link for {{tenantName}}',
     E'Hi {{clientName}},\n\nHere is your own link for booking with {{tenantName}}. It is yours alone — keep it somewhere you can find it, and use it whenever you would like to book. You will not need to answer the questions again.\n\n{{tenantName}}'),
    (new.id, 'booking_reminder',
     'Tomorrow: {{serviceName}} with {{tenantName}}',
     E'Hi {{clientName}},\n\nA quick reminder about your {{serviceName}} on {{dateTime}}.\n\nIf you need to change or cancel it, the link below still works.\n\n{{tenantName}}'),
    (new.id, 'booking_pack_confirmed',
     'Your {{serviceName}} is booked',
     E'Hi {{clientName}},\n\nYour {{serviceName}} is booked — all {{packSize}} appointments, starting {{dateTime}}.\n\nEvery appointment is listed below, and each one can be changed or cancelled on its own if something comes up.\n\n{{tenantName}}');
  return new;
end;
$$;

insert into schema_migrations (version) values ('0025_booking_packs')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
