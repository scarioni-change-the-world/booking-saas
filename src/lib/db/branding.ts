import { __unsafeServiceClient } from './client';
import { LOGO_EXTENSION, type LogoType } from '../logo-file';
import type { TenantBranding } from './types';

/**
 * A business's booking-page identity: its logo in the `logos` bucket
 * (migration 0031) and the rest in tenants.branding.
 *
 * Service-role, as every write to tenants is (see console.ts): the caller
 * has already proved the person is an admin of this tenant, and each
 * function here only ever touches that one tenant's row and folder.
 */

const BUCKET = 'logos';

async function readBranding(tenantId: string): Promise<TenantBranding> {
  const { data, error } = await __unsafeServiceClient()
    .from('tenants')
    .select('branding')
    .eq('id', tenantId)
    .single();
  if (error) throw error;
  return ((data as { branding: TenantBranding | null }).branding ?? {}) as TenantBranding;
}

/** Merge into the saved branding. A null value removes that key. */
export async function updateTenantBranding(
  tenantId: string,
  patch: { [K in keyof TenantBranding]?: TenantBranding[K] | null },
): Promise<TenantBranding> {
  const next: Record<string, unknown> = { ...(await readBranding(tenantId)) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else if (value !== undefined) next[key] = value;
  }
  const { data, error } = await __unsafeServiceClient()
    .from('tenants')
    .update({ branding: next })
    .eq('id', tenantId)
    .select('branding')
    .single();
  if (error) throw error;
  return (data as { branding: TenantBranding }).branding;
}

async function listLogoPaths(tenantId: string): Promise<string[]> {
  const { data, error } = await __unsafeServiceClient().storage.from(BUCKET).list(tenantId);
  if (error) throw error;
  return (data ?? []).map((f) => `${tenantId}/${f.name}`);
}

/**
 * Store a new logo and point the booking page at it. Each upload gets a new
 * name, so a client's browser never shows the old one from its cache; the
 * old files are removed once the new address is saved.
 */
export async function replaceTenantLogo(
  tenantId: string,
  bytes: Uint8Array,
  type: LogoType,
): Promise<TenantBranding> {
  const storage = __unsafeServiceClient().storage.from(BUCKET);
  const previous = await listLogoPaths(tenantId);
  const path = `${tenantId}/${Date.now()}.${LOGO_EXTENSION[type]}`;

  const { error } = await storage.upload(path, bytes, {
    contentType: type,
    cacheControl: '31536000',
    upsert: false,
  });
  if (error) throw error;

  const branding = await updateTenantBranding(tenantId, { logoUrl: storage.getPublicUrl(path).data.publicUrl });
  if (previous.length > 0) {
    const { error: removeError } = await storage.remove(previous);
    // The new logo is saved and shown either way; a stray old file costs
    // nothing a visitor can see.
    if (removeError) console.error(`[branding] could not remove old logos: ${removeError.message}`);
  }
  return branding;
}

export async function removeTenantLogo(tenantId: string): Promise<TenantBranding> {
  const branding = await updateTenantBranding(tenantId, { logoUrl: null });
  const paths = await listLogoPaths(tenantId);
  if (paths.length > 0) {
    const { error } = await __unsafeServiceClient().storage.from(BUCKET).remove(paths);
    if (error) console.error(`[branding] could not remove logos: ${error.message}`);
  }
  return branding;
}
