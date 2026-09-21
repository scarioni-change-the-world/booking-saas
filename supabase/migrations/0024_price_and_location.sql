-- What it costs, and where it happens.
--
-- Two things a stranger looking at a booking page asks before anything else,
-- and neither existed. A coach's page that cannot say "€60, online" is
-- missing the two facts that decide whether the rest of the page is worth
-- reading — so the client-facing experience had to render a service with no
-- price and no location at all, which is a worse answer than either.
--
-- PRICE is stored in minor units as an integer. Never a float: 0.1 + 0.2 is
-- not 0.3 in binary floating point, and money that does not add up is the
-- one bug nobody forgives. "Minor units" rather than cents because the
-- exponent is a property of the currency — JPY has none, most have two —
-- and Intl.NumberFormat already knows every one of them (see
-- src/lib/money.ts, which reads the exponent from it rather than assuming
-- 100).
--
-- Nullable means "not stated", which stays the default: every service that
-- exists today carries no price, and showing "€0.00" for those would be a
-- lie about free work rather than silence about an unset field.
--
-- CURRENCY lives on the tenant, not the service. A business bills in one
-- currency; putting it per service would let somebody price one session in
-- euros and the next in dollars, which no real business wants and every
-- client would misread. Defaulted rather than nullable, because a price with
-- no currency is unrenderable, and a default that is occasionally wrong is
-- fixable in settings where a null would be a crash.
--
-- LOCATION is an enum plus free text, not free text alone. "Online" has to
-- be a thing the software knows, so a page can say it plainly and a calendar
-- invitation can carry it; the text beside it is the part only the business
-- can write — a street address, a room number, "we'll ring the number you
-- give us". Text without a kind is forbidden by the check below, because an
-- address attached to nothing renders as a floating line no one can place.

create type service_location_kind as enum ('online', 'in_person', 'phone');

alter table event_types add column price_minor     integer;
alter table event_types add column location_kind   service_location_kind;
alter table event_types add column location_detail text;

-- Non-negative, and a ceiling high enough for any real appointment while
-- still catching the misplaced decimal that turns €60 into €6,000,000. Same
-- spirit as event_types_duration_sane: a range check, not a business rule.
alter table event_types
  add constraint event_types_price_sane
  check (price_minor is null or price_minor between 0 and 100000000);

alter table event_types
  add constraint event_types_location_detail_needs_kind
  check (location_detail is null or location_kind is not null);

-- ISO 4217: three letters, upper case. Checked rather than trusted, because
-- this string is handed straight to Intl.NumberFormat, which throws on
-- anything it does not recognise — and a settings page should not be able to
-- make every booking page in an account fail to render.
alter table tenant_settings
  add column currency text not null default 'EUR';

alter table tenant_settings
  add constraint tenant_settings_currency_iso
  check (currency ~ '^[A-Z]{3}$');

insert into schema_migrations (version) values ('0024_price_and_location')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
