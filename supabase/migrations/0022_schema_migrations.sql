-- Which migrations this database has actually had run against it.
--
-- There is no migration runner in this project's deployment: Vercel builds
-- and ships the application, and the SQL in this directory is applied by
-- hand in Supabase's editor. That is a perfectly workable arrangement right
-- up until someone forgets, at which point the new code calls something the
-- database does not have and the failure surfaces as handleError's
-- deliberately generic "Something went wrong" — a message chosen to tell an
-- attacker nothing, which also tells the operator nothing. It cost an
-- afternoon once already (migration 0021's auth_user_id_by_email).
--
-- The fix is not to remember harder. The database records what it has, the
-- application carries the list it expects (src/lib/db/migrations.ts, kept
-- honest against this directory by a test), and /api/health compares the two
-- and refuses to report ready when they disagree — naming the files still
-- outstanding. A deploy that needs SQL now says so, in the one place already
-- built to answer "which piece is missing".
--
-- From here on, every migration ends by recording itself. The line is three
-- seconds of typing and it is what makes the check above true rather than
-- decorative.

create table schema_migrations (
  -- The filename without .sql — '0021_auth_user_lookup'. A text key rather
  -- than an integer so the version is self-describing in a bare select, and
  -- so it sorts the same way the directory listing does.
  version    text primary key,
  applied_at timestamptz not null default now()
);

-- Nothing but the server has any business reading this, and the server runs
-- as service_role, which bypasses RLS. Enabled and forced with no policies
-- is therefore "service_role only" — the same posture as
-- rate_limit_counters in migration 0019.
alter table schema_migrations enable row level security;
alter table schema_migrations force row level security;

-- Everything up to and including this file.
--
-- On a fresh database this is simply the truth: the migrations ran in order
-- and this one is last. On an existing database it is an assertion — that a
-- database far enough along to be running 0022 must have had 0001-0021 run
-- against it, since the application has been working. That assertion is only
-- wrong if someone previously skipped a file, which is the exact failure
-- this table exists to stop happening again from here.
insert into schema_migrations (version) values
  ('0001_tenancy'),
  ('0002_booking_core'),
  ('0003_qualification'),
  ('0004_bookings'),
  ('0005_rls'),
  ('0006_calendar_connections'),
  ('0007_service_role_grants'),
  ('0008_revoke_anon'),
  ('0009_platform_staff'),
  ('0010_clients'),
  ('0011_outcome_paths'),
  ('0012_response_lifecycle'),
  ('0013_booking_mode'),
  ('0014_pack_size_ceiling'),
  ('0015_ai_usage'),
  ('0016_question_scoping'),
  ('0017_email'),
  ('0018_trial_gate'),
  ('0019_rate_limits'),
  ('0020_client_invite'),
  ('0021_auth_user_lookup'),
  ('0022_schema_migrations')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
