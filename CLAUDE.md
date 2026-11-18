@AGENTS.md

# Design rules for khloe (from the owner; apply to every screen)

Dieter Rams's ten principles. **Less, but better.** When a change is in doubt, take something away.

1. **Innovative.** Use what the platform can now do, but never as an end in itself.
2. **Useful.** Every screen exists for a job. Remove anything that gets in its way.
3. **Aesthetic.** People use this daily. Only well-made things are beautiful.
4. **Understandable.** The structure explains itself. At best, no help text is needed.
5. **Unobtrusive.** A tool, not decoration: neutral and restrained.
6. **Honest.** Never claim more than the product does.
7. **Long-lasting.** Avoid fashion.
8. **Thorough to the last detail.** Nothing arbitrary. Alignment, wording and states all matter.
9. **Environmentally friendly.** Minimise visual pollution: fewer boxes, borders and colours.
10. **As little design as possible.** Concentrate on the essential.

How this applies in the admin:

- **Settings, not forms.** A group of settings reads as one line each (label, current value). The chosen one is edited beside the list (on a phone, in place under its line). Nothing else moves. Each setting saves on its own. See `src/components/admin/SettingsPanel.tsx`.
- **Steps sit side by side** when there are few of them: finished ones collapse to their answer, the current one is open, later ones wait.
- **Selected is shading only** (`--selected-mineral`): no accent edge or extra border.
- **Hierarchy follows the job.** The page's content comes first; status notes are quiet lines, never full-width banners above it.
- **Ask khloe is an assistant, not a step.** It lives in the corner of every page. Where creating something, it is offered as an equal alternative ("Set it up myself", "Describe it to khloe", "From my website"), never as a gate.
- **One way in for every service.** No separate setup wizard: a new account lands on Services with "Add your first service" open. Every new service starts not offered; "Offer it" on its page puts it on the booking page.
- **No detours (user's rule).** A service's page holds every step of setting up that service: details, payments (Stripe connects from there and comes back there), when it can be booked, questions with where each answer leads, the next-steps message, the emails, who can book. Messages and shared questions are edited in place with the same component as their own page, and say a change applies to every service. A flow never sends someone to another page to finish a step of the service; links out are for looking at records (a person, a booking) or for the business's own settings. There is no separate Questions page: /screening forwards to a service's Questions tab.
- **Opening hours are the business's (user's rule).** Set on Account (and the Week for one-off dates), never on a service page. A service only narrows them: "When" is "Whenever you're open" or some days and times inside them (event_types.bookable_hours, migration 0042); slots are the overlap.
- **Names (user's rule).** The places are Your services, Your calendar, Your customers, Your business (Settings, Share, Messages, Reports on a pill switch). A service's questions are "Your filters" in the admin; clients are only ever "asked questions", never "filtered".
- **A service is three steps that end (user's rule).** 1 About it, 2 Your filters, 3 Who can book. A new service walks them with "Next: your filters", "Done with filters", "Finish"; Finish puts it on the booking page and shows "<name> is ready" with its link. No "Offer it" and no "How people book it": finishing is offering, and the service's page is its one view. Saving a filter says what it now does. There is no "last box" on the booking form.
- **One editor for the usual week (user's rule).** Opening hours are set in Your business → Settings only; Your calendar holds exceptions (days off, one date's hours, notice, the connected calendar) and links to the hours.
- **Nothing that repeats the navigation (user's rule).** No button or link that only goes to a place the top bar or a sibling tab already reaches (Reports has no "Share your booking page"; Settings has no "Share it"). A page's title is its name in the navigation. Old names (People, Week, Account, Services, Questions, Overview) never appear in copy. Support is support@khloe.io, said as the address, never "just ask".
- **Your services is cards only.** One card per service (paused ones marked Paused), Add last; a card opens its page. No second view of a service on this page.
- **Share is one choice, then three ways.** "What do you want to share?" (all your services, or one), then Link, QR code, On your website (three steps) for that choice.
- **Collections are cards side by side** (services), with "Add" as the last card where the next one will appear.
- **One Ochre key per view**, and only for something that needs the person (`btn-secondary is-need`). Everything else is plain.
- **Exclusive views use the pill switch** (`.wk-mode` with `.filter-chip[aria-pressed]`).
- **Intuitive is a rule.** If a tester cannot find something, the page is wrong, not the tester.

# Privacy rule for the owner console (from the owner; mandatory)

The console never shows anything from inside a business: not its services, hours, questions, messages, clients or bookings, not even as a count for one business. Per business it shows only account and billing facts (name, web address, plan, billing state, trial and sign-up dates, team logins). Activity appears only as totals over every business, summed on the server (`loadPlatformTotals` in `src/lib/db/console.ts`); nothing per business leaves the server. Billing history (`billing_events`, migration 0040) holds account states only.
