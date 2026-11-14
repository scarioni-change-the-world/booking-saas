import { handleError, ok } from '@/lib/api';
import { requirePlatformStaff } from '@/lib/auth';

/**
 * Confirms the signed-in person is on the company's own staff, and hands
 * back their role. The console's layout calls this once on load — a
 * 401/403 here is what sends the browser back to /console/login rather than
 * rendering the console for someone who happens to have a login but isn't
 * staff (e.g. a tenant's own admin, signed in as themselves).
 */
export async function GET(request: Request) {
  try {
    // Answers before the second step too: the sign-in page asks this to
    // learn that an owner still has a code to enter.
    const { role, aal } = await requirePlatformStaff(request, 'support', { allowOneStep: true });
    return ok({ role, aal, twoStepNeeded: role === 'owner' && aal !== 'aal2' });
  } catch (error) {
    return handleError(error);
  }
}
