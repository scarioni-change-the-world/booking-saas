-- How a session is booked — one at a time, or as a declared pack of several
-- (brief: the service-builder reference the tenant is modelling this admin
-- UI on shows a pack size — "5 / 8 / 10" — declared on the service itself,
-- not granted ad hoc afterward the way client_entitlements works today).
--
-- This migration adds the declaration only. It does not touch how a package
-- actually gets onto a client's account — that is still a manual grant from
-- the Clients page (migration 0010's client_entitlements), because there is
-- no checkout in this product yet (README: Stripe billing is milestone 3)
-- and a client can't literally buy a pack through intro today. What this
-- *does* do is give the admin dashboard's "grant a package" form something
-- real to default to, instead of every grant starting from a bare "10".
--
-- single: booked one at a time — today's only behaviour, and stays the
--         default so every existing session type is unaffected.
-- pack:   the tenant is declaring this session is meant to be sold as a
--         bundle of pack_size sessions. pack_size is required exactly when
--         the mode is 'pack' and forbidden otherwise — enforced by the
--         paired check below, the same pattern migration 0012's
--         response_completion_paired uses for started_at/outcome_path_type.

create type booking_mode as enum ('single', 'pack');

alter table event_types add column booking_mode booking_mode not null default 'single';
alter table event_types add column pack_size integer;

alter table event_types
  add constraint event_types_pack_size_paired
  check ((booking_mode = 'pack') = (pack_size is not null));

-- 2, not 1: a "pack" of one session is just a single booking with an extra
-- field. 50 is a generous ceiling for a real bundle, not a load-bearing
-- number — same spirit as the other "sane" range checks in this schema
-- (event_types_duration_sane, event_types_buffers_sane).
alter table event_types
  add constraint event_types_pack_size_sane
  check (pack_size is null or pack_size between 2 and 50);
