# Product vision — the core instruction for this project

Status: **the main instruction for the whole project, from the date below
onward.** Every future feature decision should be checked against this
document first. Where it conflicts with older, narrower framing elsewhere in
the codebase or its comments, this document wins.

Adopted: 2026-08-27. Written by the product owner, pasted directly into the
project with the instruction to use it as the main instruction for the whole
project from that moment on — reproduced here verbatim, not summarized, so
nothing is lost or softened in translation.

This sits alongside (not in place of) the brand strategy and web guidelines
that `marketing/README.md` and `src/app/globals.css` already implement —
that document governs how Intro *looks and sounds*; this one governs what it
*is* and *does*. They already agree with each other almost everywhere
(the Understanding → Alignment → Meeting framework, the refusal to expose
qualify/reject language, "not every enquiry needs a meeting" appearing in
both) — see the engineering note at the bottom of this file for the one
place they don't yet agree: today's schema still models a single binary
outcome, where this document calls for several.

---

## Intro — what the product actually is

Intro is a pre-meeting alignment platform for businesses whose work begins
with an important conversation.

It allows a business to gather meaningful context from a prospective
customer before showing availability, evaluate whether the conversation
makes sense for both sides, and then determine the appropriate next step.

That next step may be:

- a meeting,
- a different service,
- a resource,
- a referral,
- a request for more information,
- or simply a better moment to reconnect later.

The calendar is therefore not the starting point of the journey. It is one
possible outcome.

The product logic is:

**Understanding → Alignment → Meeting**

And the clearest expression of the value proposition remains:

**The right meeting starts with alignment.**

## 1. The problem Intro solves

Most booking systems begin with a very narrow question: *when are you
available?* But for businesses selling expertise, that is often not the most
important question.

A consultant, therapist, architect, recruiter, advisor, coach, agency or
specialist service provider may first need to understand: what the person
needs, what they are trying to change, whether the problem is one the
business can actually solve, whether timing is appropriate, whether
expectations are realistic, whether budget is compatible, whether the
customer is ready, whether another service would be more useful, and
whether a meeting is actually the right next step.

Without that context, the meeting becomes the place where all of this is
discovered. That creates avoidable costs for both sides.

For the business: unnecessary calls, repeated introductory conversations,
unpaid discovery work, time spent with enquiries that could have been
redirected earlier, frustration around saying no, unclear expectations
before meetings.

For the prospective customer: investing time in a call that was never
likely to be useful, having to explain everything from scratch, being told
during the call that the service is inappropriate, feeling rejected, being
left without a useful alternative.

Intro moves that understanding before the meeting.

## 2. What Intro does

At its core, Intro creates a controlled intake journey before availability.

A simplified flow is:

```
Enquiry arrives
  ↓
Questions
  ↓
Context
  ↓
Alignment logic
  ↓
Appropriate next step
  ↓
Meeting, when appropriate
```

The business controls what questions matter and what different answers
should mean. For example, a business might ask: What are you hoping to
achieve? When would you ideally like to start? What budget have you
allocated? Have you tried something similar before? What would make this
conversation useful?

The answers are then used to determine how the journey continues.

## 3. What Intro does not do

This part is strategically important. Intro should resist becoming a
generic all-purpose scheduling platform. It is not primarily: a calendar
application, an availability-sharing tool, a meeting link generator, a
productivity platform, a CRM, a lead-generation platform, a sales funnel
builder, a marketplace, a customer matching platform, a project management
tool, an automated sales closer.

It may eventually connect to several of those categories, but they should
remain supporting infrastructure. The product should not drift toward
*"Everything you need to manage your appointments."* That would destroy the
differentiation.

Instead: **Intro exists to improve the decision that happens before an
appointment is offered.**

## 4. What it deliberately does not optimise for

Most scheduling software implicitly optimises for more bookings with less
friction. Intro should not.

Intro should optimise for **better reasons to meet**. That means reducing
bookings can occasionally represent product success. If ten enquiries would
traditionally produce ten introductory calls, but Intro determines that
five clearly justify a conversation, two need more information, one should
use another service, and two would benefit from an alternative resource,
then Intro has done its job.

The KPI is not simply *number of bookings*. The stronger metrics are things
like: percentage of meetings considered useful, fewer unnecessary
introductory calls, better-prepared customers, reduced no-fit conversations,
higher meeting-to-engagement progression, time saved before engagement,
percentage of enquiries receiving an appropriate next step.

That inversion is fundamental.

## 5. The emotional problem Intro solves

There is also a second problem, which is probably more important to the
brand than the technology.

Professionals often dislike rejecting people. Particularly in
expertise-based businesses, saying *"I don't think we're the right fit"*
can feel uncomfortable. Businesses therefore often delay the decision until
a meeting. The professional loses time. The customer has an awkward
experience.

