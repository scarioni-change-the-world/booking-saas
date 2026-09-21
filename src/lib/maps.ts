/**
 * Turning an address into something tappable.
 *
 * An in-person booking whose confirmation shows a street address as plain
 * text asks the client to retype it into a map, on a phone, usually while
 * already running late. One link removes that.
 *
 * Two services rather than one, because the choice is not ours to make well:
 * somebody on an iPhone expects Apple Maps and somebody on Android expects
 * Google. The detection is a user-agent sniff, which is unreliable by
 * nature — so the failure mode is chosen to be harmless. Guess wrong and an
 * Apple user gets Google Maps, which opens and shows the right place. That
 * is a worse experience than the right guess and a far better one than no
 * link at all.
 *
 * Both URLs are the documented, stable search forms, not deep links into a
 * particular app: they open in a browser where no app exists, and hand over
 * to the app where one does.
 */

export type MapService = 'google' | 'apple';

/**
 * Which map app this device most likely has.
 *
 * Deliberately narrow: only the platforms where Apple Maps is the default
 * get 'apple'. Everything else, including every unknown, gets Google, which
 * is the one that works everywhere.
 */
export function preferredMapService(userAgent: string): MapService {
  return /iPhone|iPad|iPod|Macintosh/i.test(userAgent) ? 'apple' : 'google';
}

/**
 * A link to this address on a map.
 *
 * Takes the address as the business wrote it. No geocoding, no parsing —
 * both services search, and a human-written address is exactly what their
 * search is good at. Trying to normalise it here would turn "Calle Mayor 4,
 * 2º" into something worse.
 */
export function mapUrl(address: string, service: MapService = 'google'): string | null {
  const query = address.trim();
  if (query === '') return null;

  return service === 'apple'
    ? `https://maps.apple.com/?q=${encodeURIComponent(query)}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/**
 * The link to put inside a calendar invitation.
 *
 * Always Google, never the platform guess: an invitation is written once, on
 * a server, and then read on whatever device the client happens to open it
 * on — which may not be the one they booked from, and is often several
 * devices at once. Google's URL opens on all of them.
 */
export function mapUrlForInvite(address: string): string | null {
  return mapUrl(address, 'google');
}
