-- Does this database match what the code expects?
--
-- Read-only. Paste the whole file into the Supabase SQL editor and run it.
-- Nothing here writes, locks, or changes anything, so it is safe to run
-- against a live project as often as you like.
--
-- Why this exists: supabase/migrations/*.sql is the source of truth for the
-- schema, but a database can also be built by hand in the dashboard, or by
-- applying some migrations and not others. Both leave a database that looks
-- fine until the app asks it for a column that was never added. This tells
-- you which of those you have, in one pass, before you go hunting through
-- application errors.
--
-- Every row of the output is either OK or something to fix. Read the
-- `status` column; anything that is not "OK" names what to do.

with expected_tables(name) as (
  values
    ('tenants'), ('tenant_members'), ('tenant_settings'), ('reserved_slugs'),
    ('event_types'), ('availability_rules'), ('date_overrides'), ('blocked_slots'),
    ('qualification_questions'), ('qualification_responses'), ('outcome_paths'),
    ('bookings'), ('calendar_connections'), ('platform_staff'),
    ('clients'), ('client_entitlements'), ('ai_usage_events'),
    ('email_templates'), ('rate_limit_counters')
),
present_tables as (
  select tablename as name from pg_tables where schemaname = 'public'
),
-- A column that a specific migration added. If one of these is missing, that
-- migration has not been applied, whatever the table list says.
expected_columns(migration, table_name, column_name) as (
  values
    ('0010 clients',      'clients',                 'access_token'),
    ('0012 responses',    'qualification_responses', 'started_at'),
    ('0013 booking mode', 'event_types',             'booking_mode'),
    ('0016 q scoping',    'qualification_questions', 'event_type_id'),
    ('0017 email',        'bookings',                'email_status'),
    ('0018 trial gate',   'tenants',                 'trial_ends_at'),
    ('0018 trial gate',   'tenants',                 'free_access'),
    ('0019 rate limits',  'rate_limit_counters',     'window_start')
)

select * from (

  -- 1. Tables the code needs but the database does not have.
  select
    1 as sort,
    'missing table: ' || e.name as item,
    'MISSING — apply supabase/migrations in order, or bootstrap/full_setup.sql on an empty project' as status
  from expected_tables e
  where not exists (select 1 from present_tables p where p.name = e.name)

  union all

  -- 2. Tables in the database that the code knows nothing about. Not
  --    necessarily wrong — but if you built tables by hand, this is where
  --    they show up, and the app will never read or write them.
  select
    2,
    'unexpected table: ' || p.name,
    'NOT USED BY THE APP — harmless, but nothing reads it'
  from present_tables p
  where not exists (select 1 from expected_tables e where e.name = p.name)

  union all

  -- 3. Per-migration marker columns.
  select
    3,
    'migration ' || c.migration || ' (' || c.table_name || '.' || c.column_name || ')',
    case when exists (
      select 1 from information_schema.columns ic
      where ic.table_schema = 'public'
        and ic.table_name = c.table_name
        and ic.column_name = c.column_name
    ) then 'OK' else 'NOT APPLIED — this migration is missing' end
  from expected_columns c

  union all

  -- 4. Migration 0019's function, which is not a column and so would not
  --    show up above.
  select
    4,
    'migration 0019 (consume_rate_limit function)',
    case when exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'consume_rate_limit'
    ) then 'OK' else 'NOT APPLIED — rate limiting will fail open on every request' end

  union all

  -- 5. Migration 0020 converted email_templates.kind from an enum to text.
  select
    5,
    'migration 0020 (email_templates.kind is text)',
    coalesce((
      select case when data_type = 'text' then 'OK'
                  else 'NOT APPLIED — still ' || data_type || ', the client_invite template cannot exist' end
      from information_schema.columns
      where table_schema = 'public' and table_name = 'email_templates' and column_name = 'kind'
    ), 'table missing')

  union all

  -- 6. Row-level security. service_role bypasses it, so the app works
  --    either way — which is exactly why a gap here goes unnoticed.
  select
    6,
    'row-level security enabled on every table',
    case when (
      select count(*) from pg_tables t
      join pg_class c on c.relname = t.tablename
      join expected_tables e on e.name = t.tablename
      where t.schemaname = 'public' and not c.relrowsecurity
    ) = 0 then 'OK'
    else (
      select 'OFF on: ' || string_agg(t.tablename, ', ')
      from pg_tables t
      join pg_class c on c.relname = t.tablename
      join expected_tables e on e.name = t.tablename
      where t.schemaname = 'public' and not c.relrowsecurity
    ) end

  union all

  -- 7. Can the app's own role actually read? A missing GRANT looks exactly
  --    like a policy bug from the application side — see migration 0007.
  select
    7,
    'service_role can read tenants',
    case when has_table_privilege('service_role', 'tenants', 'select')
         then 'OK' else 'NO GRANT — apply migration 0007' end

  union all

  -- 8. What is actually in here.
  select 8, 'data: tenants',        (select count(*)::text from tenants)
  union all
  select 8, 'data: platform staff (you need >=1 to use /console)',
            (select count(*)::text from platform_staff)
  union all
  select 8, 'data: bookings',       (select count(*)::text from bookings)
  union all
  select 8, 'data: email templates (5 per tenant once 0020 is applied)',
            (select count(*)::text from email_templates)

) report
order by sort, item;
