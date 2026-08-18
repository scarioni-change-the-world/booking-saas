-- The qualification gate — the product's differentiator (brief 1, 2.2).

create type question_kind      as enum ('text', 'yes_no', 'single_choice');
create type qualification_outcome as enum ('qualified', 'redirected');

create table qualification_questions (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  prompt     text not null,
  kind       question_kind not null,
  -- For single_choice: [{ "label": "...", "qualifies": true|false }, ...].
  -- Each option carries its own flag; ANY option with qualifies=false
  -- disqualifies the whole response (brief 2.2).
  options    jsonb not null default '[]'::jsonb,
  required   boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),

  -- yes_no and single_choice both need options; free text must not have them.
  constraint qualification_options_shape check (
    case kind
      when 'text' then jsonb_array_length(options) = 0
      else jsonb_array_length(options) > 0
    end
  )
);

create index qualification_questions_tenant_idx
  on qualification_questions (tenant_id, sort_order);

create table qualification_responses (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  -- Snapshot of the answers: [{ question_id, prompt, kind, answer, qualifies }].
  -- Denormalised on purpose so a later edit or hard delete of a question does
  -- not rewrite history the tenant may need to review.
  answers    jsonb not null,
  outcome    qualification_outcome not null,
  email      text,
  created_at timestamptz not null default now()
);

create index qualification_responses_tenant_idx
  on qualification_responses (tenant_id, created_at desc);
