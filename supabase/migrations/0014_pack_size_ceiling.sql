-- Tighten booking-pack size to the digital brand kit's real ceiling.
--
-- Migration 0013 shipped event_types_pack_size_sane as "2 and 50" — a
-- reasonable-sounding guess made before the actual product spec was in
-- hand. The digital brand kit is explicit: "Booking packs of up to ten
-- bookings." This is a new migration rather than an edit to 0013 because
-- 0013 already shipped (committed, and possibly applied to a real
-- database) — migrations here are a historical record of what actually
-- ran, not a draft to revise in place.
--
-- Postgres has no "alter constraint" for a check — drop and recreate.
-- Nothing currently in the schema can violate the new range: the seed's
-- one pack-mode row (migration 0013's own demo, pack_size 10) is already
-- within it, so no data migration is needed alongside this.
alter table event_types drop constraint event_types_pack_size_sane;

alter table event_types
  add constraint event_types_pack_size_sane
  check (pack_size is null or pack_size between 2 and 10);
