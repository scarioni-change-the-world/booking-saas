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
   Week (Google now returns there); the embed code sits under Flow → Your
   page; notification and reply-to addresses head Messages. Account keeps
   the business's name, time zone (with a preview of what changing it
   does), currency (relabelled, not converted — it says so), signing in,
   the team (read-only) and the plan, with a map of where the rest went.
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
