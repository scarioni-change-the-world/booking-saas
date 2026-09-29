/**
 * Usage control for AI-assisted features — the gap named directly in
 * PRODUCT_VISION-adjacent planning: "nothing caps how many times a tenant
 * can hit 'Generate draft,' and nothing tracks how many they've used." Each
 * generation is a real, metered Anthropic API cost with no ceiling
 * otherwise. This is a flat technical safety limit, not yet tied to the
 * (unbuilt) billing tiers — see migration 0015's ai_usage_events for the
 * record this counts against.
 */

import { DateTime } from 'luxon';
import type { AiUsageKind } from '../db/types';
import type { TenantScope } from '../db';
import { AiUnavailableError } from './provider';
import { MONTHLY_LIMITS } from './limits';

const LIMIT_NOUN: Record<AiUsageKind, string> = {
  intake_draft: 'AI-assisted drafts',
  report_summary: 'report summaries',
};

/**
 * The start of the current UTC calendar month. This is a cost-control
 * boundary, not something a tenant sees on a calendar — unlike booking
 * windows, it has no reason to track the tenant's own timezone.
 */
function currentPeriodStart(): string {
  const iso = DateTime.utc().startOf('month').toISO();
  if (!iso) throw new Error('Unreachable: DateTime.utc() always produces a valid ISO string');
  return iso;
}

/**
 * Throws AiUnavailableError(429) if this tenant has already used its
 * monthly allowance for `kind` — checked before the provider is called, so
 * a tenant at their cap never triggers another billed request. The message
 * is returned to the client as-is (see handleError in src/lib/api.ts), so
 * it's written for an admin to read directly.
 *
 * Note: this is a check-then-insert with no locking, so two concurrent
 * requests can both pass the check and both record, letting a tenant land
 * one generation over the limit in the rare case they collide. Acceptable
 * for a cost-control safety net; this is not meant to be a hard ceiling.
 */
export async function assertUnderMonthlyLimit(scope: TenantScope, kind: AiUsageKind): Promise<void> {
  const limit = MONTHLY_LIMITS[kind];

  const { data, error } = await scope
    .select('ai_usage_events', 'id')
    .eq('kind', kind)
    .gte('created_at', currentPeriodStart());
  if (error) throw error;

  if ((data?.length ?? 0) >= limit) {
    throw new AiUnavailableError(
      kind === 'intake_draft'
        ? `You've used all ${limit} ${LIMIT_NOUN[kind]} included this month. ` +
            `This resets at the start of next month — you can still add questions by hand any time.`
        : `You've used all ${limit} ${LIMIT_NOUN[kind]} included this month. ` +
            `This resets at the start of next month — every figure in Reports is still here.`,
      429,
    );
  }
}

/**
 * Records one successful generation against the monthly allowance.
 *
 * Called only after the provider call succeeds — an unconfigured key, a
 * network failure, or a response with no usable questions isn't the
 * tenant's fault, so none of those should burn their quota.
 */
export async function recordUsage(scope: TenantScope, kind: AiUsageKind): Promise<void> {
  const { error } = await scope.insert('ai_usage_events', { kind });
  if (error) throw error;
}
