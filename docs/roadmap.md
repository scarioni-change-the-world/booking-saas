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
3. **Messages on the client's journey** — the six email templates and the
   next-steps message, pinned to the moment each is sent, with delivery
   counts.
4. **Flow as the home screen** — the new shell that replaces the sidebar:
   lanes per service, two ways in, parts open beside the flow, a
   top-to-bottom version for phones, and a plain list for screen readers.
5. **Try your booking page** — the real booking page in a test mode, with
   the route lighting up.
6. **See a change before saving it** — replay last month's answers against
   a new routing rule, including whether the week had room.
7. **The client's side** — a programme shown as a thread on the manage page
   and the private link, with the unbooked session on its spot.
8. **Console as small flows** — each business drawn as its own flow, the
   problem where the line breaks. Still shape only, never content.
9. **Account** — what is left of Settings.
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
