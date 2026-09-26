# Roadmap

The direction, agreed on 23 September: the app stops being eight screens and
becomes three places where the booking system itself is on screen — **Flow**,
**Week** and **People** — plus a small **Account** area. The mock-ups are at
https://claude.ai/artifact/3AmPcFXEsNzonKVrmgsWq8 (private to the owner).

Six rules every screen follows:

1. The system is always on screen — no opening things to find out what is happening.
2. A missing part looks missing — a gap is drawn, not described.
3. Edit the thing itself — hours are painted, routing is a switch on the answer.
4. Every change shows its effect before it is saved.
5. You can try your own booking page before it is live.
6. Things open in place, beside what you are looking at.

## Before the beta — yours, minutes each

- [ ] Turn on **Free access** for every beta business as you create it
      (Console → the business → Free access). New businesses otherwise get a
      7-day trial and are locked out a week in.
- [ ] Fill in the four placeholders in the privacy page
      (legal name, registered address, privacy contact email, country).
- [ ] Optional: run the three small carousel corrections in ChatGPT. The
      carousels are redrawn anyway at step 10.

## The redesign, in order

1. ~~**Week**~~ — done. Availability and Bookings in one picture; paint
   your usual hours; exceptions and blocks on the same grid; bookings open
   beside it. Ships inside the current sidebar.
2. ~~**People**~~ — done. Clients and the Enquiries list as one list, each
   person with the route they took. Settled the inconsistency: every
   booking makes a client record and a link, so "Add as client" is now
   "Give them their own link", shown only where a booking predates that or
   the record could not be made. Enquiries keeps its figures until Flow.
3. ~~**Messages on the client's journey**~~ — done. Every email and the
   next-steps message, pinned to the moment each is sent, edited in place
   with a live preview, with 30-day delivery counts from a new send log
   (migration 0027). Replaced Settings' email templates and the Next steps
   tab under Questions.
4. ~~**Flow as the home screen**~~ — done. A top bar with three places
   (Flow, Week, People) and Settings replaced the sidebar. Flow draws two
   ways in, a lane per service with its gaps as broken lines, and the
   30-day counts on the lines; every part opens beside it. Overview, the
   Services list and the Enquiries analysis folded into it; a list version
   serves phones and screen readers. Services, Questions and Messages stay
   as pages reached from their part of the flow.
5. ~~**Try your booking page**~~ — done. Flow now draws one flow per
   service, in the page's real order (service, its questions, calendar),
   chosen from a row of service cards. "Try your booking page" opens the
   real page beside it in a test run — admin-only, nothing stored, held or
   emailed — and the route lights up step by step.
6. ~~**See a change before saving it**~~ — done. Editing a question on
   Questions replays the last 30 days of new enquiries' answers against the
   unsaved rule: who would reach the calendar, who would be sent elsewhere,
   real bookings the rule would have turned away, bookings gained at last
   month's rate, and whether the month's open hours had room.
7. ~~**The client's side**~~ — done. The manage page draws a programme as
   a thread (done, next, booked) with each owed session as a dashed spot
   and "Book it" on it. A client's own link opens on "You and {business}":
   their history as one thread, owed sessions bookable where they sit,
   new things to book underneath. Fixed on the way: an email lookup that
   treated "_" as a wildcard could file one person's booking under
   another's client record.
8. ~~**Console as small flows**~~ — done. Every business is a card with
   its flow five parts long (page, questions, service, hours, booked),
   drawn from counts alone: the line is cut from the first part that stops
   bookings, a thin part is dashed, and one sentence says it. Worst first.
   The same small flow heads each business's own Console page.
