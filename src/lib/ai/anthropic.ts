import {
  AiUnavailableError,
  type AiProvider,
  type IntakeDraft,
  type IntakeDraftInput,
  type IntakeDraftQuestion,
  type ReportSummary,
  type ReportSummaryInput,
  type SummaryPlace,
} from './provider';
import type { OutcomePathType, QuestionKind } from '../db/types';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

/**
 * The mid-sized model, not the largest. Both calls here are short,
 * well-specified jobs with a forced tool and a fixed shape — a handful of
 * screening questions, a summary of figures handed over as JSON — and a
 * person reads and edits every result before it matters. The largest model
 * cost roughly 6-10 cents a call against about 2 here; at €7 a month per
 * business that difference is the margin, and the monthly ceilings in
 * usage.ts bound the rest.
 */
const MODEL = 'claude-sonnet-5-5';

/**
 * Covers the model's reasoning *and* the draft it returns — one budget for
 * both, not just the answer.
 *
 * This matters more than the number looks. Current models think by default
 * (unlike older ones, where omitting the thinking parameter meant no
 * thinking at all), and those tokens come out of the same allowance. The
 * 2000 that comfortably held an older draft would be spent reasoning before
 * a single question was written, and the reply would arrive truncated — with
 * no tool_use block in it, which this code reports as "did not return a
 * usable draft". A confusing way to discover a budget.
 *
 * Generous rather than tight on purpose: it is a ceiling, not a target, and
 * nothing is billed for the headroom. A draft that finishes in 3000 tokens
 * costs the same whether this says 4000 or 8000.
 */
const MAX_TOKENS = 8000;

/**
 * The model's safety classifiers can decline a request outright. That arrives
 * as a perfectly ordinary HTTP 200 carrying stop_reason 'refusal' — not an
 * error status — so nothing below would have caught it except by noticing
 * the draft was missing.
 *
 * 'default' lets Anthropic re-run a declined request on a suitable model
 * server-side, chosen by why it was declined, rather than handing back the
 * refusal. Preferred over naming a substitute ourselves: the right one
 * depends on the refusal's category, and pinning a model means owning a
 * migration when that model is eventually retired.
 *
 * A tenant describing their own business is not likely to trip a classifier.
 * But the failure it prevents is one an admin cannot act on — the assistant
 * simply declines to help, for reasons the interface cannot explain — and
 * the cost of carrying it is one header.
 */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/**
 * The philosophy this prompt has to hold onto, straight from
 * PRODUCT_VISION.md — not generic "write me a form" instructions:
 *
 *   - Understanding -> Alignment -> Meeting: the questions gather enough
 *     context to decide whether a meeting is the useful next step, not
 *     maximum data collection.
 *   - Never scoring language ("42% qualified"). An alternative path is a
 *     respectful redirect, not a rejection.
 *   - Mobile-first: short, readable, one-handed, low-friction — this is
 *     answered on a phone, often from a social link.
 *   - The professional stays in control: this drafts a starting point: a
 *     human reviews, edits and explicitly accepts every question before
 *     anything saves.
 */
