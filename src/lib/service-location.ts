import type { ServiceLocationKind } from './db/types';

/**
 * Where a service happens.
 *
 * A kind the software understands, plus text only the business can write.
 * The split matters: "Online" has to be something the code knows, so a
 * booking page can say it plainly and a calendar invitation can carry it,
 * while the address or the room number is the part no enum could ever hold.
 *
 * Text without a kind is refused by the database (migration 0024's check)
 * and by parseLocation, because an address attached to nothing renders as a
 * floating line the reader cannot place.
 *
 * Deliberately free of imports beyond a type: this module is read by the
 * public booking page, which runs in a browser. parseLocation lives in
 * admin-event-types.ts instead, because it needs BookingError — and
 * BookingError pulls the whole server chain, down to node:net, into
 * whatever bundle imports it. That is not a theoretical concern: it broke
 * the build the first time these two lived together.
 */

const KINDS: ServiceLocationKind[] = ['online', 'in_person', 'phone'];

/** What a client reads. Never "in_person". */
export const LOCATION_LABELS: Record<ServiceLocationKind, string> = {
  online: 'Online',
  in_person: 'In person',
  phone: 'By phone',
};

/** What the business chooses between, in the order a form should offer it. */
export const LOCATION_OPTIONS: Array<{ value: ServiceLocationKind; label: string }> = KINDS.map(
  (value) => ({ value, label: LOCATION_LABELS[value] }),
);

/** "Online", or "In person · Calle Mayor 4" — one line for a client. */
export function describeLocation(
  kind: ServiceLocationKind | null,
  detail: string | null,
): string | null {
  if (!kind) return null;
  const label = LOCATION_LABELS[kind];
  return detail ? `${label} · ${detail}` : label;
}