Intro allows the decision to happen through a considered, useful process
instead. The important principle is:

**Not every enquiry needs a meeting. Every enquiry deserves a useful next
step.**

This is why Intro must never feel like a gatekeeper. The system is
discerning, but not exclusionary.

## 6. The central relationship

The product should not be framed entirely around protecting the business.
That would make the proposition feel selfish: *protect your valuable time
from bad prospects.* That is not Intro.

The stronger framing is bilateral. Intro helps both sides understand
whether the conversation is worth having.

The professional gains: context, better use of time, clearer expectations,
fewer unnecessary meetings.

The prospective customer gains: clarity, a more relevant next step, less
wasted time, less awkward rejection, more confidence about why the meeting
is happening.

That is where the word *alignment* becomes valuable.

## 7. Understanding, Alignment, Meeting

This is not just brand language. It can become the product architecture.

**Understanding.** The system gathers relevant information — goals, needs,
timing, expectations, budget, readiness, constraints, preferences, previous
experience, project context. The goal is not maximum data collection. It is
enough context to make the next decision intelligently.

**Alignment.** The business determines whether what the customer needs and
what the business can provide are sufficiently aligned. This could
eventually involve explicit business rules, weighted criteria, conditional
logic, AI-assisted evaluation, human review, combinations of these.

Alignment should not be represented as a moral score. Avoid *"42%
qualified."* Prefer *"Good next step" / "Needs review" / "Another path may
be more useful."*

**Meeting.** Only once a conversation makes sense does availability become
relevant. Then scheduling should be extremely simple. At that point Intro
can behave similarly to conventional scheduling software. But importantly:
scheduling is downstream of understanding.

## 8. The main differentiator from Calendly

The simplest distinction is: Calendly begins with availability. Intro
begins with understanding.

Calendly's fundamental job is: find a mutually available time and make
scheduling easy. Intro's fundamental job is: decide whether there should be
a meeting before asking when it should happen. That is a very different
product thesis.

| | Calendly-style product | Intro |
|---|---|---|
| Starting point | Availability | Context |
| Primary question | When can we meet? | Should we meet, and why? |
| Goal | Reduce scheduling friction | Improve meeting relevance |
| Booking | Desired outcome | One possible outcome |
| Prospect assessment | Secondary | Core |
| Alternative paths | Peripheral | Core |
| Business logic | Calendar rules | Alignment rules |
| Success | Meeting booked | Appropriate next step |
| Emotional concern | Convenience | Mutual clarity |
| Product metaphor | Calendar | Introduction / intake |

Calendly helps coordinate a meeting that has already been implicitly
accepted. Intro operates one decision earlier. That is the category
distinction to defend.

## 9. Why Intro should not become "Calendly + questionnaire"

This is probably the biggest strategic product risk. Technically, someone
could describe Intro as *"Calendly with questions before the calendar."*
That would undersell the product badly, because the questionnaire is not
the differentiator. The differentiator is the decision layer between
enquiry and scheduling.

The valuable sequence is not: Form → Calendar. It is: **Context →
Interpretation → Appropriate outcome.**

The questionnaire is merely the input mechanism. The real product is the
alignment engine. That is where future development should focus.

## 10. Core features already implied by the concept

These are the capabilities that belong in the core product:

- **Custom intake questions.** Multiple choice, single choice, free text,
  numerical input, budget range, dates/timing, yes/no, multi-select.
  Questions should support conditional visibility.
- **Pre-calendar intake.** The intake happens before availability is shown.
  This is non-negotiable — showing the calendar first would undermine the
  entire proposition.
