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
/** A structured-output task, not a conversation — the current general-
 * purpose model is the right size for it. Kept as a named constant so
 * moving to a newer model id is a one-line change, same spirit as this
 * codebase's other provider-config constants. */
const MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 2000;

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
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: `${contextLine}${input.description}` }],
          tools: [DRAFT_TOOL],
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
    };
    const toolUse = (data.content ?? []).find(
      (block) => block.type === 'tool_use' && block.name === DRAFT_TOOL.name,
    );
    if (!toolUse) {
      throw new AiUnavailableError('The AI assistant did not return a usable draft.', 502);
    }

    return sanitizeDraft(toolUse.input as RawDraft);
  }
}
