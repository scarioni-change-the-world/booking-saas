import { handleError, isResponse, ok, requireTenant } from '@/lib/api';
import { listEventTypes, type Audience } from '@/lib/booking-service';

export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const resolved = await requireTenant(slug);
    if (isResponse(resolved)) return resolved;

    // Defaults to the prospect audience: the existing-client view is reached
    // through a private URL, so the safer default is the gated one.
    const requested = new URL(request.url).searchParams.get('audience');
    const audience: Audience = requested === 'client' ? 'client' : 'prospect';

    const types = await listEventTypes(resolved.scope, audience);

    return ok({
      eventTypes: types.map((t) => ({
        id: t.id,
        slug: t.slug,
        name: t.name,
        description: t.description,
        durationMinutes: t.duration_minutes,
        color: t.color,
      })),
    });
  } catch (error) {
    return handleError(error);
  }
}
