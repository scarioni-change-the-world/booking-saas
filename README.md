# booking-saas

A multi-tenant booking platform with a **qualification gate** in front of the
calendar. Prospects answer screening questions before any times are shown, and
an answer can disqualify them — so service providers stop spending free
discovery calls on people who were never going to buy.

Built from `STANDALONE_PRODUCT_BRIEF.md`, which specs the multi-tenant product
from a working single-tenant system. Section references below (§) point at that
brief.

---

## Status

**Milestone 1 of 3 — foundation and booking flow.** The tenancy model, the slot
engine and the full prospect → booking → manage path are implemented and
covered by tests. Google Calendar, email, Stripe, signup and the admin dashboard
are not yet built; the interfaces they will plug into are.

| Area | State |
|---|---|
| Tenancy schema, per-tenant uniqueness | Built |
| RLS policies (dashboard surface) | Built |
| Structural tenant scoping (public surface) | Built |
| Slot generation engine | Built — 32 tests |
| Qualification gate | Built — 11 tests, enforced server-side |
| Prospect widget, existing-client widget | Built |
| Booking write path, reschedule, cancel | Built |
| Calendar provider interface | Built — only the `none` provider |
| Email provider interface | Built — only the console provider |
| Google Calendar | Not built (§6, milestone 2) |
| Transactional email + templates | Not built (§7.5, milestone 2) |
| Signup, onboarding, admin dashboard | Not built (§7.3, milestone 2) |
| Stripe billing | Not built (§7.4, milestone 3) |

### Not ported from the reference implementation

The reference implementation at `DoceMinutos/booking/` was not available when
this was written — only the brief was. Three things the brief says to keep
therefore need porting from the original rather than trusting what is here:

1. **`lib/google.js`** (~300 lines). Not written at all. The interface it must
   satisfy is `src/lib/calendar/provider.ts`.
2. **The email templates.** The brief calls them clean and tested and says to
   keep them, making branding tenant-driven. Nothing here reproduces them.
3. **`public/widget.html`'s UX.** `src/components/BookingFlow.tsx` implements
   the flow the brief describes, but it is a fresh implementation. Worth
   diffing against the original for copy and interaction details that were
   tuned against real users.

---

## Stack

Next.js 15 (App Router) · TypeScript · Supabase (Postgres + RLS) · Luxon ·
Vitest · Playwright. Deploys to Vercel.

Per §9.3, minus Stripe and Resend, which arrive with the milestones that need
them.

---

## Getting started

```bash
npm install
cp .env.example .env.local        # fill in SUPABASE_URL and the service role key
npm run test                      # 51 unit tests, no database required
npm run dev
```

To exercise the flow end to end you need a database:

```bash
# apply supabase/migrations/*.sql in order, then:
psql "$DATABASE_URL" -f supabase/seed.sql
npm run e2e
```

The seed creates a `demo-coaching` tenant at `/t/demo-coaching`, with a
disqualifying "I can't afford this right now" option so both branches of the
gate are reachable by hand.

---

## Layout

```
src/
├── lib/
│   ├── availability.ts       # the slot engine (§5)
│   ├── qualification.ts      # gate evaluation (§2.2)
│   ├── booking-service.ts    # assembles queries, writes bookings
│   ├── api.ts                # request parsing, error mapping
│   ├── tokens.ts             # manage-token generation
│   ├── db/
│   │   ├── client.ts         # service-role client, deliberately not exported
│   │   ├── scope.ts          # TenantScope — structural tenant scoping
│   │   ├── tenants.ts        # the only two unscoped lookups
│   │   └── types.ts          # row types
│   ├── calendar/             # provider interface (§7.6) + the `none` provider
│   └── email/                # provider interface (§7.5) + console provider
├── app/
│   ├── page.tsx              # public homepage, doubles as OAuth homepage (§6.5)
│   ├── t/[slug]/             # prospect widget
│   ├── t/[slug]/client/      # existing-client widget
│   ├── manage/[token]/       # reschedule / cancel
│   └── api/...
├── components/
└── middleware.ts             # per-tenant frame-ancestors (§7.2)

supabase/migrations/          # 0001 tenancy … 0005 RLS
tests/                        # Vitest — pure logic, no database
e2e/                          # Playwright — needs a seeded database
```

---

## The two decisions worth reviewing

### 1. Isolation is enforced twice, because there are two surfaces

§7.1 asks whether to use real RLS or disciplined app-level scoping, and answers
"strongly prefer RLS". That is right for the dashboard, where requests arrive as
the `authenticated` role — `0005_rls.sql` keys every policy on membership in
`tenant_members`, so a signed-in user of tenant A cannot read tenant B's rows
even if the application forgets to filter.

