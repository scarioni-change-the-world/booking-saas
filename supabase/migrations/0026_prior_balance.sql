-- What somebody was already owed when they booked again.
--
-- A client who had bought a three-session programme, cancelled one, and was
-- therefore owed a session went back to the public booking page — because
-- until recently that was the only door they could find — answered the
-- questionnaire as though they were new, and booked three more. The
-- accounting held: one client record, one balance, topped up rather than
-- forked. Nothing anywhere said it had happened.
--
-- The business's decision, deliberately, not the product's. There is no
-- payment in this system, so "booking a programme" and "buying one" are the
-- same act, and a genuine second purchase looks identical to somebody who
-- simply could not find their own link. Blocking the second would refuse a
-- paying customer to prevent a misunderstanding; saying nothing leaves the
-- business to discover it in their diary. So it is recorded and shown.
--
-- Why a column rather than a query: this is a fact about a moment. After
-- the second programme is booked the two balances are one number, and no
-- amount of reading the table afterwards can recover what was outstanding
-- beforehand. It has to be written down as it happens or not at all.
--
-- Null on every booking that is not the first appointment of a programme,
-- and on every programme bought by somebody who owed nothing — which is
-- almost all of them. A zero would be a claim; null is the absence of one.
alter table bookings add column prior_sessions_owed integer;

alter table bookings
  add constraint bookings_prior_sessions_owed_sane
  check (prior_sessions_owed is null or prior_sessions_owed > 0);

comment on column bookings.prior_sessions_owed is
  'Sessions this client was still owed at the moment this programme was booked. Set only on the first appointment of a pack, and only when it was above zero.';

insert into schema_migrations (version) values ('0026_prior_balance')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
