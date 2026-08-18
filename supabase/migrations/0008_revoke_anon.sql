-- Close the anon grant on calendar_connections.
--
-- 0005 ends with `revoke all on all tables in schema public from anon`, which
-- covers every table existing at that moment. 0006 then creates
-- calendar_connections — after the revoke has already run. On a project where
-- Supabase's "automatically expose new tables" was enabled, that table therefore
-- received an anon grant that nothing took back.
--
-- It was not exploitable: calendar_connections has RLS enabled and forced with
-- no policy for anon, so the grant passed but the policy check denied. That is
-- one layer of defence on the table holding every tenant's encrypted Google
-- refresh token, where the design calls for two.
--
-- The lasting fix is the default-privileges line: a revoke is a snapshot and
-- goes stale the moment another migration adds a table, which is exactly how
-- this arose.

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- authenticated keeps its grants. Every table it can reach is gated by the
-- membership policies in 0005, verified to isolate tenants from each other, so
-- those policies now act as live enforcement rather than dormant defence. The
-- app does not rely on this — the dashboard goes through its own /api routes —
-- but leaving it working means a future browser-side query is not blocked by a
-- missing grant that looks like a policy bug.
