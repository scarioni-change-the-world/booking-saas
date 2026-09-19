import {
  AiUnavailableError,
  type AiProvider,
  type IntakeDraft,
  type IntakeDraftInput,
  type IntakeDraftQuestion,
} from './provider';
import type { OutcomePathType, QuestionKind } from '../db/types';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

/**
 * The questions this drafts are the product. Everything else here — the
 * calendar, the emails, the dashboard — exists in a dozen other booking
 * tools; the screening in front of the calendar is the reason this one is
 * worth using. So this is the one call in the codebase where the stronger
 * model earns its price, and it is judgment work rather than transcription:
 * deciding what is actually worth asking a stranger on a phone, in what
 * order, to learn whether a meeting helps them.
 *
 * Per draft that is roughly 6-10 cents against Sonnet's 2, bounded by the
 * 20-per-month ceiling in usage.ts — a couple of pounds a month per tenant
 * at the absolute cap, for the part of the product nothing else replaces.
 */
const MODEL = 'claude-opus-5';

/**
 * Covers the model's reasoning *and* the draft it returns — one budget for
 * both, not just the answer.
 *
 * This matters more than the number looks. Opus 5 thinks by default (unlike
 * the model this replaced, where omitting the thinking parameter meant no
 * thinking at all), and those tokens come out of the same allowance. The
 * 2000 that comfortably held a Sonnet draft would be spent reasoning before
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
 * Opus 5's safety classifiers can decline a request outright. That arrives
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
- Most options should route to "meeting" — reserve "other" for the answers that genuinely indicate a meeting isn't the right next step yet (budget, timing, scope mismatches the professional described).`;

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
}
