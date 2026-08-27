-- Outcome paths — what happens after someone answers (PRODUCT_VISION.md §17).
--
-- Until now, every screening question option reduced to a single boolean:
-- does this answer "qualify" or not (migration 0003), and the one alternative
-- to the calendar was a single message + redirect stored once per tenant, on
-- tenant_settings. PRODUCT_VISION.md rejects that framing outright — someone
-- who doesn't get the calendar isn't a rejected transaction, they're being
-- sent down a different, equally intentional path (an alternative service, a
-- resource, a referral, staying in touch for later). The product needs a
-- real object for "a path an answer leads to," not a flag.
--
-- This migration introduces that object without building all of it. Exactly
-- two path types exist today:
--
--   meeting   the calendar. What used to be qualifies = true.
--   other     everywhere else. What used to be qualifies = false, and used
--             to live as one message on tenant_settings.
--
-- One row per type per tenant (the unique constraint below), auto-seeded the
-- moment a tenant exists — same trigger pattern as tenant_settings (migration
-- 0009's create_default_tenant_settings). Every future path type the product
-- vision names (alternative service, resource, referral, downloads, ...) is
-- an additional enum value; the day one of those needs multiplicity (a
-- tenant offering two different resources, say) is a later, contained
-- migration that changes what a question option references — not a rebuild
-- of this table.

create type outcome_path_type as enum ('meeting', 'other');

create table outcome_paths (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  type           outcome_path_type not null,
  -- Admin-facing label only — never shown to a prospect.
  name           text not null,
  -- Shown to a prospect sent down this path. Unused (blank) for 'meeting':
  -- that path is the calendar itself, not a message.
  message        text not null default '',
  redirect_url   text,
  redirect_label text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- v1: exactly one path per type per tenant. A question option (below)
  -- references a path by *type*, not by id, which is only sound while this
  -- constraint holds — see the migration comment above.
  constraint outcome_paths_one_per_type unique (tenant_id, type)
);

create index outcome_paths_tenant_idx on outcome_paths (tenant_id);

-- ---------------------------------------------------------------------------
-- Seed both paths for every tenant that already exists...
-- ---------------------------------------------------------------------------
insert into outcome_paths (tenant_id, type, name)
select id, 'meeting', 'Book a meeting'
from tenants;

insert into outcome_paths (tenant_id, type, name, message, redirect_url, redirect_label)
select tenant_id, 'other', 'Another path',
       coalesce(disqualification_message, ''),
       disqualification_redirect_url,
       disqualification_redirect_label
from tenant_settings;

-- ...and for every tenant from now on, the same way tenant_settings already
-- guarantees itself (migration 0009).
create function create_default_outcome_paths() returns trigger
language plpgsql as $$
begin
  insert into outcome_paths (tenant_id, type, name) values (new.id, 'meeting', 'Book a meeting');
  insert into outcome_paths (tenant_id, type, name) values (new.id, 'other', 'Another path');
  return new;
end;
$$;

create trigger tenants_create_outcome_paths
  after insert on tenants
  for each row execute function create_default_outcome_paths();

-- ---------------------------------------------------------------------------
-- Question options now reference a path type instead of carrying a bare
-- qualifies flag. Rewrite existing rows in place: qualifies true -> 'meeting',
-- false -> 'other'. The qualification_options_shape constraint (migration
-- 0003) still holds — this changes what each element looks like, not how many.
-- ---------------------------------------------------------------------------
update qualification_questions
set options = (
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'label', opt->>'label',
      'outcomePathType', case when (opt->>'qualifies')::boolean then 'meeting' else 'other' end
    )
  ), '[]'::jsonb)
  from jsonb_array_elements(options) as opt
)
where jsonb_array_length(options) > 0;

-- ---------------------------------------------------------------------------
-- Same move for qualification_responses: a response's outcome IS which path
-- it landed on, so it is stored as one, not as a pass/fail enum.
-- ---------------------------------------------------------------------------
alter table qualification_responses add column outcome_path_type outcome_path_type;

update qualification_responses
set outcome_path_type = (case outcome when 'qualified' then 'meeting' else 'other' end)::outcome_path_type;

alter table qualification_responses alter column outcome_path_type set not null;
alter table qualification_responses drop column outcome;
drop type qualification_outcome;

-- tenant_settings no longer owns this data — outcome_paths does, and nowhere
-- else kept a copy, so this is a real move, not a duplicate.
alter table tenant_settings drop column disqualification_message;
alter table tenant_settings drop column disqualification_redirect_url;
alter table tenant_settings drop column disqualification_redirect_label;

-- ---------------------------------------------------------------------------
-- RLS — same shape as every other tenant-scoped table (migration 0005).
-- Nothing creates or deletes a path in v1 (the trigger above is the only
-- writer of new rows), so only update is granted.
-- ---------------------------------------------------------------------------
alter table outcome_paths enable row level security;
alter table outcome_paths force row level security;

create policy outcome_paths_read on outcome_paths
  for select to authenticated using (auth_is_tenant_member(tenant_id));
create policy outcome_paths_write on outcome_paths
  for update to authenticated
  using (auth_is_tenant_admin(tenant_id)) with check (auth_is_tenant_admin(tenant_id));
