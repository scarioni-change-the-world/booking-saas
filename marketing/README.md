# Marketing site

A single, self-contained `index.html` for intro's marketing website, built
directly from the brand strategy and web guidelines document (§11's
recommended page architecture, §5–9's visual identity, §12's motion
principles, §13's guardrails, §14's implementation checklist). Open the file
directly in a browser — nothing to build or install.

## Why a local file instead of Lovable

The guidelines document was written with Lovable in mind, but this project
builds the app itself as real, hand-written, tested code — not through a
prompt-driven site builder — so the marketing site follows the same
approach: a real file in the repo, reviewed and verified the same way as
everything else here.

## What's real here and what's a stand-in

- **Colours** — exact hex values from the guide's colour system table,
  duplicated from `src/app/globals.css` (this file has no build step to
  import them from).
- **Type** — IBM Plex Sans is the real, specified body/UI face, loaded free
  from Google Fonts. The wordmark and headings use **Plus Jakarta Sans** as
  a stand-in for **Mangal Pro Bold**, exactly as the guide's own
  "Implementation note" allows: Mangal Pro Bold is a licensed webfont this
  project doesn't have and isn't on a public font service, and the guide is
  explicit that a temporary fallback is fine until a licensed one exists.
  When you have that webfont, self-host it and change one `@import`/`<link>`
  and the `--font-display` value — nothing else in the file needs to change.
- **Photography** — none. The guide calls for five image families (abstract
  forms, prepared moments, threshold spaces, approaching each other,
  meaningful conversations), four of which are real photography this file
  has no honest way to produce. Rather than fake stock photos — which the
  guide explicitly warns against anyway — the page leans entirely on the
  one family it *can* build authentically: the "resolving i" abstract
  graphic (a circle and bar that begin offset and settle onto a shared
  axis), used as the hero's central visual and echoed in the motion design.
  Swap in real photography against the "Website use by section" table in
  the guide (§9) when it exists; the abstract system was designed to still
  hold up on its own until then.
- **Copy** — pulled and adapted directly from the guide's own language
  (executive summary, positioning, the three-stage framework table, the
  human principle, relevant sectors), not invented.

## A bug worth knowing about, in case you build on this file

The scroll-reveal effect (`[data-reveal]`) is deliberately built so content
is visible by default and only ever hidden by a `.js-reveal` class that
JavaScript adds to `<html>` — and only after confirming
`IntersectionObserver` exists. The first version had it backwards (hidden
by default, revealed by JS), and a full-page screenshot capture — which
composites the document without genuinely scrolling it — proved the
failure mode immediately: everything below the hero rendered invisible.
Keep the guard if you extend this: content must never depend on JavaScript
successfully running in order to be seen at all.
