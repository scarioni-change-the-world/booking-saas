/**
 * Getting a new business to a working booking page with as few decisions
 * as possible: the hours it starts with, the kinds of service it can start
 * from, and the checklist on Services that says what is left and where.
 *
 * Pure, so the sign-up, the Services page and the tests share one answer.
 */

/* ── Opening hours to start from ──────────────────────────────────────── */

/** Monday to Friday (ISO weekdays). */
export const DEFAULT_WEEKDAYS = [1, 2, 3, 4, 5] as const;
export const DEFAULT_HOURS = { start: '09:00', end: '17:00' } as const;

export interface HoursRule {
  weekday: number;
  startTime: string;
  endTime: string;
}

const DAY = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** "09:00:00" → "9:00". */
function clock(t: string): string {
  const [h, m] = t.split(':');
  return `${Number(h)}:${m ?? '00'}`;
}

/** Whether these are still exactly the hours a new account starts with. */
export function areDefaultHours(rules: readonly HoursRule[]): boolean {
  if (rules.length !== DEFAULT_WEEKDAYS.length) return false;
  return DEFAULT_WEEKDAYS.every((d) =>
    rules.some(
      (r) => r.weekday === d && clock(r.startTime) === clock(DEFAULT_HOURS.start) && clock(r.endTime) === clock(DEFAULT_HOURS.end),
    ),
  );
}

/**
 * The usual week in one line: "Monday to Friday, 9:00–17:00",
 * "Tuesday and Thursday, 10:00–14:00; Saturday, 9:00–13:00". Days with the
 * same hours run together; more than three different patterns reads as
 * "Open 6 days a week" rather than a paragraph.
 */
export function hoursSummary(rules: readonly HoursRule[]): string {
  if (rules.length === 0) return 'No opening hours';
  const byDay = new Map<number, string>();
  for (let d = 1; d <= 7; d += 1) {
    const windows = rules
      .filter((r) => r.weekday === d)
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
      .map((r) => `${clock(r.startTime)}–${clock(r.endTime)}`);
    if (windows.length) byDay.set(d, windows.join(' and '));
  }

  // Runs of consecutive days with the same hours.
  const runs: Array<{ from: number; to: number; hours: string }> = [];
  for (const [day, hours] of byDay) {
    const last = runs[runs.length - 1];
    if (last && last.to === day - 1 && last.hours === hours) last.to = day;
    else runs.push({ from: day, to: day, hours });
  }

  // The same hours on separate runs ("Tuesday and Thursday") read as one.
  const groups: Array<{ days: string; hours: string }> = [];
  for (const run of runs) {
    const name =
      run.from === run.to
        ? DAY[run.from]!
        : run.to === run.from + 1
          ? `${DAY[run.from]} and ${DAY[run.to]}`
          : `${DAY[run.from]} to ${DAY[run.to]}`;
    const same = groups.find((g) => g.hours === run.hours);
    if (same) same.days = `${same.days.replace(/ and /, ', ')} and ${name}`;
    else groups.push({ days: name, hours: run.hours });
  }

  if (groups.length > 3) return `Open ${byDay.size} days a week`;
  return groups.map((g) => `${g.days}, ${g.hours}`).join('; ');
}

/* ── Kinds of service to start from ───────────────────────────────────── */

export interface ServiceType {
  id: string;
  /** What the choice is called. */
  label: string;
  /** What it sets, in a few words. */
  hint: string;
  /** The name it suggests; empty for "Something else". */
  name: string;
  durationMinutes: number;
  bufferAfterMinutes?: number;
  locationKind?: 'online' | 'in_person' | 'phone';
  /** Only where the answer is near-universal: an intro call is free. */
  priceMinor?: number;
  packSize?: number;
}

/**
 * The shapes most services take. Each one fills in what is usual for it,
 * so a new service starts close to right and the setup page asks only
 * what differs. Descriptions and prices are left to the business (except
 * the free intro call): those are what make the service theirs.
 */
