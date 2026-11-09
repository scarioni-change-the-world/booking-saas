-- A 30-day trial, and the founding price.
--
--   1. New businesses get 30 days free instead of 7 (set in code, plans.ts).
--      Businesses still on their trial get the same: their trial ends 30
--      days after they signed up, unless it was already set later by hand.
--   2. founding: a business that signed up while the founding offer was open
--      pays the founding price for as long as it keeps its account. Every
--      business that exists today joined before launch, so all of them get
--      it.

alter table tenants add column founding boolean not null default false;
update tenants set founding = true;

update tenants
   set trial_ends_at = created_at + interval '30 days'
 where plan = 'trial'
   and (trial_ends_at is null or trial_ends_at < created_at + interval '30 days');

insert into schema_migrations (version) values ('0035_trial_and_founding')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
