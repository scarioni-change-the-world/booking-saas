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

**Milestone 1 complete; Google Calendar landed.** The tenancy model, the slot
engine, the full prospect → booking → manage path and the Google Calendar
integration are implemented and covered by tests. Email, Stripe, signup and the
admin dashboard UI are not yet built.

| Area | State |
|---|---|
| Tenancy schema, per-tenant uniqueness | Built |
| RLS policies (dashboard surface) | Built |
| Structural tenant scoping (public surface) | Built |
| Slot generation engine | Built — 32 tests |
| Qualification gate | Built — 11 tests, enforced server-side |
| Prospect widget, existing-client widget | Built |
| Booking write path, reschedule, cancel | Built |
| Calendar provider interface | Built |
| Google Calendar (busy, events, Meet, health) | Built — 20 tests, unverified against the live API |
| Google OAuth connect / disconnect | Built — routes only, no dashboard UI |
| Encrypted token storage | Built — AES-256-GCM, 12 tests |
| Email provider interface | Built — only the console provider |
| Transactional email + templates | Not built (§7.5, milestone 2) |
| Signup, onboarding, admin dashboard | Not built (§7.3, milestone 2) |
| Stripe billing | Not built (§7.4, milestone 3) |

### Not ported from the reference implementation

The reference implementation at `DoceMinutos/booking/` was not available when
this was written — only the brief was. Three things the brief says to keep
therefore need porting from the original rather than trusting what is here:

1. **`lib/google.js`** (~300 lines). `src/lib/calendar/google.ts` implements the
   same surface from the brief's §6 landmines rather than from the original
   code. Every §6 hazard is handled and tested, but against a mocked `fetch` —
   see the caveat below.
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
cp .env.example .env.local        # Supabase URL + service role key, and APP_SECRET
openssl rand -base64 32           # -> APP_SECRET (required; encrypts stored tokens)
npm run test                      # 86 unit tests, no database or network required
npm run dev                       # Turbopack; first compile is seconds, not minutes
```

If `npm run dev` feels pathologically slow — tens of seconds to compile a single
API route — check whether the project sits under `~/Desktop` or `~/Documents`
with iCloud's "Desktop & Documents Folders" sync switched on. Every read of
`node_modules` then goes through the sync layer. Move the checkout somewhere
unsynced, such as `~/dev/`.

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
│   │   ├── crypto.ts             # AES-256-GCM for tokens, HMAC for OAuth state
│   ├── auth.ts               # dashboard session + tenant-admin check
├── calendar/                 # provider interface (§7.6), `none`, Google
│   └── email/                # provider interface (§7.5) + console provider
├── app/
│   ├── page.tsx              # public homepage, doubles as OAuth homepage (§6.5)
│   ├── t/[slug]/             # prospect widget
│   ├── t/[slug]/client/      # existing-client widget
│   ├── manage/[token]/       # reschedule / cancel
│   └── api/...
├── components/
└── middleware.ts             # per-tenant frame-ancestors (§7.2)

supabase/migrations/          # 0001 tenancy … 0005 RLS, 0007 grants
tests/                        # Vitest — pure logic, no database
e2e/                          # Playwright — needs a seeded database
```

---

## The two decisions worth reviewing

### 0. Privileges and RLS are separate checks

Worth knowing before anything else, because getting it wrong takes the whole app
down with a message that points at the wrong thing.

`service_role` carries `BYPASSRLS`, so none of the policies in `0005` apply to
it. It does **not** bypass `GRANT`s. A role must pass both checks, and Supabase's
"Automatically expose new tables" setting is what normally supplies the grants
to the Data API roles — `service_role` included.

Turn that setting off (which you should, so `anon` is not granted access to
every new table by default) and the app dies with `permission denied for table
tenants` while the RLS model is entirely correct. `0007_service_role_grants.sql`
grants them explicitly instead, including default privileges for future tables.
Keeping them in a migration beside the policies is better than depending on a
dashboard toggle nobody can see the history of.

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

## Google Calendar

### The one thing that is not verified

Every §6 hazard is handled and has a test, but those tests run against a mocked
`fetch`. **No line of this has touched the live Google API.** The tests prove the
code does what the brief says to do; they cannot prove Google behaves as the
brief describes. Treat the first real connection as the actual test, and check
in this order:

1. Connect, then confirm a booking creates a real event with a working Meet
   link. `bookings.sync_status` should read `synced`.
2. Confirm the attendee received **no** email from Google (`sendUpdates=none`).
3. Reschedule, and confirm the Meet link still works — this is what `PATCH`
   rather than `PUT` protects.