export const SERVICE_TYPES: ServiceType[] = [
  {
    id: 'intro',
    label: 'Free intro call',
    hint: '20 min · online · free',
    name: 'Intro call',
    durationMinutes: 20,
    locationKind: 'online',
    priceMinor: 0,
  },
  {
    id: 'session',
    label: 'Session',
    hint: '1 hour · 15 min break after',
    name: 'Session',
    durationMinutes: 60,
    bufferAfterMinutes: 15,
  },
  {
    id: 'consultation',
    label: 'Consultation',
    hint: '45 min · online',
    name: 'Consultation',
    durationMinutes: 45,
    bufferAfterMinutes: 15,
    locationKind: 'online',
  },
  {
    id: 'treatment',
    label: 'Treatment',
    hint: '1 hour · in person · 15 min to reset',
    name: 'Treatment',
    durationMinutes: 60,
    bufferAfterMinutes: 15,
    locationKind: 'in_person',
  },
  {
    id: 'programme',
    label: 'Programme',
    hint: '4 sessions of 1 hour, paid together',
    name: 'Programme',
    durationMinutes: 60,
    bufferAfterMinutes: 15,
    packSize: 4,
  },
  {
    id: 'other',
    label: 'Something else',
    hint: 'Start from 30 minutes',
    name: '',
    durationMinutes: 30,
  },
];

/** The body that creates a service of this type, with the name given. */
export function serviceTypeBody(type: ServiceType, name: string): Record<string, unknown> {
  return {
    name: name.trim(),
    durationMinutes: type.durationMinutes,
    ...(type.bufferAfterMinutes ? { bufferAfterMinutes: type.bufferAfterMinutes } : {}),
    ...(type.locationKind ? { locationKind: type.locationKind } : {}),
    ...(type.priceMinor !== undefined ? { priceMinor: type.priceMinor } : {}),
    ...(type.packSize ? { bookingMode: 'pack', packSize: type.packSize } : {}),
  };
}

/* ── The checklist on Services ────────────────────────────────────────── */

export interface SetupInput {
  services: Array<{ id: string; name: string; active: boolean; availableToProspects: boolean; availableToExistingClients: boolean }>;
  hours: HoursRule[];
  calendarStatus: 'not_connected' | 'active' | 'needs_reconnect' | 'revoked';
  branding: { logo: boolean; colour: boolean };
  /** Any booking ever, from anyone. */
  everBooked: boolean;
  /** The booking page has been seen working on a website (Share). */
  embedded: boolean;
}

export type SetupState = 'done' | 'needed' | 'optional';

export interface SetupItem {
  id: 'service' | 'hours' | 'calendar' | 'branding' | 'share';
  title: string;
  /** What it is, or what was found: one short line. */
  detail: string;
  state: SetupState;
  /** Where to do it, relative to /admin/[slug]/; 'add-service' opens the form on Services. */
  action: { label: string; href: string } | null;
}

/**
 * Five things, in the order a new business should do them. "needed" is
 * what stops people booking at all; "optional" makes it better; "done" is
 * done. The list stays until every item is done (or it is hidden).
 */
