/**
 * When one service may be booked, inside the business's opening hours
 * (migration 0042). The opening hours belong to the business, on Account;
 * a service can only narrow them, to some days or some hours, never widen
 * them. Null means whenever the business is open.
 *
 * Plain data, no imports: the service page uses it in the browser too.
 */

export interface ServiceHour {
  /** 1 = Monday .. 7 = Sunday. */
  weekday: number;
  /** 'HH:mm', in the business's time zone. */
  startTime: string;
  endTime: string;
}

const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A refusal the route turns into a 400. */
export class ServiceHoursError extends Error {}

/** What a request sent, as stored: null (whenever open) or tidy hours. */
export function parseServiceHours(value: unknown): ServiceHour[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) throw new ServiceHoursError('Choose the days and times this service can be booked.');
  if (value.length === 0) return null;
  if (value.length > 21) throw new ServiceHoursError('That is more times than a week has room for.');
  return value
    .map((raw) => {
      const h = raw as Partial<ServiceHour>;
      if (!Number.isInteger(h.weekday) || h.weekday! < 1 || h.weekday! > 7)
        throw new ServiceHoursError('Each time needs a day of the week.');
      if (typeof h.startTime !== 'string' || typeof h.endTime !== 'string' || !TIME.test(h.startTime) || !TIME.test(h.endTime))
        throw new ServiceHoursError('Times are written like 09:30.');
      if (h.startTime >= h.endTime) throw new ServiceHoursError('The end time must be after the start time.');
      return { weekday: h.weekday!, startTime: h.startTime, endTime: h.endTime };
    })
    .sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime));
}

/** "Whenever you are open", or "Mon, Wed · 10:00–14:00". */
export function serviceHoursSummary(hours: readonly ServiceHour[] | null): string {
  if (!hours || hours.length === 0) return 'Whenever you are open';
  const groups = new Map<string, number[]>();
  for (const h of hours) {
    const key = `${h.startTime.slice(0, 5)}–${h.endTime.slice(0, 5)}`;
    groups.set(key, [...(groups.get(key) ?? []), h.weekday]);
  }
  return [...groups.entries()]
    .map(([range, days]) => `${[...new Set(days)].sort().map((d) => DAY[d - 1]).join(', ')} · ${range}`)
    .join('; ');
}
