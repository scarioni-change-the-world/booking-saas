import { handleError, ok, readJson, requireEmail } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { baseUrl } from '@/lib/base-url';
import { BookingError } from '@/lib/booking-service';
import { BUILDERS, isBuilderId, stepsAsText } from '@/lib/builders';
import { embedSnippet } from '@/lib/embed';
import { enforceRateLimit } from '@/lib/rate-limit';
import { sendShareStepsEmail } from '@/lib/share-email';

/**
 * Share → "Email these steps": send whoever looks after the website the
 * link or the code and the steps for their tool, from khloe, with replies
 * going to the business.
 */
export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { tenant, userEmail } = await requireTenantAdmin(request, slug);
    const body = await readJson(request);
    const to = requireEmail(body, 'to');
    const builder = isBuilderId(body.builder) ? body.builder : 'other';
    const method = body.method === 'button' ? 'button' : 'section';
    const service = typeof body.service === 'string' && /^[a-z0-9-]{1,80}$/.test(body.service) ? body.service : null;

    const origin = baseUrl() || new URL(request.url).origin;
    const link = `${origin}/${slug}${service ? `?service=${encodeURIComponent(service)}` : ''}`;
    const paste = method === 'button' ? link : embedSnippet(origin, slug, service);

    await enforceRateLimit(request, tenant.id, 'shareEmail', { subject: 'business' });

    const status = await sendShareStepsEmail({
      to,
      business: tenant.name,
      replyTo: userEmail,
      tool: BUILDERS[builder].name,
      method,
      steps: stepsAsText(builder, method, paste),
      link,
    });
    if (status === 'failed') throw new BookingError('The email could not be sent. Please try again.', 502);
    return ok({ sent: status === 'sent', status });
  } catch (error) {
    return handleError(error);
  }
}
