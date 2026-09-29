import type { AiUsageKind } from '../db/types';

/**
 * How many generations of each kind a tenant gets per calendar month.
 * Generous for how the feature is actually used — drafting a questionnaire
 * during setup, occasionally revisited — while bounding what a runaway
 * script, a stuck retry loop, or a shared-tenant mistake can cost in a
 * month. A new AI feature adds its own entry here rather than sharing this
 * one, so each can be tuned independently.
 *
 * Its own file, free of server code, so a screen can say the same number
 * the server enforces.
 */
export const MONTHLY_LIMITS: Record<AiUsageKind, number> = {
  intake_draft: 20,
  /* Written summaries in Reports. Kept per period (report_summaries), so
     reopening one costs nothing; this bounds how many new ones a month. */
  report_summary: 10,
};
