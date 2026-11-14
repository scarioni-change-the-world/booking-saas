import { handleError, ok } from '@/lib/api';
import { requirePlatformStaff } from '@/lib/auth';
import { loadSignupFunnelInput } from '@/lib/db/console';
import { signupFunnel } from '@/lib/signup-funnel';

const WINDOWS: Record<string, number | null> = { '30': 30, '90': 90, all: null };

/**
 * Where new businesses stop on the way to their first booking.
 * ?window=30|90|all — businesses that joined in the last 30 or 90 days, or
 * ever. Counts and dates only (signup-funnel.ts); any staff member may look.
 */
export async function GET(request: Request) {
  try {
    await requirePlatformStaff(request);
    const asked = new URL(request.url).searchParams.get('window') ?? '90';
    const days = asked in WINDOWS ? WINDOWS[asked]! : 90;
    const sinceIso = days === null ? null : new Date(Date.now() - days * 86_400_000).toISOString();
    const funnel = signupFunnel(await loadSignupFunnelInput(sinceIso));
    return ok({ window: days === null ? 'all' : String(days), funnel });
  } catch (error) {
    return handleError(error);
  }
}
