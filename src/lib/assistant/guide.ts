/**
 * What "Ask khloe" knows about khloe itself: the places in the admin and
 * how to do the common things there. Written from what the code does, so
 * the assistant answers from this rather than inventing features. Keep it
 * current when a screen changes: a wrong answer here is a wrong answer
 * given to every business.
 *
 * Places are named by the ids in PLACES (assistant.ts), which the reply
 * turns into buttons.
 */
export const KHLOE_GUIDE = `
khloe is online booking for independent professionals (coaches, therapists, photographers, consultants). Clients book on the business's booking page (khloe.io/<address>, or embedded on their website). The admin has these places:

SERVICES (place: services) — the home page: the list of services. "Add a service" adds one (the first one goes through the step-by-step setup). Choosing a service opens its own page (place: service) with four tabs: Details (name, description, length, price, place, programme of several sessions, deposit or full payment), Questions (what people answer before they book: add, reword, make optional or remove a question right there; written or yes/no answers; choices and answers that send people elsewhere are on the full Questions page; and "the last box on the booking form", the business's own closing question, which can be required), Messages (the emails, shared by all services, edited on Messages), and Who can book (new clients from the booking page and/or existing clients from their own link; pause; delete). So: to change a service's length or price, open the service, Details tab; to add a question, open the service, Questions tab. "How people book it" on a service's page shows its booking path as a diagram. A service can be paused (no new bookings, existing ones stay) and, once paused and empty, deleted. Up to 5 active services. The "Get ready to take bookings" checklist at the top of Services shows what is left. "Start step-by-step setup" (place: setup) walks through service, hours, look, sharing; it can read the business's website to draft services.

WEEK (place: week) — the calendar. Shows bookings and open hours by week, or as a list (Upcoming, Past, Cancelled). "Paint usual hours": click and drag to set the usual weekly hours. Click a day to change just that date: close it, or give it its own hours. Time off: close a run of dates (a holiday); bookings already inside it are listed and kept, never cancelled automatically. Notice people must give (minimum hours before a booking) and how far ahead people can book are set here. The calendar connection (Google or Outlook) is here too (place: calendar): busy times are left out, bookings are added to it.

PEOPLE (place: people) — everyone who answered the questions, booked, or was added, with the route each took. Filters: Booked, Owed a session (paid programme sessions not yet booked), Came back, Could book didn't, Sent elsewhere, Didn't finish, Answered again. "Add someone you know" adds an existing client; "Send link" emails a client their own link, which lets them book without answering the questions again (and book services offered only to existing clients).

MESSAGES (place: messages) — the emails sent at each moment: before booking (the message shown when answers mean a meeting is not the next step), when someone books (confirmation, and an alert to the business), the day before (reminder), when plans change (moved or cancelled), after (a rating request, can be turned off), invitations. Each email can be edited. Where alerts go and the reply-to address are set there.

QUESTIONS (place: questions) — the questions people answer before they see the calendar, shared by all services or for one service, and which answers send people elsewhere instead of booking. The AI can draft questions from a description.

REPORTS (place: reports) — how the practice is going for a week, month, quarter or year (arrows to go back), compared with the period before: bookings, hours, value, clients, ratings, where people stop. Notes say what to change; "Generate a summary" writes a short reading (10 a month).

SHARE (place: share) — the booking page link (for Instagram, WhatsApp, email), a QR code, and the code to put booking on the business's own website, with steps for its website tool (Squarespace, Wix, WordPress…). A single service can be shared on its own link.

ACCOUNT — business name, address, time zone (place: account); opening hours as a form (place: hours); the booking page's look: logo, colour, website (place: look); getting paid by clients through their own Stripe account, with deposits or full payment per service (place: payments); currency; the khloe plan and billing; the team.

Things khloe does not do: no discount codes or coupons (a service's price can be changed, or a separate cheaper service added); no group classes with several people in one slot; no SMS; no client-facing chat. Payments are on the business's own Stripe account; khloe takes no commission. The plan is €15 a month, VAT included, after a 30-day free trial.

Privacy: clients' answers and details stay in the business's khloe; you (the assistant) never see them.
`.trim();
