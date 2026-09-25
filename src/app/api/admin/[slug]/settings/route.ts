import { fail, handleError, ok, readJson, requireEmail, requireInt, requireString } from '@/lib/api';
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
    const { scope, userEmail } = await requireTenantAdmin(request, slug);

    const { data, error } = await scope.select('tenant_settings').maybeSingle();
    if (error) throw error;

    const row = data as unknown as TenantSettingsRow | null;
    /* The address the caller is signed in as — EmailAddresses offers it as
       the value for "send alerts to" and "replies go to" whenever the
       tenant hasn't set its own, so nobody has to retype the address they
       signed up and are signed in with. */
    if (!row) return ok({ settings: null, signedInEmail: userEmail });

    return ok({ settings: serializeSettings(row), signedInEmail: userEmail });
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

    /* Upper-cased before it is checked, so "eur" is accepted rather than
       refused on a technicality. The pattern is enforced here as well as by
       migration 0024's check because this value is handed to
       Intl.NumberFormat, which throws on anything it does not recognise —
       and a settings save should not be able to make every booking page in
       an account fail to render. */
    if ('currency' in body) {
      const raw = requireString(body, 'currency', { maxLength: 3 }).toUpperCase();
      if (!/^[A-Z]{3}$/.test(raw)) {
        return fail('Currency must be a three-letter code, like EUR or USD', 400);
      }
      patch.currency = raw;
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
