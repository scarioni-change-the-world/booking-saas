import {
  fail,
  handleError,
  ok,
  optionalBoolean,
  optionalString,
  readJson,
  requireInt,
  requireString,
} from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { serializeEventType } from '@/lib/admin-serializers';
import type { EventTypeRow } from '@/lib/db/types';

/** "Coaching Session (60 min)" → "coaching-session-60-min". */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      // Strip the combining-diacritic marks NFKD splits accents into, so
      // "Sesión" -> "sesion" rather than a name with a dropped, mangled letter.
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'session'
  );
}

/**
 * All of a tenant's session types — active and archived. This is the admin
 * view: unlike the public /api/t/[slug]/event-types endpoint it is not
 * filtered by audience, because the person configuring them needs to see
 * everything, not just what a prospect or client is currently offered.
 */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { scope } = await requireTenantAdmin(request, slug);

    // Every new type is created with the same default sort_order, so without
    // a tiebreaker the list's order among same-priority rows is whatever
    // Postgres feels like on a given day. created_at makes it stable.
    const { data, error } = await scope
      .select('event_types')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw error;

    const rows = (data ?? []) as unknown as EventTypeRow[];
    return ok({ eventTypes: rows.map(serializeEventType) });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * Create a session type.
 *
 * No hard cap in the schema — the "up to 3" the product currently offers is a
 * soft, UI-level guide while pricing tiers are still undecided, not a
 * database constraint. Enforcing it here would mean a real migration the day
 * tiering is settled; a disabled button in the dashboard costs nothing to
 * change in the meantime.
 */
export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { scope } = await requireTenantAdmin(request, slug);
    const body = await readJson(request);

    const name = requireString(body, 'name', { maxLength: 200 });
    const durationMinutes = requireInt(body, 'durationMinutes', { min: 5, max: 1440 });
    const bufferBefore = requireInt(body, 'bufferBeforeMinutes', { min: 0, max: 720 });
    const bufferAfter = requireInt(body, 'bufferAfterMinutes', { min: 0, max: 720 });
    const description = optionalString(body, 'description', { maxLength: 2000 });
    const availableToProspects = optionalBoolean(body, 'availableToProspects') ?? false;
    const availableToExistingClients =
      optionalBoolean(body, 'availableToExistingClients') ?? false;

    const base = slugify(name);

    // A tenant's slugs only need to be unique against each other, so a
    // handful of attempts with a numeric suffix resolves any collision
    // without asking the tenant to think about slugs at all.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidateSlug = attempt === 0 ? base : `${base}-${attempt + 1}`;

      const { data, error } = await scope.insert('event_types', {
        slug: candidateSlug,
        name,
        description: description ?? null,
        duration_minutes: durationMinutes,
        buffer_before_minutes: bufferBefore,
        buffer_after_minutes: bufferAfter,
        available_to_prospects: availableToProspects,
        available_to_existing_clients: availableToExistingClients,
      });

      if (!error) {
        const row = (data as unknown as EventTypeRow[])[0]!;
        return ok({ eventType: serializeEventType(row) }, 201);
      }
      // 23505 = unique_violation. Anything else is a real failure.
      if (error.code !== '23505') throw error;
    }

    return fail('Could not find a free name for this session type — try renaming it', 409);
  } catch (error) {
    return handleError(error);
  }
}
