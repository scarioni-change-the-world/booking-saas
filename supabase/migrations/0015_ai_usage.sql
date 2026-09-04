-- AI usage tracking — a cost cap for src/lib/ai.
--
-- Every "Generate draft" click is a real, metered Anthropic API call with no
-- ceiling today — an acceptable gap while AI-assisted setup was admin-only
-- and untested, not once it's a paid-plan differentiator. This table is the
-- record src/lib/ai/usage.ts counts against to enforce a flat monthly limit
-- per tenant, per AI feature (`kind`) — a technical safety limit, not yet
-- tied to the (unbuilt) billing tiers.
--
-- One row per successful generation, not a running counter: an append-only
-- log needs no read-modify-write, so a burst of concurrent requests can't
-- corrupt a shared count the way incrementing one row could. The cost is a
-- COUNT(*) per check instead of a single-row read — negligible at the
-- volumes this table sees (an intentionally small monthly limit, per
-- tenant).

create table ai_usage_events (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  -- Which AI feature this generation belongs to. A check constraint, not an
  -- enum: a new AI feature adding its own kind is an additive migration
  -- either way, and text keeps this table's shape untouched when that
  -- happens (an enum would need its own ALTER TYPE).
  kind       text not null,
  created_at timestamptz not null default now(),

  constraint ai_usage_events_kind_known check (kind in ('intake_draft'))
);

-- Every limit check filters to one tenant, one kind, one calendar month —
-- this index covers exactly that query.
create index ai_usage_events_tenant_kind_created_idx
  on ai_usage_events (tenant_id, kind, created_at);

-- ---------------------------------------------------------------------------
-- RLS. Same shape as every other tenant-scoped table: members read, admins
-- write — see migration 0005 for the helpers this reuses. In practice only
-- server routes touch this table (via the service-role TenantScope), but
-- the posture here is the same as everywhere else in this schema: RLS is
-- not optional just because today's callers are trusted.
-- ---------------------------------------------------------------------------
alter table ai_usage_events enable row level security;
alter table ai_usage_events force row level security;

create policy ai_usage_read on ai_usage_events
  for select to authenticated using (auth_is_tenant_member(tenant_id));
create policy ai_usage_write on ai_usage_events
  for all to authenticated
  using (auth_is_tenant_admin(tenant_id)) with check (auth_is_tenant_admin(tenant_id));
