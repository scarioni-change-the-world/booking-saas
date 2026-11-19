-- Which terms a business accepted at sign-up, and when (the required
-- checkbox on the sign-up form). Businesses made before this have none.
alter table tenants
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version text;

insert into schema_migrations (version) values ('0043_terms_acceptance')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
