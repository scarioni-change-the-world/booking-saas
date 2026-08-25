-- =============================================================================
-- booking-saas — make yourself the platform owner
-- =============================================================================
-- Run this AFTER applying migration 0009 (platform_staff), and after signing
-- in at least once with the login you use for the company itself.
--
-- Why this is a manual step: there is no one else yet to have added you, so
-- nothing creates the platform_staff row that lets /console recognise you.
-- Run this once and you're the only row in the table, with the 'owner' role
-- — full control, including the power to add the next person later from
-- inside /console itself, rather than needing another manual SQL step.
-- =============================================================================

-- >>> CHANGE THIS to the email you sign in with <<<
insert into platform_staff (user_id, role)
select u.id, 'owner'
from auth.users u
where u.email = 'you@example.com'
on conflict (user_id) do update set role = 'owner';

-- Verification. One row means you're in; zero rows means the email did not
-- match a user — check for a typo rather than re-running.
select u.email, s.role, s.created_at
from platform_staff s
join auth.users u on u.id = s.user_id;