It cannot work for the public booking widget. A prospect is anonymous, and
`anon` is denied every table (the reference implementation's posture, preserved).
Those requests run server-side as `service_role`, which bypasses RLS — so on
that path a missed `WHERE` clause is a live risk again.

`src/lib/db/scope.ts` closes it structurally rather than by discipline. Every
query is built from a tenant id, `tenant_id` is applied by the builder rather
than written by the caller, and the unscoped client is not exported. Forgetting
the filter is not something a caller can do, because a caller never writes one.
`tests/scope.test.ts` pins the four invariants, including that a `tenant_id`
smuggled into a request body is overwritten and that an update cannot move a row
across tenants.

Two lookups are necessarily unscoped, both in `db/tenants.ts`: resolving a
tenant by slug and a booking by manage token. Each returns a `TenantScope`
alongside the row, so a caller goes from "no tenant" to "exactly one tenant" in
one step and never holds a bare client.

### 2. The booking path fails closed when the calendar is unreachable

§6.8 describes a dead Google connection that took nobody down and nobody
noticed: the app kept serving slots without conflict checking, created no
events, quietly dropped the Meet link from emails, and the admin panel still
read "Connected" because it only checked for an email string in the database.

So: `buildSlotQuery` throws `CalendarUnavailableError` rather than proceeding
with a short busy list, and the endpoint returns 503 with "temporarily
unavailable". For a paid product a double-booking is worse than a booking form
that admits it is down. `CalendarHealth` carries `checkedAt` so a health check
that never made a network call is distinguishable from one that did, and
`bookings.sync_status` / `sync_error` record what happened per booking (§6.9)
instead of a swallowed exception.

This is a deliberate availability trade. If a tenant would rather take
unchecked bookings than none, it should become a per-tenant setting — but the
default is to refuse.

---

## Notes on the code

**The slot engine is a careful port.** §5 says it was got wrong twice, and both
mistakes are pinned by name in `tests/availability.test.ts`: the cursor steps by
the session's own duration rather than a fixed grid, and buffers widen the
conflict-check range without shifting the displayed start time. DST is covered
in both directions against Europe/Madrid — including that a window opening at
02:00 on a spring-forward date yields nothing rather than silently becoming
03:00, which is what Luxon does if you let it.

**The gate is enforced server-side, at every door.** The widget receives
questions with the per-option `qualifies` flags stripped, so it cannot compute
an outcome, and both `/availability` and `/bookings` require a stored response
whose outcome is `qualified`. Enforcing it only in the widget would make the
differentiator decorative.

**The two visibility flags are independent booleans, not opposites** (§2.1).
Queries filter on the matching flag, never on the negation of the other.

**Bookings carry an exclusion constraint** (`0004_bookings.sql`) so two requests
racing past the availability check cannot both land. Cancelled bookings are
excluded from it, which is what frees the slot.

---

## Roadmap

**Milestone 2 — integrations and the dashboard**
- Google Calendar provider. Read §6.1–6.7 first: native `fetch` only, never the
  `googleapis` package (114 MB, 120-second cold starts); read
  `conferenceData.entryPoints[]` and not just `hangoutLink`; publish the OAuth
  app to Production or refresh tokens expire every 7 days; stay on
  `calendar.events` + `calendar.freebusy` to avoid the CASA assessment.
  **Start the OAuth verification early — it takes days to weeks and blocks
  launch** (§9.5).
- Transactional email via Resend or Postmark, product-owned sending domain with
  the tenant on `Reply-To`, tenant-driven branding (§7.5). SPF/DKIM is the step
  that gets skipped and then causes "our emails go to spam" tickets.
- Confirmation / notification / reminder / cancellation emails, `.ics`
  attachments. The `TODO(milestone 2)` markers in the route handlers show where.
- Signup, tenant provisioning, and the onboarding wizard, with questionnaire
  starter templates per vertical — a blank questionnaire is a bad first run
  (§7.3).
- Admin dashboard, including the day grid and a calendar health panel that
  actually calls the provider (§6.8).
- Replace the unlisted client URL with a per-client token. Unlisted is not
  authenticated, and today client-only session types rest on obscurity.

**Milestone 3 — commercial layer**
- Stripe: plans, trials, dunning, and a decided answer to what happens to
  existing bookings when a tenant lapses (§7.4).
- Hourly reminder cron with per-tenant timezone handling; the daily cron does
  not scale across timezones (§7.7).
- Free/busy caching — it is the hottest call and the Google quota is per OAuth
  client, shared across all tenants (§7.7).
- GDPR: processor-role privacy policy, per-tenant export and deletion,
  retention settings (§7.8).

**Open product questions** (§10) are unanswered and shape the above: vertical vs
horizontal positioning, whether the gate is the free hook or the paid feature,
and whether the disqualification path becomes a product surface rather than a
dead end. The analytics funnel (viewed → qualified → booked → attended) is
worth prioritising — it is the proof of the gate's value and therefore the
retention argument.
