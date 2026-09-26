import { fail, handleError, ok, optionalBoolean, readJson } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { brandRefusal, checkBrandColour } from '@/lib/brand-colour';
import { removeTenantLogo, replaceTenantLogo, updateTenantBranding } from '@/lib/db/branding';
import { checkLogo } from '@/lib/logo-file';
import type { TenantBranding } from '@/lib/db/types';

/**
 * How the business's booking page looks: its logo, whether its name shows
 * beside it, and its colour. Shown under Account (Your booking page).
 */

function view(branding: TenantBranding) {
  return {
    branding: {
      logoUrl: branding.logoUrl ?? null,
      accentColor: branding.accentColor ?? null,
      nameBesideLogo: branding.nameBesideLogo ?? false,
    },
  };
}

/** The colour and the name choice. `accentColor: null` goes back to Mineral. */
export async function PATCH(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { tenant } = await requireTenantAdmin(request, slug);
    const body = await readJson(request);

    const patch: { accentColor?: string | null; nameBesideLogo?: boolean } = {};
    if ('accentColor' in body) {
      if (body.accentColor === null) {
        patch.accentColor = null;
      } else {
        if (typeof body.accentColor !== 'string') return fail('"accentColor" must be a colour', 400);
        const check = checkBrandColour(body.accentColor);
        if (!check.ok) return fail(brandRefusal(check), 400);
        patch.accentColor = check.hex;
      }
    }
    const nameBesideLogo = optionalBoolean(body, 'nameBesideLogo');
    if (nameBesideLogo !== undefined) patch.nameBesideLogo = nameBesideLogo;
    if (Object.keys(patch).length === 0) return fail('Nothing to change', 400);

    return ok(view(await updateTenantBranding(tenant.id, patch)));
  } catch (error) {
    return handleError(error);
  }
}

/** A new logo, as the form field `logo`. Replaces the old one. */
export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { tenant } = await requireTenantAdmin(request, slug);

    const form = await request.formData().catch(() => null);
    const file = form?.get('logo');
    if (!file || typeof file === 'string') return fail('Choose an image to upload', 400);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = checkLogo(bytes);
    if (!check.ok) return fail(check.message, 400);

    return ok(view(await replaceTenantLogo(tenant.id, bytes, check.type)));
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { tenant } = await requireTenantAdmin(request, slug);
    return ok(view(await removeTenantLogo(tenant.id)));
  } catch (error) {
    return handleError(error);
  }
}