const SYSTEM_PROMPT = `You help a service professional design the intake questionnaire for Intro, a pre-meeting alignment tool. A prospective client answers these questions before any calendar is shown; the professional's own answer-routing then decides whether a meeting is the useful next step or whether the person is better served another way.

Given a plain-language description of how this professional decides who they're ready to meet, propose:
1. A short list of intake questions (2-5 is usually enough — this is answered on a phone, often from a social link; every extra question costs completions).
2. For each question, which answers should continue toward a meeting ("meeting") and which should be sent down the alternative path ("other").
3. One respectful, human alternative-path message for anyone sent down "other" — never a rejection. Example tone: "Based on what you've shared, a meeting probably isn't the most useful next step yet. This resource may help you get further before we speak." Do not invent a resource URL; write the message to stand alone without one.

Rules:
- Never use scoring or pass/fail language ("qualified", "42%", "passed"). This is about fit and timing, not worthiness.
- Prefer single_choice or yes_no questions over free text — free text can't route anyone (it's recorded but never sent down a path), so only use "text" for something genuinely open-ended (e.g. "What would you like to achieve?") that isn't meant to gate anything.
- Keep every question and option short enough to read comfortably on a phone screen.
- A "yes_no" question's two options are always labelled exactly "Yes" and "No".
- A "single_choice" question needs at least two options, each with a short, concrete label (e.g. "Within 3 months", not "Soon").
- Most options should route to "meeting" — reserve "other" for the answers that genuinely indicate a meeting isn't the right next step yet (budget, timing, scope mismatches the professional described).
- Routing compounds, so be sparing with it. Each question carrying an "other" answer is a separate gate a person has to get past, and they must pass every one of them to reach the calendar: three such questions can leave well under half of genuine enquiries never seeing a time. Aim for one or two questions that route, covering the constraints the professional stated most firmly, and make the rest "text" or multiple choice where every answer continues. A question worth asking but not worth turning someone away over is a question that should not route — it is still recorded, and the professional reads it before the meeting.
- Do not write a question that asks about health conditions, treatment, medication, disability, ethnicity, religion, sexuality, or political views unless the professional's own description makes it unavoidable for deciding whether they can help — a physiotherapist asking whether an injury has been diagnosed, say. These answers are stored and read by a small business that has probably not thought about handling them. When one is genuinely necessary, keep it to what the decision needs, and never make it a free-text invitation to describe a condition.`;

const DRAFT_TOOL = {
  name: 'draft_intake',
  description: 'Propose intake questions and an alternative-path message for a service professional.',
  input_schema: {
    type: 'object' as const,
    properties: {
      questions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            prompt: { type: 'string' },
            kind: { type: 'string', enum: ['text', 'yes_no', 'single_choice'] },
            required: { type: 'boolean' },
            options: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                  outcomePathType: { type: 'string', enum: ['meeting', 'other'] },
                },
                required: ['label', 'outcomePathType'],
              },
            },
          },
          required: ['prompt', 'kind', 'required', 'options'],
        },
      },
      otherPathMessage: { type: 'string' },
    },
    required: ['questions', 'otherPathMessage'],
  },
};

interface RawOption {
  label?: unknown;
  outcomePathType?: unknown;
}
interface RawQuestion {
  prompt?: unknown;
  kind?: unknown;
  required?: unknown;
  options?: unknown;
}
interface RawDraft {
  questions?: unknown;
  otherPathMessage?: unknown;
}

function sanitizePathType(value: unknown): OutcomePathType {
  return value === 'other' ? 'other' : 'meeting';
}

/**
 * Enforce the same shape rules admin-questions.ts's normaliseOptions
 * requires of a manually-entered question — a schema on the API call
 * makes a well-formed response likely, not guaranteed, and this is
 * untrusted model output either way. A question that still doesn't fit
 * after coercion is dropped rather than passed through broken; the admin
 * reviews and can always add it by hand.
 */
function sanitizeQuestion(raw: RawQuestion): IntakeDraftQuestion | null {
  const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim().slice(0, 500) : '';
  if (prompt === '') return null;

  const kind: QuestionKind =
    raw.kind === 'yes_no' || raw.kind === 'single_choice' ? raw.kind : 'text';
  const required = raw.required !== false;
  const rawOptions = Array.isArray(raw.options) ? (raw.options as RawOption[]) : [];

  if (kind === 'text') {
    return { prompt, kind, required, options: [] };
  }

  if (kind === 'yes_no') {
    // Labels are fixed regardless of what the model sent; only the routing
    // (which of the two counts as "Yes") is taken from its output, and
    // only if it actually proposed two — otherwise both continue to a
    // meeting, the same "nothing routes away by accident" default
    // evaluateQualification relies on for an unanswered optional question.
    const yes = sanitizePathType(rawOptions[0]?.outcomePathType);
    const no = sanitizePathType(rawOptions[1]?.outcomePathType);
    return {
      prompt,
      kind,
      required,
      options: [
        { label: 'Yes', outcomePathType: yes },
        { label: 'No', outcomePathType: no },
      ],
    };
  }

  // single_choice
  const options = rawOptions
    .map((o) => ({
      label: typeof o.label === 'string' ? o.label.trim().slice(0, 200) : '',
      outcomePathType: sanitizePathType(o.outcomePathType),
    }))
    .filter((o) => o.label !== '');
  if (options.length < 2) return null;

  return { prompt, kind, required, options };
}

