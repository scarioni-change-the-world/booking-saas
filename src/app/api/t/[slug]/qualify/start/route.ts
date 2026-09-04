import { handleError, isResponse, ok, readJson, requireEmail, requireString, requireTenant } from '@/lib/api';
import { loadEventType } from '@/lib/booking-service';
import { startResponse } from '@/lib/qualification-response-service';

/**
 * Begin a questionnaire session.
 *
 * Called the moment a prospect gives their email, before they see a single
 * question — not at the end, alongside the full answer set, the way it
 * worked before migration 0012. That's what makes a real completion rate
 * possible: a response row now exists for every prospect who *starts*, not
 * only the ones who finish, so a tenant can see how many people the
 * questionnaire is actually losing, not just how many it converts.
 *
 * `eventTypeId` is required as of migration 0016's reordered flow: a
 * prospect always picks a service before the gate runs, so which one is
 * always known by the time this is called. Validated the same way booking
 * creation validates it — an unknown or archived id fails the same clear
 * way an attempt to book it would.
 *
 * .../qualify (the sibling route) completes the row this returns the id of,
 * rather than creating a fresh one.
 */
export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const resolved = await requireTenant(slug);
    if (isResponse(resolved)) return resolved;

    const body = await readJson(request);
    const email = requireEmail(body, 'email');
    const eventTypeId = requireString(body, 'eventTypeId', { maxLength: 100 });
    await loadEventType(resolved.scope, eventTypeId);

    const responseId = await startResponse(resolved.scope, email, eventTypeId);
    return ok({ responseId }, 201);
  } catch (error) {
    return handleError(error);
  }
}
