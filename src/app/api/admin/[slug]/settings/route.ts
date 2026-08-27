import { handleError, ok, readJson, requireEmail, requireInt } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { serializeSettings } from '@/lib/admin-serializers';
import type { TenantSettingsRow } from '@/lib/db/types';

/**
 * The one settings row every tenant has from the moment it's created — see
 * migration 0001's `tenant_settings` table, one row per tenant, keyed by
 * `tenant_id` itself rather than a separate `id` column.
 */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { scope } = await requireTenantAdmin(request, slug);

    const { data, error } = await scope.select('tenant_settings').maybeSingle();
    if (error) throw error;

    const row = data as unknown as TenantSettingsRow | null;
    if (!row) return ok({ settings: null });

    return ok({ settings: serializeSettings(row) });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * Update the settings row. There is no POST for this table — every tenant
 * already has one row (created alongside the tenant itself), so "create"
 * never applies here, only "change".
 *
 * `scope.update` alone (no extra `.eq('id', ...)`) is correct: this table's
 * primary key is `tenant_id`, which the scope already filters on.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { scope } = await requireTenantAdmin(request, slug);
    const body = await readJson(request);

    const patch: Partial<TenantSettingsRow> = {};

    if ('bookingNoticeHours' in body) {
      patch.booking_notice_hours = requireInt(body, 'bookingNoticeHours', { min: 0, max: 8760 });
    }
    if ('bookingWindowDays' in body) {
      patch.booking_window_days = requireInt(body, 'bookingWindowDays', { min: 0, max: 3650 });
    }

    // Emails go through requireEmail (not the nullable helper) when present and
    // non-blank, so a typo is caught here rather than silently saved; blanking
    // the field out is still allowed, since notifications are optional.
    if ('notificationEmail' in body) {
      const value = body.notificationEmail;
      patch.notification_email = value === null || value === '' ? null : requireEmail(body, 'notificationEmail');
    }
    if ('replyToEmail' in body) {
      const value = body.replyToEmail;
      patch.reply_to_email = value === null || value === '' ? null : requireEmail(body, 'replyToEmail');
    }

    const { data, error } = await scope.update('tenant_settings', patch).select();
    if (error) throw error;

    const row = (data as unknown as TenantSettingsRow[])[0]!;
    return ok({ settings: serializeSettings(row) });
  } catch (error) {
    return handleError(error);
  }
}
