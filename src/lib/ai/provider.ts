/**
 * AI-assisted intake design (PRODUCT_VISION.md's Layer-3 idea backlog,
 * "AI-assisted intake design"): "a professional describes in plain
 * language how they decide who's ready to work with them; Intro proposes
 * intake questions, answer options, alignment criteria, and alternative
 * paths from that description."
 *
 * Deliberately NOT "AI-assisted alignment review" — the vision doc lists
 * that as a separate, later idea and is explicit: "avoid ever framing this
 * as AI decides whether prospects are qualified." This module only drafts
 * setup-time artifacts a human reviews and explicitly accepts; it never
 * sees or scores a real prospect's answers, and nothing it returns is
 * saved until an admin approves it through the same routes manual
 * question entry already uses.
 */

import type { OutcomePathType, QuestionKind } from '../db/types';

export interface IntakeDraftQuestionOption {
  label: string;
  outcomePathType: OutcomePathType;
}

export interface IntakeDraftQuestion {
  prompt: string;
  kind: QuestionKind;
  required: boolean;
  /** Empty for 'text' — see qualification.ts, free text never routes. */
  options: IntakeDraftQuestionOption[];
}

export interface IntakeDraft {
  questions: IntakeDraftQuestion[];
  /** A drafted "other path" message — the respectful alternative
   * PRODUCT_VISION.md's own example models: "Based on what you've shared,
   * a meeting probably isn't the most useful next step yet...". Never
   * saved automatically; see the note on outcome_paths always keeping a
   * human-editable message. */
  otherPathMessage: string;
}

export interface IntakeDraftInput {
  /** The admin's own plain-language description of how they decide who's
   * ready to work with them — the entire input this feature exists to
   * take. */
  description: string;
  /** Optional context to make the draft more specific: which service this
   * is about. Prompt context only today — nothing in the current schema
   * scopes a question to one service — see the module-level note in
   * src/app/api/admin/[slug]/ai/intake-draft/route.ts for why this field
   * exists anyway. */
  serviceContext?: {
    name: string;
    description: string | null;
  };
}

/**
 * Reports: a written reading of one period, drafted on request. Given the
 * figures only — never a client's name or address — and asked for the few
 * things most worth changing, each pointing at the place in intro to do it.
 */
export type SummaryPlace = 'services' | 'week' | 'people' | 'questions' | 'messages' | 'account' | 'none';

export interface ReportSummaryPoint {
  title: string;
  detail: string;
  where: SummaryPlace;
}

export interface ReportSummary {
  headline: string;
  points: ReportSummaryPoint[];
}

export interface ReportSummaryInput {
  businessName: string;
  periodLabel: string;
  /** The period's figures, already anonymous — see summaryFacts in reports-summary.ts. */
  facts: unknown;
}

export interface AiProvider {
  readonly id: string;
  draftIntake(input: IntakeDraftInput): Promise<IntakeDraft>;
  summariseReport(input: ReportSummaryInput): Promise<ReportSummary>;
}

/**
 * Raised when no AI provider is configured or the provider call fails.
 *
 * Same reasoning as CalendarUnavailableError (src/lib/calendar/provider.ts):
 * a silently-empty draft would read as "the AI had no ideas" rather than
 * "AI assistance isn't set up" or "the request failed" — those are
 * different facts an admin needs told apart, not folded into the same
 * blank state.
 */
export class AiUnavailableError extends Error {
  constructor(
    message: string,
    readonly status: number = 503,
  ) {
    super(message);
    this.name = 'AiUnavailableError';
  }
}