- **Alignment criteria.** The professional defines how particular responses
  affect the journey (e.g. "Budget under €X → alternative path", "Project
  start beyond six months → nurture path", "Strong alignment across
  criteria → show calendar").
- **Conditional outcomes.** Different customers can receive different next
  steps — meeting available, needs manual review, alternative service,
  resource, referral, come back later. This is more important than raw
  scoring.
- **Respectful alternative messages.** Professionals should be able to
  write humane outcome messages, e.g. *"Based on what you've shared, a
  meeting probably isn't the most useful next step yet. This resource may
  help you get further before we speak."* Central to Intro's philosophy.
- **Calendar integration.** Once a meeting is appropriate, the business's
  connected calendar controls availability — necessary, but strategically
  secondary.
- **Branded client-facing experience.** The prospective client should
  primarily see the professional's identity, not Intro's — logo, colours,
  business name, custom messaging. Intro should deliberately recede.
- **Mobile-first client experience.** Essential because many enquiries
  originate from Instagram, WhatsApp, mobile websites, social links,
  referrals. Questions should be short, readable, easy one-handed,
  low-friction.

## 11–38. Features that would reinforce and extend the core proposition

Recorded here as the standing idea backlog, not a commitment or a sequenced
roadmap — see the feature hierarchy in section 40 for how these are
layered.

- **Alignment Builder** — a dedicated space to define "what makes a useful
  conversation" as strong indicators, things requiring review, and
  alternative-path indicators, making alignment a first-class product
  object rather than generic automation rules.
- **AI-assisted intake design** — a professional describes in plain
  language how they decide who's ready to work with them; Intro proposes
  intake questions, answer options, alignment criteria, and alternative
  paths from that description.
- **AI-assisted alignment review** — for ambiguous enquiries, AI summarises
  the enquiry (need, timing, budget, potential concern, suggested next
  step) rather than auto-deciding. The professional stays in control; avoid
  ever framing this as "AI decides whether prospects are qualified."
- **Conversation Brief** — when someone books, Intro generates a concise
  pre-meeting brief for the professional (what they want, why now, their
  main concern, budget, what they want from the meeting), making "the
  meeting starts before it's booked" a real feature, not just a line.
- **Customer-side meeting brief** — mirrors the above for the customer:
  what they told the business, meeting purpose, expected duration, what to
  prepare, what happens next.
- **Alignment Preview** — let a professional test hypothetical customers
  against their intake logic before publishing it, to see the resulting
  path.
- **Outcome Paths** — a true next-step architecture instead of a simple
  accept/reject binary: e.g. Path A "ready → meeting", Path B "almost ready
  → resource + reconnect in 30 days", Path C "wrong service → recommend
  another service", Path D "complex enquiry → manual review", Path E "not
  suitable → referral". Flagged as one of the strongest potential
  differentiators.
- **"Reconnect later"** — let the business offer to check back with an
  enquiry in the future rather than turning "not now" into "never";
  Intro can reopen the conversation automatically at that point.
- **Referral paths** — a business maintains a list of trusted peers to
  recommend when they're not the right fit, turning rejection into
  service. Avoid turning this into a public marketplace.
- **Resource paths** — a small library of alternative resources (guide,
  article, video, workshop, lower-cost product, diagnostic tool,
  newsletter, FAQ, prep checklist) that Intro can route people to.
- **Manual review queue** — a Review area for enquiries that shouldn't be
  automatically resolved: alignment summary, answers, flagged criteria,
  suggested next step, approve meeting / choose alternative. Preserves
  human judgement.
- **Alignment analytics** — reveal where enquiries diverge (e.g. "42%
  aligned, 23% budget misalignment, 18% too early, 11% unsupported service,
  6% need review") — far more useful than a raw booking count, because it
  reveals why demand and offering do or don't align.
- **Question intelligence** — identify intake questions that aren't
  contributing to decisions or that are causing abandonment, and suggest
  removing or rewriting them.
- **Outcome quality feedback** — after a meeting, ask the professional one
  lightweight question: "Was this meeting worth having? Yes / Partly / No."
  Over time, correlate intake patterns with valuable conversations.
  Potentially one of the most defensible features in the product, since it
  lets the alignment model improve from actual meeting quality, not just
  form responses.
- **Post-meeting alignment learning** — extend the above: did they become a
  client, was the original need accurate, was the budget realistic. Use
  this to help refine criteria over time (e.g. "people choosing 'exploring
  options' still become clients 48% of the time — consider reducing the
  negative weight of this answer"). Moves Intro from static forms toward a
  genuine alignment intelligence product.
- **Alignment templates by business type** — starter criteria sets for
  consultants, recruiters, architects, agencies, coaches, etc., remaining
  fully editable. Useful for onboarding.
- **Service routing** — when a business offers several services, the
  intake determines which one a customer should be routed to.
- **Team routing** — for small agencies/practices, route enquiries to
  different professionals by expertise, geography, language, service,
  client type, or complexity — always understanding first, calendar
  second. Lets Intro grow beyond solo professionals without losing the
  thesis.
- **Meeting-purpose definition** — establish what a meeting is actually
  for (discovery, proposal discussion, technical consultation, follow-up)
  before showing the calendar; different purposes can carry different
  durations, prep, and availability.
- **Pre-meeting preparation** — after booking, ask for whatever is needed
  for a useful conversation (documents, a completed brief, one last
  question, existing materials, inviting a decision-maker).
- **Meeting readiness state** — instead of a flat "Confirmed", show
  something like "Meeting ready" vs. "Waiting for information", with a
  small checklist (contract uploaded, decision-maker attending, brief
  completed). Extends alignment all the way to the meeting itself.
- **Customer expectations** — ask "What would a useful outcome from this
  conversation look like?" before booking, and show that expectation to
  both sides.
- **Business expectation setting** — let the business set the frame too
  (e.g. "This conversation is designed to determine whether we should work
  together. It is not a full consulting session.").
- **Privacy-conscious intake** — configurable data retention, deletion
  policies, consent controls, sensitive-field warnings, EU/GDPR-friendly
  controls. Not a differentiator, but supports trust.
- **Multi-language journeys** — define an intake once, offer it in
  multiple languages (English, Spanish, French, German, etc.), potentially
  with assisted translation, keeping outcome tone natural.
- **Embedded website experience** — Intro should feel native to the
  professional's own website, not a click-away destination, consistent
  with the brand principle that Intro stays almost invisible to
  prospective customers.
- **WhatsApp / direct-message entry points** — a link that opens directly
  into the relevant intake, so an informal DM enquiry can become
  structured context with minimal friction.
- **CRM integrations** — push aligned information into HubSpot, Salesforce,
  Pipedrive, Notion, Airtable, etc. once alignment is established, but kept
  downstream, supporting the alignment workflow rather than becoming the
  product identity.

## 39. What to explicitly deprioritise

To protect the product thesis, delay: complex calendar optimisation, team
productivity dashboards, extensive video conferencing features, generic
task management, sales pipeline management, email marketing, invoicing,
project management, large CRM functionality, appointment marketplace
functionality. Those can easily pull Intro toward "business software
suite." That would weaken it.

## 40. The feature hierarchy

**Layer 1 — Must be excellent**
Intake questions · conditional questions · alignment rules · multiple
outcomes · alternative paths · calendar reveal · respectful outcome
messaging · branded mobile flow.

**Layer 2 — Makes Intro distinct**
Alignment Builder · Conversation Brief · manual review · service routing ·
reconnect later · referral/resource paths · alignment analytics.

**Layer 3 — Creates intelligence**
AI-assisted intake creation · AI summaries · post-meeting quality feedback
· alignment learning · question intelligence · outcome optimisation.

**Layer 4 — Expands the market**
Team routing · multi-service organisations · multilingual flows · CRM
integrations · enterprise controls.

## The simplest strategic definition

If explaining Intro to someone in three sentences:

> Intro helps businesses understand an enquiry before offering a meeting.
> It gathers context, evaluates alignment and guides each person toward the
> right next step — which may or may not be a calendar. Calendly makes
> scheduling easier. Intro helps determine whether the meeting should
> happen in the first place.

And the product principle to evaluate every future feature against:

> **Does this feature improve understanding, alignment, or the quality of
> the eventual conversation?** If the answer is no, it is probably
> peripheral to Intro.

---

## Engineering note: where today's schema falls short of this vision

Written by Claude, for whoever (human or otherwise) next works on this
codebase — not part of the product owner's original document above.

**Update (migration 0011):** the foundational change this note originally
called for — evolving the qualification engine from a binary qualify/
disqualify gate into a real Outcome Paths model — is now built, scoped
deliberately to exactly two path types for v1:

- A new `outcome_paths` table, tenant-scoped, `type` enum of `'meeting'` |
  `'other'`, one row per type per tenant, auto-seeded on tenant creation.
- `qualification_questions.options[]` elements now carry `outcomePathType`
  (`'meeting' | 'other'`) instead of a bare `qualifies` boolean — an answer
  references a real path object, not a flag.
- `qualification_responses.outcome_path_type` replaces the old strict
  `'qualified' | 'redirected'` enum — a response's outcome IS which path it
  landed on.
- The "other path"'s message and redirect moved off `tenant_settings` (which
  could only hold one, tenant-wide) onto the `other` path row itself.

This is genuinely two path types, not a relabelled boolean: the type is an
enum a future migration widens, and multiplicity (say, two different
resources) is a contained, later change to what a question option
references — not a rebuild. What section 17's fuller Path A/B/C/D/E
picture still needs, and this migration deliberately did not build yet:

- More path types — `'alternative_service'`, `'resource'`, `'referral'`,
  `'reconnect_later'`, etc. — and whatever type-specific fields each turns
  out to need (a referral's contact info, a resource's link or file).
- Multiple paths of the same type per tenant (the day someone wants two
  different resources on offer, `unique(tenant_id, type)` has to go).
- A manual review queue (section 21), a resource library (section 20), a
  referral list (section 19), and "reconnect later" scheduling (section 18)
  — the schema still has nowhere to put any of these; each needs its own
  path type plus its own supporting table.

Practically: Layer 1's "multiple outcomes" and "alternative paths" now have
a real, if intentionally narrow, foundation under them. Layer 2 (Alignment
Builder, manual review, referral/resource paths) can build on top of that
foundation incrementally — each new path type is additive — rather than
waiting on a second foundational rewrite.
