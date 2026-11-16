-- The last box on the booking form, in the business's own words.
--
-- It used to read "Anything <business> should know?", optional, for every
-- business. A business can now word it itself ("Tell me briefly what
-- brings you here") and choose whether it must be answered. Null keeps the
-- default wording; false keeps it optional, as before.

alter table tenant_settings add column if not exists closing_question text
  check (closing_question is null or char_length(closing_question) between 1 and 200);
alter table tenant_settings add column if not exists closing_required boolean not null default false;

insert into schema_migrations (version) values ('0039_closing_question')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