4. Leave it a week without touching it, then check health. This is where §6.3
   bites: a refresh token issued while the OAuth app is in Testing mode dies
   after ~7 days regardless of use.

### Setting up the OAuth client

Scopes are `calendar.events` and `calendar.freebusy` — both **Sensitive**, which
requires verification but **not** the paid annual CASA assessment (§6.6). Do not
"simplify" this to the broad `calendar` scope: it buys nothing this app uses and
moves the whole grant into a higher scrutiny tier. Verify the tier in the Cloud
Console scope picker, which is authoritative — third-party write-ups on this are
frequently wrong.

The consent-screen homepage must be **this app's `/` route**, not a customer's
site (§6.5). Squarespace's default `robots.txt` blocks `GoogleOther`, so Google's
branding reviewer could not read the page at all and reported "homepage does not
explain the purpose of your app" — an error no amount of editing the copy could
fix, because the copy was never being read. `src/app/page.tsx` is written for
that reviewer: publicly reachable, no login, and explicit about what the app does
with calendar data.

**Start verification before you need it.** It takes days to weeks and blocks
launch. A multi-tenant app needs External + Production publishing, which makes
verification mandatory rather than optional (§9.5).

And the trap in §6.3 that costs a day if you hit it cold: **publishing to
Production does not extend an already-issued refresh token.** Every tenant
connected during Testing must disconnect and reconnect once to get a durable
grant. The `needs_reconnect` status exists to make that visible rather than
mysterious.

### What the integration does

| Concern | Handling |
|---|---|
| HTTP client | Native `fetch`. **Never add `googleapis`** — 114 MB, 120-second cold starts (§6.1). `tests/dependencies.test.ts` fails CI if anyone does. |
| Token refresh | Access token cached with its expiry and refreshed only when stale, with a 2-minute skew (§7.7). The reference implementation refreshed on every request; Google's quota is per OAuth client and shared across all tenants. |
| Dead grants | `invalid_grant` sets `needs_reconnect` and stops retrying. A 5xx is transient and does not (§6.3). |
| Meet links | Reads `conferenceData.entryPoints[]`, not just `hangoutLink`, and re-reads the event while the request is `pending` (§6.7). |
| Client email | `sendUpdates=none` everywhere. This app owns all client communication (§2.7). |
| Reschedule | `PATCH`, so the existing conference data survives. A `PUT` would break the client's video link. |
| Health check | Makes a real one-minute `freeBusy` call. The reference implementation reported "Connected" whenever an email string existed in the database (§6.8). |
| Unreadable calendar | `freeBusy` returns 200 with a per-calendar `errors` array; that throws rather than reading as "no busy times", which would offer every slot as free. |
| Token storage | Encrypted at rest with AES-256-GCM under `APP_SECRET`. `service_role` can read every row, so a plaintext column would make a database dump a set of live mailbox grants. |
| OAuth state | HMAC-signed and time-bounded, so nobody can hand an admin a start URL that attaches their grant to another tenant. |

### A correction to milestone 1

Milestone 1 resolved a broken connection to `NoCalendarProvider`. That was
wrong, and writing these tests surfaced it: it meant a tenant whose grant had
just died would silently go back to serving unchecked times — the exact failure
§6.8 describes. `providerForTenant` now distinguishes the two cases. No
connection row means the tenant deliberately books without a calendar. A row in
`needs_reconnect` means they believe theirs is connected, so the booking path
fails closed with a 503 and they are told to reconnect.

### Endpoints

| Route | Auth | Purpose |
|---|---|---|
| `POST /api/admin/[slug]/calendar` | Bearer, tenant admin | Returns the Google consent URL. Returns rather than redirects, because a top-level navigation cannot carry a bearer token. |
| `GET /api/admin/[slug]/calendar` | Bearer, tenant admin | Connection status with a **live** health check. |
| `DELETE /api/admin/[slug]/calendar` | Bearer, tenant admin | Revokes at Google and deletes the local grant. A revoke failure does not block the local delete. |
| `GET /api/auth/google/callback` | Signed `state` | Exchanges the code and stores the connection. |

`src/lib/auth.ts` arrived with these — the dashboard UI does not exist yet, but
these routes change what a whole tenant can book, so they are gated on
owner/admin membership rather than left open until the UI lands.

---

## Roadmap

**Milestone 2 — the rest of the integrations and the dashboard**
- ~~Google Calendar provider~~ — done, but unverified against the live API. See
  the checklist above.
- **Start OAuth verification now.** It is the only remaining item with a lead
  time you cannot compress (§9.5).
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
