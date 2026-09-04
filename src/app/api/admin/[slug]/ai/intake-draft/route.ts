import { handleError, ok, optionalString, readJson, requireString } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { aiProvider } from '@/lib/ai';
import { assertUnderMonthlyLimit, recordUsage } from '@/lib/ai/usage';
import type { EventTypeRow } from '@/lib/db/types';

/**
 * Draft intake questions and an alternative-path message from a plain-
 * language description — PRODUCT_VISION.md's "AI-assisted intake design".
 * Returns a draft only; nothing is written here. Accepting a drafted
 * question still goes through the ordinary POST /questions route, so
 * there is exactly one path a question actually gets saved through,
 * whether it was typed by hand or accepted from a draft.
 *
 * `eventTypeId` is optional prompt context, not a storage scope — today's
 * intake is one shared questionnaire per tenant (see the note on Intake's
 * step-tab layout), not yet per-service. Accepting it here now, before
 * storage catches up, means this route's shape doesn't need to change the
 * day it does — only what happens with the id internally will.
 *
 * Capped per tenant per calendar month (src/lib/ai/usage.ts) — checked
 * before the provider call so a tenant at their cap never triggers another
 * billed request, recorded only after the provider call succeeds so a
 * failure on our end doesn't spend the tenant's quota.
 */
export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { scope } = await requireTenantAdmin(request, slug);
    await assertUnderMonthlyLimit(scope, 'intake_draft');

    const body = await readJson(request);

    const description = requireString(body, 'description', { maxLength: 4000 });
    const eventTypeId = optionalString(body, 'eventTypeId', { maxLength: 100 });

    let serviceContext: { name: string; description: string | null } | undefined;
    if (eventTypeId) {
      const { data, error } = await scope
        .select('event_types', 'name, description')
        .eq('id', eventTypeId)
        .maybeSingle();
      if (error) throw error;
      const row = data as unknown as Pick<EventTypeRow, 'name' | 'description'> | null;
      if (row) serviceContext = { name: row.name, description: row.description };
    }

    const draft = await aiProvider().draftIntake({ description, serviceContext });
    await recordUsage(scope, 'intake_draft');
    return ok({ draft });
  } catch (error) {
    return handleError(error);
  }
}
