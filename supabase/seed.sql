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

-- A sample month of questionnaire activity (migration 0012), so the
-- Screening page's "How it's performing" card and Overview's completion
-- rate tile have something to show rather than "nobody has started yet" on
-- a brand new project. Two people started and never finished (answers still
-- '[]', completed_at still null) — real drop-off, the exact thing that card
-- exists to surface. answers is left empty even on the completed ones: it's
-- a denormalised snapshot with no bearing on these counts, and nothing here
-- links back to a real booking that would need it filled in.
insert into qualification_responses (tenant_id, email, answers, outcome_path_type, started_at, completed_at)
values
  ('00000000-0000-4000-8000-000000000001', 'left-early@example.com', '[]'::jsonb, null, now() - interval '2 days', null),
  ('00000000-0000-4000-8000-000000000001', 'maybe-later@example.com', '[]'::jsonb, null, now() - interval '9 days', null),
  ('00000000-0000-4000-8000-000000000001', 'ready-now@example.com', '[]'::jsonb, 'meeting', now() - interval '3 days', now() - interval '3 days' + interval '4 minutes'),
  ('00000000-0000-4000-8000-000000000001', 'good-fit@example.com', '[]'::jsonb, 'meeting', now() - interval '11 days', now() - interval '11 days' + interval '3 minutes'),
  ('00000000-0000-4000-8000-000000000001', 'not-yet@example.com', '[]'::jsonb, 'other', now() - interval '6 days', now() - interval '6 days' + interval '5 minutes'),
  ('00000000-0000-4000-8000-000000000001', 'budget-tight@example.com', '[]'::jsonb, 'other', now() - interval '18 days', now() - interval '18 days' + interval '4 minutes');
