-- The reminder nobody was sending.
--
-- bookings.reminder_sent_at and its partial index have existed since
-- migration 0004, waiting for a feature that was never written: no template
-- kind, no sender, no schedule. CRON_SECRET has sat in .env.example under
-- "not yet read by any code" the whole time.
--
-- Meanwhile the marketing site says, in three places, that clients receive
-- an automatic reminder before their appointment. A business that believes
-- it stops chasing no-shows and finds out the expensive way. This closes
-- that gap in the direction that keeps the promise rather than withdrawing
-- it.
--
-- One new kind, seeded for every tenant that already exists and added to the
-- trigger for every tenant from here — the same shape migration 0020 used
-- for client_invite, for the same reason: a tenant whose template row is
-- missing gets nothing sent, silently, and that is not a state worth
-- allowing to exist.

alter table email_templates drop constraint email_templates_kind_known;

alter table email_templates
  add constraint email_templates_kind_known
  check (kind in (
    'booking_confirmed',
    'booking_rescheduled',
    'booking_cancelled',
    'owner_notification',
    'client_invite',
    'booking_reminder'
  ));

-- Every tenant that already exists. on conflict because a tenant created
-- between this statement and the trigger below would otherwise collide.
insert into email_templates (tenant_id, kind, subject, body)
select id, 'booking_reminder',
       'Tomorrow: {{serviceName}} with {{tenantName}}',
       E'Hi {{clientName}},\n\nA quick reminder about your {{serviceName}} on {{dateTime}}.\n\nIf you need to change or cancel it, the link below still works.\n\n{{tenantName}}'
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
     E'Hi {{clientName}},\n\nA quick reminder about your {{serviceName}} on {{dateTime}}.\n\nIf you need to change or cancel it, the link below still works.\n\n{{tenantName}}');
  return new;
end;
$$;

insert into schema_migrations (version) values ('0023_booking_reminder')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
