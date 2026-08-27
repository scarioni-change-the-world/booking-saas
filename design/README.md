# Design

The design canvas from the product's earlier "Cerca" working name: brand
system, tenant dashboard, and the customer's phone flow. Historical —
superseded by the "intro" brand strategy and web guidelines, which the live
app (globals.css, layout.tsx, and every admin/customer surface) now follows.
These artboards were not regenerated to match; they document how the
Cerca-era screens looked, not how the app looks today.

`*.dc.html` are the artboards and `canvas.json` lays them out. `cerca-design.html`
is the published bundle — **generated, not edited**. Change an artboard, then
re-seed with the `/design` skill's helper and republish to the same URL.

| Page | Artboards |
|---|---|
| System | Brand — mark, palette, type, voice |
| Dashboard | Overview, Screening, Bookings, Clients, Availability, Settings, Appearance |
| Customer · phone | The questions, Another path, Pick a time, Book a block, Booked |

## The rule the palette rests on (Cerca-era values — see the note above)

A colour either identifies the brand or carries meaning, never both. This
rule survived the rebrand unchanged; only the hex values did not — see
`src/app/globals.css` for what the app actually uses now.

- **Terracotta `#A65A3C`** — brand. Buttons, links, the mark. A tenant may
  replace it with anything.
- **Teal `#2C6A63`** — live: booked, confirmed, connected. Fixed for every
  tenant, so a client can always tell a taken slot from a free one whatever
  accent their professional chose.
- **Ochre `#8A6A22`** — needs attention. **Oxblood `#7E3028`** — broken, and
  never carried by colour alone.

The accent deliberately sits outside the green–amber–red band that meaning
already occupies. An earlier draft used a green brand beside a green
"positive"; users cannot tell whether green means the product or the status.

## Decisions worth not re-litigating

- **Every screening question on one page.** Not one at a time. Stepwise tested
  badly in the reference implementation — it felt like an interrogation, which
  is the one thing this product exists not to be. The phone screen keeps the
  single page and adds a fixed Continue bar with progress.
- **No animation in the dashboard.** It is opened daily; a reveal that charms
  once becomes friction. Motion is spent on the customer flow, seen once.
- **No "good fit rate" metric.** A high percentage can simply mean the questions
  are too soft, so optimising it would push a tenant to weaken the gate they are
  paying for.
- **Newsreader, not a high-contrast display serif; IBM Plex Sans, not Inter.**

## Open

Resolved: the product is now named **intro**, adopted from the brand
strategy and web guidelines document — see `src/app/globals.css` and
`src/app/layout.tsx`. *Cerca* is retired.
