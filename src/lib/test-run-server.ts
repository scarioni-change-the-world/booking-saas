import { requireTenantAdmin } from './auth';
import { TEST_HEADER } from './test-run';

/**
 * Whether this request is a test run of the booking page.
 *
 * Only ever for a signed-in admin of this very business. A test run skips
 * the question gate on the calendar — that is how a business can walk to a
 * time without its answers being stored — so letting anyone ask for one
 * would let anyone see the calendar without answering. A request that says
 * it is a test and is not from an admin is refused outright, never quietly
 * treated as real: somebody who meant to test must not book for real.
 */
export async function isTestRun(request: Request, slug: string): Promise<boolean> {
  if (request.headers.get(TEST_HEADER) !== '1') return false;
  await requireTenantAdmin(request, slug);
  return true;
}
