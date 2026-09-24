-- Deleting a service for good (src/lib/service-deletion.ts).
--
-- A service is referenced by every booking and every programme balance
-- ever made against it (both `on delete restrict`), and those are the
-- business's history and their clients': who came, when, for what. So a
-- deleted service is not a removed row. It is marked here, and from then
-- on it is gone from everything the business configures (their list of
-- services, questions, the five-service allowance) and can never be
-- resumed, while its past appointments keep the name they were booked
-- under. Nobody loses their history, or their standing as a client.
--
-- Only a paused service with nothing still coming up and nothing still
-- owed can be deleted; the route checks that before it writes here.
-- deleted_by is the address of whoever deleted it, the same one the
-- confirmation email goes to.

alter table event_types add column if not exists deleted_at timestamptz;
alter table event_types add column if not exists deleted_by text;

insert into schema_migrations (version) values ('0029_service_deletion')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
