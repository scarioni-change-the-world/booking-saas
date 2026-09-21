import type { DaySlots } from '../types';

/**
 * Making a list of times readable.
 *
 * A day with thirty openings rendered as thirty identical buttons is a wall,
 * not a choice — the client reads every one because nothing tells them where
 * to look. Two things fix that, and both are here rather than in the
 * component because both are arithmetic worth testing: grouping by time of
 * day, and showing a manageable run of dates at a time instead of a strip
 * that runs off the edge of the screen.
 */

export type Period = 'morning' | 'afternoon' | 'evening';

export const PERIOD_LABELS: Record<Period, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
};

/**
 * Which part of the day an instant falls in, for the person looking at it.
 *
 * Deliberately the viewer's local hours, not the business's: the times on
 * screen are already converted to the viewer's zone, so grouping them by the
 * tenant's would put a 9am slot under "Afternoon" for anybody a few zones
 * away. Noon and 5pm are the boundaries because they are the ones people
 * already use, not because anything in the data says so.
 */
export function periodOf(iso: string): Period {
  const hour = new Date(iso).getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

export interface SlotGroup {
  period: Period;
  label: string;
  slots: string[];
}

/**
 * Group a day's slots, dropping the periods with nothing in them.
 *
 * An empty "Evening" heading is a small lie — it reads as a section that
 * failed to load rather than as a therapist who stops at five.
 */
export function groupSlots(slots: readonly string[]): SlotGroup[] {
  const order: Period[] = ['morning', 'afternoon', 'evening'];
  const buckets = new Map<Period, string[]>();

  for (const iso of slots) {
    const period = periodOf(iso);
    const existing = buckets.get(period);
    if (existing) existing.push(iso);
    else buckets.set(period, [iso]);
  }

  return order
    .filter((period) => (buckets.get(period)?.length ?? 0) > 0)
    .map((period) => ({ period, label: PERIOD_LABELS[period], slots: buckets.get(period)! }));
}

/** How many dates a navigator shows at once. */
export const DATES_PER_PAGE = 7;

export function pageCount(days: readonly DaySlots[], size = DATES_PER_PAGE): number {
  if (days.length === 0) return 0;
  return Math.ceil(days.length / size);
}

/** The page a given date sits on, or 0 when it is not in the list at all. */
export function pageContaining(
  days: readonly DaySlots[],
  date: string | null,
  size = DATES_PER_PAGE,
): number {
  if (!date) return 0;
  const index = days.findIndex((day) => day.date === date);
  if (index < 0) return 0;
  return Math.floor(index / size);
}

/**
 * The dates on one page.
 *
 * Clamped rather than allowed to run past the end, because the alternative —
 * an empty navigator with working arrows — looks exactly like a bug.
 */
export function pageSlice(
  days: readonly DaySlots[],
  page: number,
  size = DATES_PER_PAGE,
): DaySlots[] {
  const total = pageCount(days, size);
  if (total === 0) return [];
  const clamped = Math.min(Math.max(page, 0), total - 1);
  return days.slice(clamped * size, clamped * size + size);
}
