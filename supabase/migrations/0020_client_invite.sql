-- A fifth email template kind: a client's own private booking link, sent to
-- them — and, to get there, email_templates.kind stops being an enum.
--
-- The enum had to go, and it is worth recording why rather than leaving the
-- next person to rediscover it. `alter type ... add value` cannot be used in
-- the same transaction that adds it: Postgres refuses with "New enum values
-- must be committed before they can be used". Verified on PG16, and it holds
-- even when the type itself was created in that same transaction — so it is
-- not something bootstrap/full_setup.sql's single wrapping transaction
-- escapes either. Every migration here runs in one transaction and
-- full_setup.sql runs all of them in one, so adding a kind to an enum means
-- either splitting it across two transactions or giving up the all-or-
-- nothing property the bootstrap file promises. Neither is worth it for a
-- column whose whole job is "one of these strings".
--
-- text + a check constraint validates exactly as well and grows in one
-- statement. This schema already has that shape, for exactly this reason:
-- see ai_usage_events.kind (migration 0015), whose own comment says a future
-- kind "adds its own rather than reusing this one". And this column will
-- grow again — reminder emails are on the roadmap.

alter table email_templates alter column kind type text using kind::text;

-- Nothing references it once the column above is text. Left behind, it would
-- read like the source of truth for which kinds exist while the check
-- constraint quietly disagreed.
drop type email_template_kind;

alter table email_templates
  add constraint email_templates_kind_known
  check (kind in (
    'booking_confirmed',
    'booking_rescheduled',
    'booking_cancelled',
    'owner_notification',
    'client_invite'
  ));

-- The new kind.
--
-- This is the email that makes an existing client's private link (migration
-- 0010, /t/[slug]/client/[token]) actually reach them. Until now the only
-- way a client ever got that link was an admin copying it out of the
-- dashboard and pasting it into their own mail client by hand, which is
-- both a step that gets forgotten and one that leaves no trace of whether
-- it happened.
--
-- The link itself is NOT a {{token}} in the body. It is appended by
-- src/lib/email/templates.ts after the tenant's own words, the same way a
-- booking's manage link is, and for a stronger version of the same reason:
-- a confirmation email missing its manage link is still a confirmation,
-- but an invite missing its link is nothing at all.
insert into email_templates (tenant_id, kind, subject, body)
select
  id,
  'client_invite',
  'Your booking link for {{tenantName}}',
  E'Hi {{clientName}},\n\nHere is your own link for booking with {{tenantName}}. It is yours alone — keep it somewhere you can find it, and use it whenever you would like to book. You will not need to answer the questions again.\n\n{{tenantName}}'
from tenants;

-- Same trigger as migration 0017, with the fifth kind added, so a tenant
-- created from here on gets all five rather than four and a gap.
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
     E'Hi {{clientName}},\n\nHere is your own link for booking with {{tenantName}}. It is yours alone — keep it somewhere you can find it, and use it whenever you would like to book. You will not need to answer the questions again.\n\n{{tenantName}}');
  return new;
end;
$$;
