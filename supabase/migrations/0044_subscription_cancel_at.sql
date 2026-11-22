-- When a subscription that was cancelled ends: Stripe keeps it running to
-- the end of the period already paid (or the free trial), then ends it.
-- Null while it carries on. Lets the Plan say "ends on …" rather than
-- "renews on …" once somebody has cancelled.

alter table tenants add column if not exists subscription_cancel_at timestamptz;

insert into schema_migrations (version) values ('0044_subscription_cancel_at')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
