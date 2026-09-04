-- Per-service intake — questions and responses can now belong to one
-- specific service instead of only ever applying to every service a tenant
-- offers.
--
-- Until now a tenant had exactly one questionnaire, shared across every
-- session type. Migration 0013 gave tenants a real service builder with
-- packs and distinct offerings; the gate itself never caught up — a
-- discovery call and a €2,000 coaching package were still screened with
-- the same questions. This migration is that catch-up.
--
-- event_type_id null means "asked for every prospect-facing service" —
-- exactly what every existing question already is, which is why this
-- needs no backfill: the column defaults to null on every existing row,
-- preserving today's behaviour with nothing rewritten. Set, it means the
-- question applies only when that one service is being booked. Not a join
-- table: most tenants will have a couple of shared questions and maybe one
-- or two service-specific ones, not a many-to-many web, and this is
-- additive to widen later the same way outcome_paths' path types are
-- (migration 0011's own reasoning).
--
-- ON DELETE SET NULL, not CASCADE: event types are essentially never hard-
-- deleted in this schema ("delete" already means archive — see migration
-- 0010's note on client_entitlements), but if one ever is, a question that
-- was specific to it demotes to global and stays visible for an admin to
-- deal with, rather than silently vanishing.
alter table qualification_questions
  add column event_type_id uuid references event_types(id) on delete set null;

alter table qualification_responses
  add column event_type_id uuid references event_types(id) on delete set null;

-- Every question list a caller actually needs is "this tenant, this scope,
-- in order" — global questions (event_type_id is null) or one service's
-- own. Postgres groups nulls together in a btree, so one index serves both
-- shapes. The existing (tenant_id, sort_order) index still serves the
-- admin's "everything, in stored order" listing, so it stays.
create index qualification_questions_tenant_scope_idx
  on qualification_questions (tenant_id, event_type_id, sort_order);
