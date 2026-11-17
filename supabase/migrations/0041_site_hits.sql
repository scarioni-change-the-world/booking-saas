-- khloe's own website counter (khloe.io), shown in the owner console.
--
-- Privacy by construction: no cookies on the visitor's device, no IP
-- address and no browser string stored. `visitor` is a code made from the
-- IP and browser with a secret that changes every day, so it counts "the
-- same visitor today" and cannot be turned back or linked across days.
-- Visitors whose browser asks not to be tracked are never sent here.
--
-- Written by the server only (service role). No policies.

create table if not exists site_hits (
  id            bigint generated always as identity primary key,
  day           date not null default (now() at time zone 'utc')::date,
  -- 'pageview', or an action on the site: 'Start free', 'Sign in',
  -- 'Demo started', 'Demo booked'.
  kind          text not null,
  path          text not null,
  -- Where the visitor came from: a host only (instagram.com), never a full address.
  source        text,
  -- Where on the page an action happened (hero, header, price, closing).
  place         text,
  device        text not null,
  country       text,
  visitor       text not null,
  created_at    timestamptz not null default now(),

  constraint site_hits_kind_known
    check (kind in ('pageview', 'Start free', 'Sign in', 'Demo started', 'Demo booked')),
  constraint site_hits_device_known check (device in ('phone', 'tablet', 'computer')),
  constraint site_hits_short check (
    length(path) <= 200 and coalesce(length(source), 0) <= 100
    and coalesce(length(place), 0) <= 40 and coalesce(length(country), 0) <= 2
    and length(visitor) = 16
  )
);

create index if not exists site_hits_day on site_hits (day);

alter table site_hits enable row level security;
alter table site_hits force row level security;

insert into schema_migrations (version) values ('0041_site_hits')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
