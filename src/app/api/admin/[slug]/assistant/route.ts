import { DateTime } from 'luxon';
import { MONTHLY_LIMITS } from '@/lib/ai/limits';
import { fail, handleError, ok, readJson } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { aiProvider } from '@/lib/ai';
import { assertUnderMonthlyLimit, recordUsage } from '@/lib/ai/usage';
import { MAX_HISTORY, MAX_MESSAGE, sanitizeAssistantReply, type ChatTurn } from '@/lib/assistant/assistant';
import { loadAssistantFacts } from '@/lib/assistant/facts';

/**
 * "Ask khloe": one answer to one message, with the conversation so far.
 *
 * POST { message, history: [{ role, text }] }. Reads the business's setup
 * (never its clients), asks the model, and returns its reply checked
 * against what the business has: a few sentences, buttons to places, and
 * proposed changes that the panel shows as cards to confirm. Saves nothing
 * itself. Counts against the monthly allowance only once answered.
 */
export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { tenant, scope } = await requireTenantAdmin(request, slug);
    const body = await readJson(request);

    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) return fail('Write a question first.', 400);
    if (message.length > MAX_MESSAGE) return fail(`Keep it under ${MAX_MESSAGE} characters.`, 400);

    const history: ChatTurn[] = (Array.isArray(body.history) ? body.history : [])
      .filter(
        (t: unknown): t is ChatTurn =>
          !!t &&
          typeof t === 'object' &&
          ((t as ChatTurn).role === 'user' || (t as ChatTurn).role === 'assistant') &&
          typeof (t as ChatTurn).text === 'string',
      )
      .slice(-MAX_HISTORY)
      .map((t: ChatTurn) => ({ role: t.role, text: t.text.slice(0, 2000) }));
    // The conversation must start with the business, as the model expects.
    while (history.length && history[0]!.role !== 'user') history.shift();

    await assertUnderMonthlyLimit(scope, 'assistant');

    const { facts, serviceIds, today } = await loadAssistantFacts(tenant, scope);
    const raw = await aiProvider().askKhloe({ facts, history, message });
    await recordUsage(scope, 'assistant');

    const used = await scope
      .select('ai_usage_events', 'id')
      .eq('kind', 'assistant')
      .gte('created_at', DateTime.utc().startOf('month').toISO()!);

    return ok({
      ...sanitizeAssistantReply(raw, { serviceIds, today }),
      // For the confirm cards: names to show, and the currency prices are in.
      services: Object.fromEntries(facts.services.map((x) => [x.id, x.name])),
      currency: facts.business.currency,
      left: used.error ? null : Math.max(0, MONTHLY_LIMITS.assistant - (used.data ?? []).length),
    });
  } catch (error) {
    return handleError(error);
  }
}
