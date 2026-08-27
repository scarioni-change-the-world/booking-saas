-- Development seed: one tenant, exercising every branch of the gate.
--
-- Run against a local or development project only. Creates the demo tenant
-- referenced by e2e/booking.spec.ts.

insert into tenants (id, slug, name, timezone, plan, status, embed_domains)
values (
  '00000000-0000-4000-8000-000000000001',
  'demo-coaching',
  'Demo Coaching',
  'Europe/Madrid',
  'trial',
  'active',
  array['https://example.com']
);

-- migration 0009's tenants_create_settings trigger already created the
-- default row the moment the insert above ran; this fills in the demo's own
-- values rather than inserting a second row.
update tenant_settings set
  booking_notice_hours = 24,
  booking_window_days = 60,
  notification_email = 'owner@example.com'
where tenant_id = '00000000-0000-4000-8000-000000000001';

-- migration 0011's tenants_create_outcome_paths trigger already created both
-- path rows the moment the tenant insert ran; this fills in the demo's
-- "other" path the same way the update above fills in its settings.
update outcome_paths set
  message = E'Thank you for taking the time to answer.\n\nFrom what you have shared, one-to-one coaching is not the right fit right now — and that is completely fine. The free guide below covers the same ground and costs nothing.',
  redirect_url = 'https://example.com/guide',
  redirect_label = 'Get the free guide'
where tenant_id = '00000000-0000-4000-8000-000000000001' and type = 'other';

-- Two event types, one per audience, to keep the independent-booleans
-- behaviour visible in development (brief 2.1).
insert into event_types (
  tenant_id, slug, name, description, duration_minutes,
  buffer_before_minutes, buffer_after_minutes, sort_order,
  available_to_prospects, available_to_existing_clients
) values
  ('00000000-0000-4000-8000-000000000001', 'discovery', 'Discovery call',
   'A free 30-minute conversation', 30, 0, 15, 1, true, false),
  ('00000000-0000-4000-8000-000000000001', 'coaching', 'Coaching session',
   'A 60-minute working session', 60, 15, 15, 2, false, true);

-- Monday to Friday, 09:00-17:00.
insert into availability_rules (tenant_id, weekday, start_time, end_time)
select '00000000-0000-4000-8000-000000000001', weekday, '09:00', '17:00'
from generate_series(1, 5) as weekday;

insert into qualification_questions (tenant_id, prompt, kind, options, required, sort_order)
values
  ('00000000-0000-4000-8000-000000000001',
   'What would you most like to change in the next six months?',
   'text', '[]'::jsonb, true, 1),

  ('00000000-0000-4000-8000-000000000001',
   'Have you worked with a coach before?',
   'yes_no',
   '[{"label": "Yes", "outcomePathType": "meeting"}, {"label": "No", "outcomePathType": "meeting"}]'::jsonb,
   true, 2),

  -- The one option sent down the other path in the reference implementation
  -- (brief 2.2).
  ('00000000-0000-4000-8000-000000000001',
   'What are you able to invest in this right now?',
   'single_choice',
   '[{"label": "Over 2.000 €", "outcomePathType": "meeting"},
     {"label": "500 - 2.000 €", "outcomePathType": "meeting"},
     {"label": "I can''t afford this right now", "outcomePathType": "other"}]'::jsonb,
   true, 3);