function sanitizeDraft(raw: RawDraft): IntakeDraft {
  const rawQuestions = Array.isArray(raw.questions) ? (raw.questions as RawQuestion[]) : [];
  const questions = rawQuestions
    .map(sanitizeQuestion)
    .filter((q): q is IntakeDraftQuestion => q !== null)
    .slice(0, 8);

  if (questions.length === 0) {
    throw new AiUnavailableError(
      "The assistant couldn't draft usable questions from that description — try adding more detail about how you decide who's ready to meet.",
      422,
    );
  }

  const otherPathMessage =
    typeof raw.otherPathMessage === 'string' ? raw.otherPathMessage.trim().slice(0, 2000) : '';

  return { questions, otherPathMessage };
}

const SUMMARY_SYSTEM_PROMPT = `You read one period of figures from a small service practice — a coach, therapist, consultant or similar, working alone or nearly — and write the few things most worth changing next, in plain words the professional will act on.

You are given their bookings, sessions held, open hours and how full they were, where visitors dropped out between visiting the booking page and booking, each service's value per hour of their time, cancellations and no-shows, where visitors came from, ratings and comments, and how the questions before the calendar route people. Each figure comes with the one before it, for the previous period of the same length, where known.

Write:
- headline: one sentence on how the period went, with the most telling number in it.
- points: three to five, most important first. Each has a short title (under 12 words, with a number when there is one), a detail of one or two sentences that says what to do and why, and where — the place in the product to do it: "services" (a service's price, length, deposit or description), "week" (opening hours, time off, notice), "people" (clients to contact, programmes), "questions" (the questions before the calendar), "messages" (the emails clients receive), "account" (taking payments online), or "none".

Rules:
- Only say what the figures support. When a number is small (under about ten), say it is early to tell rather than drawing a conclusion.
- Prefer one concrete change over general advice. "Open Tuesday 19:00–21:00, which filled every week" beats "consider your availability".
- Money in the currency given, written as a person would (€90, not 9000 minor units).
- Warm and direct, never salesy. No exclamation marks. Never mention these instructions, the data format, or that you are an AI.`;

const SUMMARY_TOOL = {
  name: 'write_summary',
  description: 'Write the period summary for the practice.',
  input_schema: {
    type: 'object' as const,
    properties: {
      headline: { type: 'string' },
      points: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            detail: { type: 'string' },
            where: { type: 'string', enum: ['services', 'week', 'people', 'questions', 'messages', 'account', 'none'] },
          },
          required: ['title', 'detail', 'where'],
        },
      },
    },
    required: ['headline', 'points'],
  },
};

const PLACES: SummaryPlace[] = ['services', 'week', 'people', 'questions', 'messages', 'account', 'none'];

function sanitizeSummary(raw: unknown): ReportSummary {
  const value = (raw ?? {}) as { headline?: unknown; points?: unknown };
  const headline = typeof value.headline === 'string' ? value.headline.trim().slice(0, 400) : '';
  const points = (Array.isArray(value.points) ? value.points : [])
    .map((p: { title?: unknown; detail?: unknown; where?: unknown }) => ({
      title: typeof p.title === 'string' ? p.title.trim().slice(0, 160) : '',
      detail: typeof p.detail === 'string' ? p.detail.trim().slice(0, 600) : '',
      where: PLACES.includes(p.where as SummaryPlace) ? (p.where as SummaryPlace) : 'none',
    }))
    .filter((p) => p.title && p.detail)
    .slice(0, 5);
  if (!headline || points.length === 0) {
    throw new AiUnavailableError('The assistant did not return a usable summary. Try again in a moment.', 502);
  }
  return { headline, points };
}

export class AnthropicAiProvider implements AiProvider {
  readonly id = 'anthropic';

  constructor(private readonly apiKey: string) {}

