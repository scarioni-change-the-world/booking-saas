-- "Ask khloe", the assistant in the admin, counts each question against
-- its own monthly allowance (src/lib/ai/limits.ts: assistant, 100), recorded
-- in ai_usage_events like the other AI features.

alter table ai_usage_events drop constraint ai_usage_events_kind_known;
alter table ai_usage_events
  add constraint ai_usage_events_kind_known
  check (kind in ('intake_draft', 'report_summary', 'site_draft', 'assistant'));

insert into schema_migrations (version) values ('0038_assistant_usage')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
