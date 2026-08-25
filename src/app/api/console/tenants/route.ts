import { handleError, ok, readJson, requireEmail, requireSlug, requireString, requireTimezone } from '@/lib/api';
import { requirePlatformStaff } from '@/lib/auth';
import { createTenant, listAllTenants } from '@/lib/db/console';
import { serializeTenant } from '@/lib/console-serializers';

/** Every business on the platform, newest first. Any staff member can look. */
export async function GET(request: Request) {
  try {
    await requirePlatformStaff(request);

    const tenants = await listAllTenants();
    return ok({ tenants: tenants.map(serializeTenant) });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * Onboard a new business — creates the tenant and invites its first owner in
 * one step. Requires 'admin': creating a business is more than a support
 * lookup, but doesn't need the full owner rung either.
 */
export async function POST(request: Request) {
  try {
    await requirePlatformStaff(request, 'admin');
    const body = await readJson(request);

    const slug = requireSlug(body, 'slug');
    const name = requireString(body, 'name', { maxLength: 200 });
    const timezone = requireTimezone(body, 'timezone');
    const ownerEmail = requireEmail(body, 'ownerEmail');

    const tenant = await createTenant({ slug, name, timezone, ownerEmail });
    return ok({ tenant: serializeTenant(tenant) }, 201);
  } catch (error) {
    return handleError(error);
  }
}