9. ~~**Account**~~ — done. Settings is gone; each setting moved to where
   it takes effect. Notice, booking window and Google Calendar sit on the
   Week (Google now returns there); the embed code sits under Flow, in a
   service's first step; notification and reply-to addresses head Messages. Account keeps
   the business's name, time zone (with a preview of what changing it
   does), currency (relabelled, not converted — it says so), signing in,
   the team (read-only) and the plan, with a map of where the rest went.
   **Flow, redrawn** — done. The network of boxes and lines read like a
   lab chart: people and appointments on one line (a programme of three
   counts three times), dashed lines for things that do not happen, a red
   dot for a sentence, and Diagram, List and tiles repeating one another.
   Two rewrites later (a list of steps read as clutter; chips with the
   services mixed in read as a guessing game), Flow is two containers.
   "Your services" lists every service as a row with its numbers, its
   state and Show flow, and the button to add one. Choosing a row opens
   that service's flow in its own card below, like a drop-down: four
   numbered chips (your page, questions, choose a time, booked), each with
   one count of people and a few Ochre words when something needs doing.
   A step that stops the service is a sentence above the chips with the
   button that fixes it. A chip's text, fixes and Change open under the
   chips, only when chosen.
   **Pausing and deleting a service** — done (migration 0029). "Archive"
   is now Pause: no new appointments, allowed at any time; whoever already
   booked keeps their appointment and can still move or cancel it, and
   paid sessions can still be booked (that used to fail on a paused
   service). Paused services sit under Flow with Resume and Delete. Delete
   only works on a paused service with nothing still coming up and nothing
   still owed. It asks twice: first what it means, then the service's name
   typed back. It cancels and emails nobody, and emails whoever deleted it.
   The row stays, marked deleted, so past appointments keep their name and
   clients keep their history. The five-service allowance (active only) is
   now enforced on the server, on adding and on resuming.
   **The Braun system** — done. The admin app is built the way a Braun
   radio is, in intro's own colours and fonts: Soft White faceplates that
   sit on Warm Chalk by their shadow, no outlines; round-ended keys for
   buttons and filters, recessed strips for two-way choices; each service
   a knob (its letters in a ring of its colour, dashed while nobody can
   book it); states as small lights (teal on, Ochre needs doing, a ring
   when paused). Numbers read off instruments (components/admin/
   Instruments.tsx): large light figures, a dial for the share who
   finished the questions, a grille with one dot per person who chose a
   service, lit for those who booked, a needle for the week's booked
   hours against its open ones, a slide scale for notice. A service's flow
   now opens directly under its row, and its four steps are one ruled
   panel. The client's booking page is unchanged.
   **Two colours** — done. Only Ochre and Mineral highlight anything in
   the admin. Ochre: this needs you (a service nobody can book, a session
   owed, a failure, a step not written). Mineral: this is where you are
   (the place in the bar, the service opened, the step or booking chosen,
   today and now on the Week, the step a test run has reached). The rest
   is Ink, the greys and Chalk: the main action is an Ink key, "on" is an
   Ink light, and People's routes are told by shape. Services no longer
   carry a colour here — they are told by their two letters, always beside
   their name — so the colour picker left a service's settings (the column
   stays, unused). The darkest colour is a very dark granite (#353a38),
   not a black, and the main action is a Mineral outline with an empty
   fill — as is the filter you chose.
   **Marks, Messages, titles** — done. No two services share their two
   letters: the oldest keeps its usual mark and a newer one that would
   repeat it takes its next (CV check beside Career coaching is CV), the
   same on every screen. Messages — where the confirmation and reminder
   emails are written — is a fourth place in the bar; reached only through
   Flow, it could not be found. The small section name above each page
   title is gone: the bar already says where you are.
   **Design review (Design Integrity)** — done, then revised (see below).
   Ten fixes from a review against honesty, transparency, respect and
   essentiality: the bar says "Services", as the page does; one term,
   "could book", for the step-3 number; the
   lightest grey no longer carries text (it was 2.8:1); a chosen row, step
   or day has a thin Mineral edge, not just a 1.1:1 tint, and bookings a
   hairline; the notice scale is the real control, saved on choosing a
   stop, rather than a slider that could not slide; the Week's needle
   gauge, which repeated its own number, is the thin bar the replay uses;
   the main key is told apart by a heavier edge, and a person's panel
   offers one Send link, with Copy as a link; titles are 32px with one
   line of description; and on a phone the Week opens on its list.
   **Messages' two addresses default to the sign-up address** — done
   (migration 0030). New-booking alerts and clients' replies used to start
   off, silently, until someone visited Messages and typed their own
   address in — a business's first booking could go unnoticed. Every
   business now gets both set to the address it signed up with the moment
   it is created (`createTenant`); migration 0030 backfills one that
   already existed, from its earliest owner. The summary on Messages still
   only ever says what is genuinely saved — honest, even after this — but
   opening "Change" on a still-blank field now opens pre-filled with the
   address the caller is signed in as, a suggestion to keep, change or
   clear, not something claimed as already on.
   **What needs you, moved into each service** — done. The line under
   Services' title (added by the review above) read as a banner pasted
   from elsewhere — a lamp, an underline and bold on every item — and is
   gone. Everything it said already had, or now has, a home inside the
   thing it is about: a service nobody can book says so on its own row and
   in its own callout when opened (unchanged); a session still owed is a
   quiet word in that service's row (`.fc-row-owed`, Ochre text, no lamp,
   no underline) and named, once the service is opened, on its Booked
   step. `client_entitlements.event_type_id` is read now (it wasn't) so an
   owed session reaches the one service it belongs to (`Lane.owed`,
   `Lane.owedSessions`) rather than a person-level total with nowhere to
   live. The Week's matching top banner is gone the same way: who is still
   owed is named in the side panel's existing quiet sentence, not a
   dashed-border strip across the page.
   **Console and sign-in in the two colours** — done. Both sat outside
   `.admin-app`, so they still used the older palette: teal, amber and red
   status pills, a Mineral edge on every healthy business, an Ochre eyebrow
   on sign-in. Now they are inside it and use its keys, plates, fields and
   lamps. The Console uses the admin's bar and page. Every business is a
   plate, and its state is a lamp and a word (suspended is a ring, like a
   paused service). What stops its bookings is a few Ochre words and the
   Ochre part of its small flow, which is otherwise Granite. The sign-in
   screens keep their photograph. Their eyebrow is Graphite, their key is
   the Mineral outline, and the only Ochre left is a failed sign-in.
10. **Marketing site** — redraw the carousels to match the new app. The app
    and the site must show the same thing.

## Before strangers can sign up (after the beta)

11. **Self-serve signup and Stripe** — one project. Signup without billing
    means anyone can create a business for free forever.
12. **A consented support view** — only if a case turns up that cannot be
    solved from shape alone. Time-limited, revocable, logged.

## Waiting on you

- Domain and product name, for Google OAuth verification. The longest wait
  of anything here, mostly Google's side, so worth starting early.

## Still to see with real data

- The "Already worked with you" figure — needs someone to book twice with
  the same email, the second time through the public page.
- Programme reminders — each appointment should get its own the day before.
- The "Booked while N sessions were owed" mark — records only from
  migration 0026 onwards.
