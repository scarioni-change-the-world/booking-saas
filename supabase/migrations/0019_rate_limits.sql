-- Rate limiting for the public booking surface.
--
-- Two endpoints under /t/[slug] let a completely anonymous caller create
-- rows and spend real resources: .../qualify/start opens a questionnaire
-- response (migration 0012 — and every one of those lands in the tenant's
-- own completion-rate numbers, so junk here doesn't just fill a table, it
-- corrupts the one metric the gate is judged on), and .../bookings takes a
-- real calendar slot and sends mail from the product's own sending domain.
-- Nothing bounded how fast one caller could do either.
--
-- Counted in Postgres rather than in memory. This app runs serverless: an
-- in-process counter lives and dies with one instance, so a caller spread
-- across instances is barely limited at all, and the limit silently loosens
-- as traffic grows. Postgres is the one thing every instance already
-- shares, so this needs no new infrastructure — the same reasoning migration
-- 0018 used for not introducing a cron.
--
-- A fixed window, not a sliding one: a caller who times it right lands up
-- to 2x the limit across a window boundary. That is fine for what this is.
-- It exists to make abuse tedious, not to meter a quota anyone is billed
-- for — see src/lib/ai/usage.ts for the one thing here that IS a cost
-- ceiling, and note it is deliberately a different mechanism.

create table rate_limit_counters (
  -- "<action>:<tenant id>:<client ip>", built in src/lib/rate-limit.ts and
  -- opaque here. Deliberately not a tenant_id column with a foreign key the
  -- way every other table in this schema has: these are throwaway counters,
  -- not tenant data. They carry nothing worth keeping, must stay writable
  -- for a tenant that is mid-delete, and would otherwise be the one table
  -- where TenantScope's guarantees imply a protection they don't need.
  key          text primary key,
  window_start timestamptz not null default now(),
  hits         integer not null default 0
);

-- For the housekeeping delete inside the function below, which is the only
-- thing that ever reads this column on its own.
create index rate_limit_counters_window_idx on rate_limit_counters (window_start);

/*
 * Count one attempt against `p_key`, and say whether it is still allowed.
 *
 * One statement, so the read-modify-write cannot interleave: the upsert
 * takes a row lock on conflict, which a check-then-update in the app could
 * not (and, as src/lib/ai/usage.ts notes about its own check-then-insert,
 * would occasionally let a caller over the line).
 *
 * Returns true when the attempt is within the limit, false when it is over.
 * The attempt is counted either way — a caller who keeps hammering after
 * being refused keeps their window rolling forward, rather than getting a
 * fresh allowance the moment they stop being told no.
 */
create function consume_rate_limit(
  p_key            text,
  p_limit          integer,
  p_window_seconds integer
) returns boolean
language plpgsql
as $$
declare
  v_now    timestamptz := now();
  v_cutoff timestamptz := now() - make_interval(secs => p_window_seconds);
  v_hits   integer;
begin
  insert into rate_limit_counters as c (key, window_start, hits)
  values (p_key, v_now, 1)
  on conflict (key) do update
     set hits         = case when c.window_start < v_cutoff then 1      else c.hits + 1      end,
         window_start = case when c.window_start < v_cutoff then v_now  else c.window_start  end
  returning c.hits into v_hits;

  -- Housekeeping without a scheduled job to run it: roughly one call in a
  -- hundred also clears out counters nobody has touched for a day. A window
  -- is an hour at most, so anything that old can only be a bucket for an IP
  -- that never came back. Doing it here keeps the table self-maintaining
  -- rather than adding a cron this app does not otherwise have.
  if random() < 0.01 then
    delete from rate_limit_counters where window_start < v_now - interval '1 day';
  end if;

  return v_hits <= p_limit;
end;
$$;

alter table rate_limit_counters enable row level security;
alter table rate_limit_counters force row level security;

-- No policies at all, deliberately. service_role carries BYPASSRLS and is
-- the only thing that ever touches this table (through src/lib/db, like
-- every other query in this app); anon and authenticated should reach it
-- through nothing, ever, and with RLS forced and no policy written, they
-- can't — even if a future migration hands them a table grant by accident,
-- which is exactly what migration 0008 was written about.

-- The same lesson, applied to the function. A newly created function is
-- EXECUTE-able by PUBLIC by default, and 0008's `revoke all on all
-- functions from anon` was a snapshot taken before this one existed —
-- nothing there covers a function created later. SECURITY INVOKER (the
-- default, kept deliberately) means an anon caller would fail on the table
-- grant anyway, but a function exposed through the Data API is a surface in
-- its own right: anyone able to call this could pre-exhaust someone else's
-- counter, turning a limiter into a denial of service against them.
revoke all on function consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function consume_rate_limit(text, integer, integer) to service_role;