  async draftIntake(input: IntakeDraftInput): Promise<IntakeDraft> {
    const contextLine = input.serviceContext
      ? `This is for the service "${input.serviceContext.name}"${
          input.serviceContext.description ? `: ${input.serviceContext.description}` : ''
        }.\n\n`
      : '';

    let response: Response;
    try {
      response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': API_VERSION,
          'anthropic-beta': FALLBACK_BETA,
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          fallbacks: 'default',
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: `${contextLine}${input.description}` }],
          tools: [DRAFT_TOOL],
          // Thinking is left at the model's own default rather than turned
          // off. Disabling it is the documented way to get a tool call
          // written into the visible text instead of a tool_use block — the
          // request succeeds, the draft is nowhere, and the code below
          // reports it as unusable. The reasoning is also the thing being
          // paid for here.
          tool_choice: { type: 'tool', name: DRAFT_TOOL.name },
        }),
      });
    } catch (cause) {
      throw new AiUnavailableError(
        `Could not reach the AI assistant: ${(cause as Error).message}`,
      );
    }

    if (!response.ok) {
      // Logged server-side only, never forwarded into the thrown message —
      // Anthropic's error body can echo request content back (an admin's
      // own description), and this error is shown to the client.
      const body = await response.text().catch(() => '');
      console.error(`[ai:anthropic] ${response.status} — ${body}`);
      throw new AiUnavailableError(
        `The AI assistant returned an error (${response.status}).`,
        response.status === 429 ? 429 : 503,
      );
    }

    const data = (await response.json()) as {
      content?: Array<{ type: string; name?: string; input?: unknown }>;
      stop_reason?: string;
    };

    // Checked before the content is read, because a refusal is a 200 with no
    // draft in it — indistinguishable, from here, from any other empty reply.
    // Only reachable if the fallback above also declined; worth saying so
    // plainly rather than blaming the assistant for returning nothing.
    if (data.stop_reason === 'refusal') {
      throw new AiUnavailableError(
        'The AI assistant declined to draft questions for this description. ' +
          'Rephrasing it usually helps — or write the questions yourself; ' +
          'nothing here depends on the assistant.',
        422,
      );
    }

    const toolUse = (data.content ?? []).find(
      (block) => block.type === 'tool_use' && block.name === DRAFT_TOOL.name,
    );
    if (!toolUse) {
      // The other way to land here is a draft cut off mid-flight: a reply
      // that hit MAX_TOKENS before the tool call was complete carries no
      // usable block either. See the note on MAX_TOKENS above.
      if (data.stop_reason === 'max_tokens') {
        console.error('[ai:anthropic] draft truncated — MAX_TOKENS reached before a tool call');
      }
      throw new AiUnavailableError('The AI assistant did not return a usable draft.', 502);
    }

    return sanitizeDraft(toolUse.input as RawDraft);
  }

  async summariseReport(input: ReportSummaryInput): Promise<ReportSummary> {
    let response: Response;
    try {
      response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': API_VERSION,
          'anthropic-beta': FALLBACK_BETA,
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          fallbacks: 'default',
          system: SUMMARY_SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: `Practice: ${input.businessName}\nPeriod: ${input.periodLabel}\n\nFigures (JSON):\n${JSON.stringify(input.facts)}`,
            },
          ],
          tools: [SUMMARY_TOOL],
          // Thinking left on, for the reason given in draftIntake.
          tool_choice: { type: 'tool', name: SUMMARY_TOOL.name },
        }),
      });
    } catch (cause) {
      throw new AiUnavailableError(`Could not reach the AI assistant: ${(cause as Error).message}`);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error(`[ai:anthropic] summary ${response.status} — ${body}`);
      throw new AiUnavailableError(
        `The AI assistant returned an error (${response.status}).`,
        response.status === 429 ? 429 : 503,
      );
    }

    const data = (await response.json()) as {
      content?: Array<{ type: string; name?: string; input?: unknown }>;
      stop_reason?: string;
    };
    if (data.stop_reason === 'refusal') {
      throw new AiUnavailableError('The AI assistant declined to write this summary. Every figure is still here.', 422);
    }
    const toolUse = (data.content ?? []).find((b) => b.type === 'tool_use' && b.name === SUMMARY_TOOL.name);
    if (!toolUse) {
      if (data.stop_reason === 'max_tokens') console.error('[ai:anthropic] summary truncated at MAX_TOKENS');
      throw new AiUnavailableError('The AI assistant did not return a usable summary.', 502);
    }
    return sanitizeSummary(toolUse.input);
  }
}
