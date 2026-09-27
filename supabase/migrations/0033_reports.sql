-- Reports: what a business needs to know to improve its services, and the
-- few facts this schema did not keep yet.
--
--   1. Visits to the booking page — counted, not tracked. A row is a time and
--      where the visitor came from (a label like "instagram" or the host of
--      the site that linked, never an address, an IP or a cookie). Without
--      it the journey starts at "began the questions", halfway down.
--   2. Where each booking came from (the same label), so a business can see
--      which channel brings people who actually book.
--   3. Whether somebody came (attendance), who cancelled, and how many times
--      a booking was moved.
--   4. A one-question rating after a session, asked by email in the
--      business's own words (a new template, editable in Messages).
--   5. A written summary of a period, drafted by the AI assistant on request
--      and kept, so reopening the same period does not pay for it twice.

-- ── 1. Visits ───────────────────────────────────────────────────────────────
create table page_visits (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  visited_at  timestamptz not null default now(),
  source      text not null default 'direct',
  surface     text not null default 'page',
  constraint page_visits_surface_known check (surface in ('page', 'embedded', 'client_link')),
  constraint page_visits_source_short check (length(source) between 1 and 60)
);
create index page_visits_tenant_time_idx on page_visits (tenant_id, visited_at);

alter table page_visits enable row level security;
alter table page_visits force row level security;
create policy page_visits_read on page_visits
  for select to authenticated using (auth_is_tenant_member(tenant_id));

-- ── 2 and 3. On each booking ─────────────────────────────────────────────────
alter table bookings add column source text;
alter table bookings add column attendance text;
alter table bookings add column cancelled_by text;
alter table bookings add column reschedule_count integer not null default 0;
alter table bookings add column rating_requested_at timestamptz;
alter table bookings add constraint bookings_source_short check (source is null or length(source) <= 60);
alter table bookings add constraint bookings_attendance_known check (attendance is null or attendance in ('attended', 'no_show'));
alter table bookings add constraint bookings_cancelled_by_known check (cancelled_by is null or cancelled_by in ('client', 'business'));

-- ── 4. Ratings ───────────────────────────────────────────────────────────────
create table session_ratings (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  booking_id  uuid not null unique references bookings(id) on delete cascade,
  rating      smallint not null,
  comment     text,
  created_at  timestamptz not null default now(),
  constraint session_ratings_range check (rating between 1 and 5),
  constraint session_ratings_comment_short check (comment is null or length(comment) <= 2000)
);
create index session_ratings_tenant_created_idx on session_ratings (tenant_id, created_at);

alter table session_ratings enable row level security;
alter table session_ratings force row level security;
create policy session_ratings_read on session_ratings
  for select to authenticated using (auth_is_tenant_member(tenant_id));

-- Asked by default: a business that would rather not can turn it off in Messages.
alter table tenant_settings add column rating_emails boolean not null default true;

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
    'booking_pack_confirmed',
    'session_rating'
  ));

alter table email_sends drop constraint email_sends_kind_known;
alter table email_sends
  add constraint email_sends_kind_known
  check (kind in (
    'booking_confirmed',
    'booking_rescheduled',
    'booking_cancelled',
    'owner_notification',
    'client_invite',
    'booking_reminder',
    'booking_pack_confirmed',
    'session_rating'
  ));

insert into email_templates (tenant_id, kind, subject, body)
select id, 'session_rating',
       'How was your {{serviceName}}?',
       E'Hi {{clientName}},\n\nThank you for your {{serviceName}} on {{dateTime}}. How was it?\n\nOne tap below is all it takes — it helps {{tenantName}} make every session better.\n\n{{tenantName}}'
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
     E'Hi {{clientName}},\n\nYour {{serviceName}} is booked — all {{packSize}} appointments, starting {{dateTime}}.\n\nEvery appointment is listed below, and each one can be changed or cancelled on its own if something comes up.\n\n{{tenantName}}'),
    (new.id, 'session_rating',
     'How was your {{serviceName}}?',
     E'Hi {{clientName}},\n\nThank you for your {{serviceName}} on {{dateTime}}. How was it?\n\nOne tap below is all it takes — it helps {{tenantName}} make every session better.\n\n{{tenantName}}');
  return new;
end;
$$;

-- ── 5. Written summaries ─────────────────────────────────────────────────────
alter table ai_usage_events drop constraint ai_usage_events_kind_known;
alter table ai_usage_events
  add constraint ai_usage_events_kind_known check (kind in ('intake_draft', 'report_summary'));

create table report_summaries (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  period_from  date not null,
  period_to    date not null,
  summary      jsonb not null,
  created_at   timestamptz not null default now(),
  constraint report_summaries_period unique (tenant_id, period_from, period_to)
);

alter table report_summaries enable row level security;
alter table report_summaries force row level security;
create policy report_summaries_read on report_summaries
  for select to authenticated using (auth_is_tenant_member(tenant_id));

insert into schema_migrations (version) values ('0033_reports')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
