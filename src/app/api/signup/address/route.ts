import { handleError, ok } from '@/lib/api';
import { slugTaken } from '@/lib/db/signup';
import { isValidSlug, RESERVED_SLUGS, slugCandidates, slugFromName } from '@/lib/signup';

/**
 * Is this web address free? For the sign-up form, as somebody types their
 * business's name. Offers the next free numbered one when it is not.
 *
 * Tells nobody anything they could not learn by opening /t/<address>.
 */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const asked = (params.get('slug') ?? '').trim().toLowerCase() || slugFromName(params.get('name') ?? '');
    if (!asked) return ok({ slug: '', available: false, reason: 'empty' });
    if (!isValidSlug(asked)) {
      return ok({
        slug: asked,
        available: false,
        reason: RESERVED_SLUGS.has(asked) ? 'reserved' : 'invalid',
      });
    }
    if (!(await slugTaken(asked))) return ok({ slug: asked, available: true });

    for (const candidate of slugCandidates(asked).slice(1)) {
      if (!(await slugTaken(candidate)))
        return ok({ slug: asked, available: false, reason: 'taken', suggestion: candidate });
    }
    return ok({ slug: asked, available: false, reason: 'taken' });
  } catch (error) {
    return handleError(error);
  }
}
