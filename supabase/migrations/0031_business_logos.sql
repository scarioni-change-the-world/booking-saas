-- A place for each business's logo, shown at the top of its booking page.
--
-- One public bucket. Public means anyone with a logo's address can load it,
-- which is the point: it is shown to every visitor of the booking page.
-- Nobody writes to it from a browser — the server uploads with the service
-- key after checking the file is a real PNG, JPEG or WebP image under 1 MB
-- (src/lib/db/branding.ts) — so the bucket needs no write policies, and
-- without them every direct write from a signed-in user is refused.
--
-- SVG is left out on purpose: an SVG file can carry script, and one opened
-- directly from this bucket would run it.
--
-- The address is kept in tenants.branding.logoUrl, beside the colour and
-- whether the name shows next to the logo. No new column.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', true, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

insert into schema_migrations (version) values ('0031_business_logos')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
