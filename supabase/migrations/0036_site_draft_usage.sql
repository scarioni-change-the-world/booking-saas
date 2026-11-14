-- "Set up from your website" in the setup wizard reads a business's site
-- with the AI assistant, against its own small monthly allowance
-- (src/lib/ai/limits.ts: site_draft). Each reading is recorded in
-- ai_usage_events like the other AI features, so the kind check has to
-- know the new kind.
--
-- The sign-up funnel on the console needs nothing new: it is worked out
-- from tenants, event_types, bookings and embed_sightings as they are.

alter table ai_usage_events drop constraint ai_usage_events_kind_known;
alter table ai_usage_events
  add constraint ai_usage_events_kind_known check (kind in ('intake_draft', 'report_summary', 'site_draft'));

insert into schema_migrations (version) values ('0036_site_draft_usage')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
