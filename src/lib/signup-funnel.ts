/**
 * Where new businesses stop on the way to their first booking, for the
 * owner console: started signing up → confirmed → added a service → put
 * one on their page → shared it → first booking.
 *
 * Worked out from what is already stored (when each business was made,
 * its services, its bookings, whether its page was seen on a website),
 * so it needs no tracking of its own and covers every business since the
 * first. Counts and dates only, like the rest of the console.
 *
 * Pure: the console loader gathers the rows, this counts them.
 */

export interface FunnelTenant {
  id: string;
  createdAt: string;
}

export interface FunnelService {
  tenantId: string;
  createdAt: string;
  live: boolean;
}

export interface FunnelInput {
  tenants: FunnelTenant[];
  /** Active, not deleted. */
  services: FunnelService[];
  /** The first booking of each business (any one per business is fine; the earliest is used). */
  bookings: Array<{ tenantId: string; createdAt: string }>;
  /** Businesses whose booking page has been seen working on a website. */
  embedded: string[];
  /** Sign-ups in the window that never confirmed their email (no business made). */
  unconfirmed: number;
}

export interface FunnelStep {
  id: 'started' | 'confirmed' | 'service' | 'live' | 'shared' | 'booked';
  label: string;
  count: number;
  /** Share of the step before, 0–1; null for the first or after a zero. */
  ofPrevious: number | null;
}

export interface SignupFunnel {
  steps: FunnelStep[];
  /** Median days from joining to the first service, and to the first booking, among those who got there. */
  medianDaysToService: number | null;
  medianDaysToBooking: number | null;
  /** The step that loses the largest share, when there is enough to say. */
  worst: { from: FunnelStep['id']; to: FunnelStep['id']; lost: number } | null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return Math.round(value * 10) / 10;
}

const DAY = 86_400_000;

export function signupFunnel(input: FunnelInput): SignupFunnel {
  const ids = new Set(input.tenants.map((t) => t.id));
  const joined = new Map(input.tenants.map((t) => [t.id, Date.parse(t.createdAt)]));

  const firstService = new Map<string, number>();
  const live = new Set<string>();
  for (const s of input.services) {
    if (!ids.has(s.tenantId)) continue;
    const at = Date.parse(s.createdAt);
    const seen = firstService.get(s.tenantId);
    if (seen === undefined || at < seen) firstService.set(s.tenantId, at);
    if (s.live) live.add(s.tenantId);
  }

  const firstBooking = new Map<string, number>();
  for (const b of input.bookings) {
    if (!ids.has(b.tenantId)) continue;
    const at = Date.parse(b.createdAt);
    const seen = firstBooking.get(b.tenantId);
    if (seen === undefined || at < seen) firstBooking.set(b.tenantId, at);
  }

  // Each step counts only businesses that also passed the steps before it,
  // so the funnel never widens (a booking from a since-paused service still
  // counts as booked, and as live and shared, because it happened).
  const booked = new Set(firstBooking.keys());
  const shared = new Set([...input.embedded.filter((id) => ids.has(id)), ...booked]);
  const liveOrBooked = new Set([...live, ...shared]);
  const withService = new Set([...firstService.keys(), ...liveOrBooked]);

  const counts: Array<[FunnelStep['id'], string, number]> = [
    ['started', 'Started signing up', input.tenants.length + input.unconfirmed],
    ['confirmed', 'Confirmed their email', input.tenants.length],
    ['service', 'Added a service', withService.size],
    ['live', 'Put it on their page', liveOrBooked.size],
    ['shared', 'Shared their page', shared.size],
    ['booked', 'Got a first booking', booked.size],
  ];
  const steps: FunnelStep[] = counts.map(([id, label, count], i) => {
    const before = i > 0 ? counts[i - 1]![2] : 0;
    return { id, label, count, ofPrevious: i > 0 && before > 0 ? count / before : null };
  });

  let worst: SignupFunnel['worst'] = null;
  for (let i = 1; i < steps.length; i += 1) {
    const before = steps[i - 1]!.count;
    if (before < 5) continue; // too few to call it a pattern
    const lost = 1 - steps[i]!.count / before;
    if (!worst || lost > worst.lost) worst = { from: steps[i - 1]!.id, to: steps[i]!.id, lost };
  }

  const days = (map: Map<string, number>) =>
    [...map.entries()].map(([id, at]) => Math.max(0, (at - (joined.get(id) ?? at)) / DAY));

  return {
    steps,
    medianDaysToService: median(days(firstService)),
    medianDaysToBooking: median(days(firstBooking)),
    worst: worst && worst.lost > 0 ? worst : null,
  };
}
