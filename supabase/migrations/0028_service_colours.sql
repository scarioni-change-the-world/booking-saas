-- A colour for every service, so several can be told apart at a glance.
--
-- event_types.color has existed since migration 0002 with a default of
-- '#111111' and nothing ever set or read it, so every service is the same
-- near-black. The admin screens now draw each service in its own colour
-- (src/lib/service-identity.ts), and a new service is given the first one
-- its business is not already using. This gives the services that already
-- exist a colour each, in the order they are listed, from the same six.
--
-- Only rows still on the old default are touched. The public booking page
-- does not use this column, so nothing a client sees changes.

with ordered as (
  select id,
         row_number() over (partition by tenant_id order by sort_order, created_at) - 1 as position
  from event_types
  where color = '#111111'
)
update event_types e
set color = (array['#2c6a63', '#8a5a12', '#7a4e7e', '#2f6fae', '#a4472f', '#5a6b1f'])[(o.position % 6) + 1]
from ordered o
where e.id = o.id;

insert into schema_migrations (version) values ('0028_service_colours')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