export function setupItems(input: SetupInput): SetupItem[] {
  const active = input.services.filter((s) => s.active);
  const live = active.filter((s) => s.availableToProspects || s.availableToExistingClients);
  const firstHidden = active.find((s) => !s.availableToProspects && !s.availableToExistingClients);

  const service: SetupItem = live.length
    ? {
        id: 'service',
        title: live.length === 1 ? `Your service: ${live[0]!.name}` : `${live.length} services on your page`,
        detail: 'People can choose it on your booking page.',
        state: 'done',
        action: null,
      }
    : firstHidden
      ? {
          id: 'service',
          title: 'Put your service on your page',
          detail: `${firstHidden.name} is ready to set up, but nobody can book it yet: its last step is “Go live”.`,
          state: 'needed',
          action: { label: `Open ${firstHidden.name}`, href: `sessions/${firstHidden.id}` },
        }
      : {
          id: 'service',
          title: 'Add your first service',
          detail: 'What people book: a call, a session, a treatment. Start from a type and change what differs.',
          state: 'needed',
          action: { label: 'Add a service', href: 'add-service' },
        };

  const hours: SetupItem = input.hours.length
    ? {
        id: 'hours',
        title: 'Opening hours',
        detail: areDefaultHours(input.hours)
          ? `${hoursSummary(input.hours)}, set for you to start. Change them if yours are different.`
          : hoursSummary(input.hours),
        state: 'done',
        action: { label: areDefaultHours(input.hours) ? 'Change your hours' : 'Change', href: 'account#opening-hours' },
      }
    : {
        id: 'hours',
        title: 'Set your opening hours',
        detail: 'Without them your booking page offers no times at all.',
        state: 'needed',
        action: { label: 'Set your hours', href: 'account#opening-hours' },
      };

  const calendar: SetupItem =
    input.calendarStatus === 'active'
      ? { id: 'calendar', title: 'Calendar connected', detail: 'Busy times are left out, and bookings land in it.', state: 'done', action: null }
      : input.calendarStatus === 'not_connected'
        ? {
            id: 'calendar',
            title: 'Connect your calendar',
            detail: 'Google or Outlook: your busy times are never offered, and every booking appears in it.',
            state: 'optional',
            action: { label: 'Connect', href: 'week#calendar' },
          }
        : {
            id: 'calendar',
            title: 'Reconnect your calendar',
            detail: 'It stopped answering, so busy times may be offered and bookings are not added to it.',
            state: 'needed',
            action: { label: 'Reconnect', href: 'week#calendar' },
          };

  const missing = [!input.branding.logo && 'logo', !input.branding.colour && 'colour'].filter(Boolean) as string[];
  const branding: SetupItem = missing.length
    ? {
        id: 'branding',
        title: 'Your logo and colour',
        detail: `So your booking page looks like your own. Missing: your ${missing.join(' and ')}.`,
        state: 'optional',
        action: { label: 'Add them', href: 'account#booking-page' },
      }
    : { id: 'branding', title: 'Your logo and colour', detail: 'Your booking page looks like your own.', state: 'done', action: null };

  const share: SetupItem =
    input.everBooked || input.embedded
      ? {
          id: 'share',
          title: input.everBooked ? 'Your first booking is in' : 'On your website',
          detail: input.everBooked ? 'People are finding you and booking.' : 'Your booking page is working on your site.',
          state: 'done',
          action: null,
        }
      : {
          id: 'share',
          title: 'Share your page',
          detail: 'Your link for Instagram, WhatsApp and email, or booking on your own website.',
          state: live.length ? 'needed' : 'optional',
          action: { label: 'Share', href: 'share' },
        };

  return [service, hours, calendar, branding, share];
}

/** Whether the checklist still has something to say. */
export function setupOpen(items: readonly SetupItem[]): boolean {
  return items.some((i) => i.state !== 'done');
}

/* ── The wizard's simple week ─────────────────────────────────────────── */

/**
 * The usual week as the wizard asks for it: which days, and one stretch of
 * hours for all of them. null when the week is more than that (different
 * hours on different days, or a break), which the wizard leaves alone
 * rather than flatten; Account → Opening hours edits those.
 */
export function simpleWeek(rules: readonly HoursRule[]): { days: number[]; start: string; end: string } | null {
  if (rules.length === 0) return { days: [], start: DEFAULT_HOURS.start, end: DEFAULT_HOURS.end };
  const hhmm = (t: string) => t.slice(0, 5);
  const first = rules[0]!;
  const days = new Set<number>();
  for (const r of rules) {
    if (hhmm(r.startTime) !== hhmm(first.startTime) || hhmm(r.endTime) !== hhmm(first.endTime)) return null;
    if (days.has(r.weekday)) return null;
    days.add(r.weekday);
  }
  return { days: [...days].sort(), start: hhmm(first.startTime), end: hhmm(first.endTime) };
}

/** The whole week to save: the days chosen open at those hours, the others closed. */
export function weekBody(days: readonly number[], start: string, end: string) {
  return {
    days: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
      weekday,
      windows: days.includes(weekday) ? [{ startTime: start, endTime: end }] : [],
    })),
  };
}
