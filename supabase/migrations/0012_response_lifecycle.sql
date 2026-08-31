-- A qualification response now has a lifecycle: started the moment a
-- prospect gives their email, before they've answered a single question;
-- completed once they finish and get scored.
--
-- Until now this table was written exactly once, atomically, on full
-- submission (migration 0003) — which meant nobody who started the
-- questionnaire and left partway through existed anywhere. There was no way
-- to answer "how many people even started," and therefore no real
-- completion rate — which is the whole point of collecting email up front:
-- the questions are what turns a visitor into a meeting, so knowing how
-- many drop out, and whether they land on the meeting path once they
-- finish, is what tells a tenant whether a question is working.
--
-- started_at is created_at, renamed to say what it now means: every
-- existing row already represents a completed submission (there was no
-- other kind before this migration), so backfilling completed_at = started_at
-- for all of them is exactly correct, not an approximation.
alter table qualification_responses rename column created_at to started_at;

alter table qualification_responses add column completed_at timestamptz;
update qualification_responses set completed_at = started_at;

-- outcome_path_type is null for a response still in progress — it was
-- historically not-null because every row was already complete by the time
-- it existed at all.
alter table qualification_responses alter column outcome_path_type drop not null;

-- A response is either not finished (both null) or finished (both set),
-- never a mix — encoded here rather than left to the application layer to
-- get right on every write path that touches this table.
alter table qualification_responses
  add constraint response_completion_paired
  check ((completed_at is null) = (outcome_path_type is null));

-- A started response has an empty answer set until it's completed.
alter table qualification_responses alter column answers set default '[]'::jsonb;

-- email was optional, collected only at the very end, alongside the full
-- answer set. The new /qualify/start route is what makes it required and
-- moves its collection to the front of the flow — enforced at the API
-- layer (requireEmail), not here, so this migration doesn't need to touch
-- or backfill any existing row's email.
