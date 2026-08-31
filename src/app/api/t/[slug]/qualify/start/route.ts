import { handleError, isResponse, ok, readJson, requireEmail, requireTenant } from '@/lib/api';
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

    const responseId = await startResponse(resolved.scope, email);
    return ok({ responseId }, 201);
  } catch (error) {
    return handleError(error);
  }
}
