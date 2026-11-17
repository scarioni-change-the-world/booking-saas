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
- **Collections are cards side by side** (services), with "Add" as the last card where the next one will appear.
- **One Ochre key per view**, and only for something that needs the person (`btn-secondary is-need`). Everything else is plain.
- **Exclusive views use the pill switch** (`.wk-mode` with `.filter-chip[aria-pressed]`).
- **Intuitive is a rule.** If a tester cannot find something, the page is wrong, not the tester.

# Privacy rule for the owner console (from the owner; mandatory)

The console never shows anything from inside a business: not its services, hours, questions, messages, clients or bookings, not even as a count for one business. Per business it shows only account and billing facts (name, web address, plan, billing state, trial and sign-up dates, team logins). Activity appears only as totals over every business, summed on the server (`loadPlatformTotals` in `src/lib/db/console.ts`); nothing per business leaves the server. Billing history (`billing_events`, migration 0040) holds account states only.
