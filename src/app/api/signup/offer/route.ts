import { ok } from '@/lib/api';
import { countFoundingTenants } from '@/lib/db/console';
import { foundingOfferOpen } from '@/lib/plans';

export const dynamic = 'force-dynamic';

/**
 * Whether the founding price is still on offer, for the sign-up page. A
 * failure reads as "no offer": the page must never promise a price the
 * business will not get.
 */
export async function GET() {
  try {
    return ok({ founding: foundingOfferOpen(await countFoundingTenants()) });
  } catch {
    return ok({ founding: false });
  }
}
