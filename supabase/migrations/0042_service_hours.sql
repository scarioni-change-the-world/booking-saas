-- When one service can be booked, inside the business's opening hours.
--
-- The opening hours stay the business's own (availability_rules). A service
-- may narrow them to some days or some hours, never widen them: slots are
-- the overlap of the two. Null means whenever the business is open, which
-- is what every existing service keeps.
--
-- An array of {"weekday": 1..7, "startTime": "HH:mm", "endTime": "HH:mm"},
-- checked in the app (src/lib/service-hours.ts).

alter table event_types add column if not exists bookable_hours jsonb
  check (bookable_hours is null or jsonb_typeof(bookable_hours) = 'array');

insert into schema_migrations (version) values ('0042_service_hours')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
