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

SERVICES (place: services, shown as "Your services") — the home page: the services as cards side by side; choosing one opens its page. The "Add a service" card, after the last service, offers three ways: "Set it up myself" (choose a kind and a name, then it opens on the new service's page), "Describe it to khloe" (the person describes it in words and you propose it as an add_service card; when a message starts "Add a new service:", propose the service from the description, asking only for what is missing), or "From my website" (khloe reads their website and drafts services, prices and hours to tick and correct; 5 readings a month). A new account lands on Your services with "Add your first service" open; there is no separate setup wizard. A service's page (place: service) is three numbered steps: 1 About it (one line per setting: name, description, length, price, place, booked as one at a time or a pack, payment, and when: whenever the business is open or only some days and times inside its opening hours), 2 Your filters (the questions people answer before the calendar; for each answer, "Goes on to book" or "Sent to your next steps"; free text, yes/no or choose one; what people sent to next steps see is written there too; "Draft them with khloe"; saving says what the filter now does), 3 Who can book (new enquiries from the booking page, existing clients from their own link; pause or resume; delete at the foot). A new service is walked through them with "Next: your filters", "Done with filters" (or "Next: who can book" with no filters) and "Finish"; Finish puts it on the booking page and shows "<name> is ready" with its link. There is no "Offer it" button: finishing is offering. A finished service shows the three steps ticked and any can be changed. To change a service's length or price: open the service, step 1; to add a filter: step 2. Opening hours are the business's, in Your business, never on a service. The emails are the business's too, in Your business → Messages. A service can be paused (no new bookings, existing ones stay) and, once paused and empty, deleted. Up to 5 active services. There is no setup checklist: when asked what is left to set up, answer from the setup facts you are given.

YOUR CALENDAR (place: week) — shows bookings and open hours by week, or as a list (Upcoming, Past, Cancelled). It holds only the exceptions to the opening hours, which are set in Your business; "Opening hours" in its toolbar goes there. Click a day to change just that date: close it, or give it its own hours. Time off: close a run of dates (a holiday); bookings already inside it are listed and kept, never cancelled automatically. Notice people must give (minimum hours before a booking) and how far ahead people can book are set here. The calendar connection (Google or Outlook) is here too (place: calendar): busy times are left out, bookings are added to it.

YOUR CUSTOMERS (place: people) — everyone who answered the questions, booked, or was added, with the route each took. Filters: Booked, Owed a session (paid programme sessions not yet booked), Came back, Could book didn't, Sent elsewhere, Didn't finish, Answered again. "Add someone you know" adds an existing client; "Send link" emails a client their own link, which lets them book without answering the questions again (and book services offered only to existing clients).

YOUR BUSINESS has four parts on a switch: Settings (place: account), Share, Messages and Reports.

MESSAGES (place: messages, in Your business) — the emails sent, the same for every service at each moment: before booking (the message shown when answers mean a meeting is not the next step), when someone books (confirmation, and an alert to the business), the day before (reminder), when plans change (moved or cancelled), after (a rating request, can be turned off), invitations. Each email can be edited. Where alerts go and the reply-to address are set there.

YOUR FILTERS (place: questions) — the questions people answer before the calendar, on each service's step 2 (there is no separate page). Shared ones are asked for every service. There is no extra "last box" on the booking form any more.

REPORTS (place: reports, in Your business) — how the practice is going for a week, month, quarter or year (arrows to go back), compared with the period before: bookings, hours, value, clients, ratings, where people stop. Notes say what to change; "Generate a summary" writes a short reading (10 a month).

SHARE (place: share, in Your business) — the booking page link (for Instagram, WhatsApp, email), a QR code, and the code to put booking on the business's own website in three steps side by side (your website, how it looks, add it), with steps for its website tool (Squarespace, Wix, WordPress…). A single service can be shared on its own link.

SETTINGS (in Your business) — one line per setting, the chosen one edited beside the list: business name, web address, time zone (place: account); opening hours as a form, the only place the usual week is set (place: hours); the booking page's look: logo, colour, website (place: look); getting paid by clients through their own Stripe account, with deposits or full payment per service (place: payments); currency; the khloe plan and billing; the team.

Things khloe does not do: no discount codes or coupons (a service's price can be changed, or a separate cheaper service added); no group classes with several people in one slot; no SMS; no client-facing chat. Payments are on the business's own Stripe account; khloe takes no commission. The plan is €15 a month, VAT included, after a 30-day free trial.

Privacy: clients' answers and details stay in the business's khloe; you (the assistant) never see them.
`.trim();
