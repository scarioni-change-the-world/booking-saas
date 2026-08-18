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

insert into tenant_settings (
  tenant_id, booking_notice_hours, booking_window_days,
  disqualification_message, disqualification_redirect_url, disqualification_redirect_label,
  notification_email
) values (
  '00000000-0000-4000-8000-000000000001',
  24,
  60,
  E'Thank you for taking the time to answer.\n\nFrom what you have shared, one-to-one coaching is not the right fit right now — and that is completely fine. The free guide below covers the same ground and costs nothing.',
  'https://example.com/guide',
  'Get the free guide',
  'owner@example.com'
);

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
   '[{"label": "Yes", "qualifies": true}, {"label": "No", "qualifies": true}]'::jsonb,
   true, 2),

  -- The one disqualifying option in the reference implementation (brief 2.2).
  ('00000000-0000-4000-8000-000000000001',
   'What are you able to invest in this right now?',
   'single_choice',
   '[{"label": "Over 2.000 €", "qualifies": true},
     {"label": "500 - 2.000 €", "qualifies": true},
     {"label": "I can''t afford this right now", "qualifies": false}]'::jsonb,
   true, 3);
