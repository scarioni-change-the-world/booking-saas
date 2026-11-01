-- Where a business's booking page has been put on a website, and whether it
-- loaded there.
--
-- embed.js, running on the business's own page, reports once per page load:
-- the page's address (no query string, no fragment) and whether the booking
-- page inside it answered. One row per site, updated in place, so Share can
-- say "Working on www.yourstudio.com/book" or "Your code is on
-- yourstudio.squarespace.com, which isn't allowed yet". Nothing about the
-- visitor is kept: no IP, no cookie, no browser details.

create table embed_sightings (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  host        text not null,
  page_url    text not null,
  ok          boolean not null,
  seen_at     timestamptz not null default now(),
  constraint embed_sightings_one_per_site unique (tenant_id, host),
  constraint embed_sightings_host_short check (length(host) between 1 and 253),
  constraint embed_sightings_page_short check (length(page_url) between 1 and 300)
);

alter table embed_sightings enable row level security;
alter table embed_sightings force row level security;
create policy embed_sightings_read on embed_sightings
  for select to authenticated using (auth_is_tenant_member(tenant_id));

insert into schema_migrations (version) values ('0034_embed_sightings')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
