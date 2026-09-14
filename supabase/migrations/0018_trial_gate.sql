-- The trial gate — a business gets 7 days of full access from signup, no
-- card required (a friendlier default for a product nobody knows yet), and
-- loses access to its own dashboard and new bookings once that runs out,
-- unless it's converted to a paid plan or been given free access.
--
-- Two independent levers, both editable from /console:
--
--   trial_ends_at  when a trial-plan tenant's access actually runs out.
--                  Pushing this date out ("give them 3 more weeks") is a
--                  temporary extension — the tenant is still, in every
--                  other sense, on a trial.
--
--   free_access    a permanent override, independent of plan or trial
--                  state entirely. For comping an account outright (a
--                  customer-service call, a partner, a friend) — flip it
--                  on and everything underneath (their real plan, their
--                  trial countdown) keeps existing but is ignored until
--                  it's flipped back off.
--
-- Deliberately two separate fields rather than one: "extend the trial" and
-- "comp this account forever" are different operations with different
-- reversibility, and conflating them (e.g. pushing trial_ends_at to some
-- far-future sentinel to mean "forever") would make the tenant list
-- unable to tell a genuine new signup from a permanently comped account
-- without reading the date closely.
--
-- No cron job needed to enforce any of this — see src/lib/billing-gate.ts.
-- Whether a tenant is gated is a plain computed check ("is now() past
-- trial_ends_at"), evaluated at request time in the two places every
-- request already funnels through (requireTenantMembership for the
-- dashboard, requireTenant for the public booking surface) — not a
-- scheduled job flipping a status field, which would need its own
-- infrastructure and could simply not run.

alter table tenants add column trial_ends_at timestamptz;
alter table tenants add column free_access boolean not null default false;

-- Every tenant that exists today was provisioned by hand, long before this
-- gate existed — none of them ever agreed to a trial with a clock on it,
-- and locking them out on deploy would be a real, user-visible regression
-- for no reason. Grandfather them in as free access rather than backfilling
-- a fabricated trial_ends_at that never actually applied to them.
update tenants set free_access = true;
