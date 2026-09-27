import { DateTime } from 'luxon';
import { analyseQuestions, type AnalysedResponse, type QuestionInsight } from './enquiry-analysis';
import { rangeBounds, type DateRange } from './report-period';
import { sourceLabel } from './visit-source';

/**
 * Reports: a period of a practice read as evidence, not as a list.
 *
 * Every figure here answers a question a professional actually has — why
 * people who find the page do not book, which service earns its place, when
 * the week is full and when it is empty, who has not come back — and the
 * notes at the top turn the worst of those into something to change, with
 * the place to change it.
 *
 * Pure: the route loads rows, this reads them. Everything is counted in the
 * business's own time zone, over calendar days, both ends included.
 */

/* ── Inputs ───────────────────────────────────────────────────────────── */

export interface ReportService {
  id: string;
  name: string;
  /** Per session, in the currency's minor unit; null when unpriced. */
  priceMinor: number | null;
  durationMinutes: number;
  bookingMode: 'single' | 'pack';
  packSize: number | null;
}

export interface ReportBooking {
  id: string;
  createdAt: string;
  startsAt: string;
  endsAt: string;
  status: 'confirmed' | 'cancelled';
  cancelledAt: string | null;
  cancelledBy: 'client' | 'business' | null;
  cancellationReason: string | null;
  eventTypeId: string;
  email: string;
  name: string;
  packId: string | null;
  packSize: number | null;
  source: string | null;
  attendance: 'attended' | 'no_show' | null;
  rescheduleCount: number;
  paymentId: string | null;
  /** Made from the client's own link rather than the public page. */
  viaClientLink: boolean;
}

export interface ReportVisit {
  visitedAt: string;
  source: string;
  surface: 'page' | 'embedded' | 'client_link';
}

export interface ReportPayment {
  id: string;
  status: 'open' | 'paid' | 'expired' | 'failed' | 'refunded';
  amountMinor: number;
  refundedMinor: number;
  paidAt: string | null;
  paymentMode: 'full' | 'deposit';
  kind: 'single' | 'pack';
  eventTypeId: string | null;
}

export interface ReportRating {
  bookingId: string;
  rating: number;
  comment: string | null;
  createdAt: string;
}

export interface ReportResponse extends AnalysedResponse {
  createdAt: string;
}

export interface OpenDay {
  date: string;
  /** 1 = Monday … 7 = Sunday. */
  weekday: number;
  windows: Array<{ startMinutes: number; endMinutes: number }>;
}

export interface ReportInput {
  timezone: string;
  /** The moment the report is read — sessions after it have not happened. */
  now: string;
  period: DateRange;
  previous: DateRange;
  noticeHours: number;
  services: ReportService[];
  /** Every booking the business has — history is how "came back" is known. */
  bookings: ReportBooking[];
  /** Enquiries in both periods. */
  responses: ReportResponse[];
  /** Visits in both periods. */
  visits: ReportVisit[];
  payments: ReportPayment[];
  ratings: ReportRating[];
  openDays: OpenDay[];
  previousOpenDays: OpenDay[];
  /** Whether visits are counted at all yet (migration 0033). */
  visitsTracked: boolean;
}

/* ── Outputs ──────────────────────────────────────────────────────────── */

export interface Figure {
  value: number;
  previous: number | null;
}

export interface Headline {
  bookingsMade: Figure;
  sessionsHeld: Figure;
  hoursBooked: Figure;
  hoursOpen: Figure;
  /** Booked ÷ open, 0–1; null with no open hours. */
  utilisation: { value: number | null; previous: number | null };
  valueEarnedMinor: Figure;
  collectedOnlineMinor: Figure;
  newClients: Figure;
  returningClients: Figure;
  visits: Figure;
  rating: { average: number | null; count: number; previousAverage: number | null };
}

export interface FunnelStep {
  id: 'visited' | 'started' | 'through' | 'booked';
  label: string;
  count: number;
}

export interface Funnel {
  steps: FunnelStep[];
  /** The step people leave most at, as a share lost, when there is enough to say. */
  worstDrop: { from: FunnelStep['id']; to: FunnelStep['id']; lost: number; share: number } | null;
}

export interface ServiceReport {
  id: string;
  name: string;
  booked: number;
  held: number;
  upcoming: number;
  noShows: number;
  cancelled: number;
  /** Cancelled ÷ everything that was due in the period, 0–1. */
  cancelRate: number | null;
  hoursHeld: number;
  valueMinor: number;
  valuePerHourMinor: number | null;
  /** Clients who booked again after a session here, 0–1. */
  cameBackRate: number | null;
  rating: number | null;
  ratingCount: number;
  medianLeadDays: number | null;
  enquiries: number;
  through: number;
  /** Booked ÷ got through the questions, 0–1. */
  conversion: number | null;
}

export interface DemandCell {
  weekday: number;
  hour: number;
  openMinutes: number;
  bookedMinutes: number;
}

export interface DemandBand {
  weekday: number;
  part: 'morning' | 'afternoon' | 'evening';
  openHours: number;
  bookedHours: number;
  fill: number;
}

export interface Demand {
  cells: DemandCell[];
  hours: number[];
  full: DemandBand[];
  quiet: DemandBand[];
  lead: Array<{ label: string; count: number }>;
  /** When people make their bookings (not when the sessions are). */
  bookedWhen: { weekday: number; part: DemandBand['part']; count: number } | null;
}

export interface QuietClient {
  name: string;
  email: string;
  lastSession: string;
  sessions: number;
}

export interface StalledProgramme {
  name: string;
  email: string;
  serviceName: string;
  owed: number;
  lastSession: string | null;
}

export interface ClientsReport {
  active: number;
  newClients: number;
  returning: number;
  cameBackRate: number | null;
  medianDaysBetween: number | null;
  programmes: { running: number; completed: number; stalled: StalledProgramme[] };
  quiet: QuietClient[];
}

export interface MoneyReport {
  valueEarnedMinor: number;
  collectedOnlineMinor: number;
  refundedMinor: number;
  depositsToCollectMinor: number;
  lateKept: { count: number; amountMinor: number };
  bookedAheadMinor: number;
  byService: Array<{ id: string; name: string; valueMinor: number }>;
}

export interface CancellationsReport {
  count: number;
  byClient: number;
  byBusiness: number;
  unknown: number;
  rate: number | null;
  medianHoursAhead: number | null;
  late: number;
  noShows: number;
  noShowRate: number | null;
  /** How many past sessions have been marked came / didn't come. */
  marked: number;
  past: number;
  moved: number;
  reasons: Array<{ reason: string; at: string; serviceName: string; by: 'client' | 'business' | null }>;
}

export interface SourceRow {
  source: string;
  label: string;
  visits: number;
  bookings: number;
  conversion: number | null;
}

export interface RatingsReport {
  count: number;
  average: number | null;
  distribution: Array<{ rating: number; count: number }>;
  comments: Array<{ rating: number; comment: string; serviceName: string; at: string }>;
}

export interface Finding {
  id: string;
  tone: 'need' | 'good';
  title: string;
  detail: string;
  /** Relative to /admin/<slug>/. */
  action?: { label: string; href: string };
}

export interface Report {
  period: DateRange;
  previous: DateRange;
  headline: Headline;
  funnel: Funnel;
  services: ServiceReport[];
  demand: Demand;
  clients: ClientsReport;
  money: MoneyReport;
  cancellations: CancellationsReport;
  sources: SourceRow[];
  ratings: RatingsReport;
  questions: QuestionInsight[];
  findings: Finding[];
  tracking: { visits: boolean; attendanceMarked: number; sessionsPast: number; ratings: number };
}

/* ── Helpers ──────────────────────────────────────────────────────────── */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const ms = (iso: string) => new Date(iso).getTime();

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function ratio(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function partOfDay(hour: number): DemandBand['part'] {
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const weekdayName = (weekday: number) => WEEKDAYS[weekday - 1] ?? '';
export const bandName = (weekday: number, part: DemandBand['part']) =>
  `${weekdayName(weekday)} ${part === 'morning' ? 'mornings' : part === 'afternoon' ? 'afternoons' : 'evenings'}`;

export function formatMinor(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
      maximumFractionDigits: minor % 100 === 0 ? 0 : 2,
    }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

const pct = (share: number) => `${Math.round(share * 100)}%`;

/* ── The report ───────────────────────────────────────────────────────── */

export function buildReport(input: ReportInput, currency = 'EUR'): Report {
  const tz = input.timezone;
  const now = ms(input.now);
  const cur = rangeBounds(input.period, tz);
  const prev = rangeBounds(input.previous, tz);
  const inCur = (iso: string | null) => !!iso && ms(iso) >= cur.start && ms(iso) < cur.end;
  const inPrev = (iso: string | null) => !!iso && ms(iso) >= prev.start && ms(iso) < prev.end;
  const service = new Map(input.services.map((s) => [s.id, s]));
  const serviceName = (id: string | null) =>
    id ? (service.get(id)?.name ?? 'A deleted service') : 'Any service';
  const price = (id: string) => service.get(id)?.priceMinor ?? null;
  const hoursOf = (b: ReportBooking) => (ms(b.endsAt) - ms(b.startsAt)) / HOUR;

  const confirmed = input.bookings.filter((b) => b.status === 'confirmed');
  const held = (b: ReportBooking) =>
    b.status === 'confirmed' && ms(b.startsAt) < now && b.attendance !== 'no_show';

  /* Headline, for a range. */
  function headlineFor(inRange: (iso: string | null) => boolean, open: OpenDay[]) {
    const made = input.bookings.filter((b) => inRange(b.createdAt));
    const due = confirmed.filter((b) => inRange(b.startsAt));
    const heldHere = due.filter(held);
    const hoursBooked = due.reduce((sum, b) => sum + hoursOf(b), 0);
    const hoursOpen = open.reduce(
      (sum, d) => sum + d.windows.reduce((s, w) => s + (w.endMinutes - w.startMinutes), 0) / 60,
      0,
    );
    const value = heldHere.reduce((sum, b) => sum + (price(b.eventTypeId) ?? 0), 0);
    const collected = input.payments
      .filter((p) => (p.status === 'paid' || p.status === 'refunded') && inRange(p.paidAt))
      .reduce((sum, p) => sum + p.amountMinor - p.refundedMinor, 0);

    const firstBooking = new Map<string, number>();
    for (const b of input.bookings) {
      const t = ms(b.createdAt);
      const e = b.email.toLowerCase();
      if (!firstBooking.has(e) || t < firstBooking.get(e)!) firstBooking.set(e, t);
    }
    const bookers = new Set(made.map((b) => b.email.toLowerCase()));
    let fresh = 0;
    let back = 0;
    for (const e of bookers) {
      if (inRange(new Date(firstBooking.get(e)!).toISOString())) fresh += 1;
      else back += 1;
    }
    const visits = input.visits.filter((v) => v.surface !== 'client_link' && inRange(v.visitedAt)).length;
    const ratings = input.ratings.filter((r) => inRange(r.createdAt));
    return {
      bookingsMade: made.length,
      sessionsHeld: heldHere.length,
      hoursBooked: round1(hoursBooked),
      hoursOpen: round1(hoursOpen),
      utilisation: hoursOpen > 0 ? Math.min(1, hoursBooked / hoursOpen) : null,
      value,
      collected,
      fresh,
      back,
      visits,
      ratingAverage: ratings.length ? ratings.reduce((s, r) => s + r.rating, 0) / ratings.length : null,
      ratingCount: ratings.length,
    };
  }

  const h = headlineFor(inCur, input.openDays);
  const hp = headlineFor(inPrev, input.previousOpenDays);
  const fig = (value: number, previous: number): Figure => ({ value, previous });
  const headline: Headline = {
    bookingsMade: fig(h.bookingsMade, hp.bookingsMade),
    sessionsHeld: fig(h.sessionsHeld, hp.sessionsHeld),
    hoursBooked: fig(h.hoursBooked, hp.hoursBooked),
    hoursOpen: fig(h.hoursOpen, hp.hoursOpen),
    utilisation: { value: h.utilisation, previous: hp.utilisation },
    valueEarnedMinor: fig(h.value, hp.value),
    collectedOnlineMinor: fig(h.collected, hp.collected),
    newClients: fig(h.fresh, hp.fresh),
    returningClients: fig(h.back, hp.back),
    visits: { value: h.visits, previous: input.visitsTracked ? hp.visits : null },
    rating: { average: h.ratingAverage, count: h.ratingCount, previousAverage: hp.ratingAverage },
  };

  /* The journey. */
  const responses = input.responses.filter((r) => inCur(r.createdAt));
  const started = responses.length;
  const through = responses.filter((r) => r.completedAt && r.outcomePathType === 'meeting').length;
  const bookedFromPage = input.bookings.filter((b) => inCur(b.createdAt) && !b.viaClientLink).length;
  const steps: FunnelStep[] = [];
  if (input.visitsTracked) steps.push({ id: 'visited', label: 'Visited your page', count: h.visits });
  if (started > 0) {
    steps.push({ id: 'started', label: 'Began your questions', count: started });
    steps.push({ id: 'through', label: 'Were offered your calendar', count: through });
  }
  steps.push({ id: 'booked', label: 'Booked', count: bookedFromPage });
  let worstDrop: Funnel['worstDrop'] = null;
  for (let i = 1; i < steps.length; i++) {
    const a = steps[i - 1]!;
    const b = steps[i]!;
    if (a.count < 10 || b.count > a.count) continue;
    const share = (a.count - b.count) / a.count;
    if (!worstDrop || share > worstDrop.share)
      worstDrop = { from: a.id, to: b.id, lost: a.count - b.count, share };
  }
  const funnel: Funnel = { steps, worstDrop };

  /* Ratings, by booking. */
  const bookingById = new Map(input.bookings.map((b) => [b.id, b]));
  const ratingsHere = input.ratings.filter((r) => inCur(r.createdAt));

  /* Came back: a later confirmed booking, any service, after this one. */
  const byEmail = new Map<string, ReportBooking[]>();
  for (const b of confirmed) {
    const e = b.email.toLowerCase();
    if (!byEmail.has(e)) byEmail.set(e, []);
    byEmail.get(e)!.push(b);
  }
  for (const list of byEmail.values()) list.sort((a, b) => ms(a.startsAt) - ms(b.startsAt));
  const cameBackAfter = (b: ReportBooking) =>
    (byEmail.get(b.email.toLowerCase()) ?? []).some((o) => o.id !== b.id && ms(o.startsAt) > ms(b.startsAt));

  /* Services. */
  const services: ServiceReport[] = input.services
    .map((s) => {
      const due = input.bookings.filter((b) => b.eventTypeId === s.id && inCur(b.startsAt));
      const dueConfirmed = due.filter((b) => b.status === 'confirmed');
      const heldHere = dueConfirmed.filter(held);
      const noShows = dueConfirmed.filter((b) => ms(b.startsAt) < now && b.attendance === 'no_show').length;
      const cancelled = due.filter((b) => b.status === 'cancelled').length;
      const hoursHeld = heldHere.reduce((sum, b) => sum + hoursOf(b), 0);
      const value = heldHere.length * (s.priceMinor ?? 0);
      const clients = new Map<string, ReportBooking>();
      for (const b of heldHere) {
        const e = b.email.toLowerCase();
        if (!clients.has(e) || ms(b.startsAt) > ms(clients.get(e)!.startsAt)) clients.set(e, b);
      }
      const cameBack = [...clients.values()].filter(cameBackAfter).length;
      const rated = ratingsHere.filter((r) => bookingById.get(r.bookingId)?.eventTypeId === s.id);
      const made = input.bookings.filter((b) => b.eventTypeId === s.id && inCur(b.createdAt));
      const lead = made.map((b) => (ms(b.startsAt) - ms(b.createdAt)) / DAY).filter((d) => d >= 0);
      const enquiries = responses.filter((r) => r.eventTypeId === s.id);
      const throughHere = enquiries.filter((r) => r.completedAt && r.outcomePathType === 'meeting').length;
      const madeFromPage = made.filter((b) => !b.viaClientLink).length;
      return {
        id: s.id,
        name: s.name,
        booked: made.length,
        held: heldHere.length,
        upcoming: dueConfirmed.filter((b) => ms(b.startsAt) >= now).length,
        noShows,
        cancelled,
        cancelRate: ratio(cancelled, due.length),
        hoursHeld: round1(hoursHeld),
        valueMinor: value,
        // Whole units: "€27 an hour" is a fact to act on; "€26.67" is noise.
        valuePerHourMinor: hoursHeld > 0 && s.priceMinor ? Math.round(value / hoursHeld / 100) * 100 : null,
        cameBackRate: ratio(cameBack, clients.size),
        rating: rated.length ? round1(rated.reduce((sum, r) => sum + r.rating, 0) / rated.length) : null,
        ratingCount: rated.length,
        medianLeadDays: lead.length ? round1(median(lead)!) : null,
        enquiries: enquiries.length,
        through: throughHere,
        conversion: throughHere > 0 ? Math.min(1, madeFromPage / throughHere) : null,
      };
    })
    .filter((s) => s.booked + s.held + s.upcoming + s.cancelled + s.enquiries > 0)
    .sort((a, b) => b.valueMinor - a.valueMinor || b.held - a.held);

  /* When: open against booked, by weekday and hour. */
  const cells = new Map<string, DemandCell>();
  const cell = (weekday: number, hour: number) => {
    const key = `${weekday}:${hour}`;
    if (!cells.has(key)) cells.set(key, { weekday, hour, openMinutes: 0, bookedMinutes: 0 });
    return cells.get(key)!;
  };
  for (const day of input.openDays) {
    for (const w of day.windows) {
      for (let m = w.startMinutes; m < w.endMinutes; ) {
        const hour = Math.floor(m / 60);
        const next = Math.min(w.endMinutes, (hour + 1) * 60);
        cell(day.weekday, hour).openMinutes += next - m;
        m = next;
      }
    }
  }
  for (const b of confirmed.filter((x) => inCur(x.startsAt))) {
    let t = DateTime.fromISO(b.startsAt, { zone: tz });
    const end = DateTime.fromISO(b.endsAt, { zone: tz });
    while (t < end) {
      const next = DateTime.min(end, t.startOf('hour').plus({ hours: 1 }));
      cell(t.weekday, t.hour).bookedMinutes += next.diff(t, 'minutes').minutes;
      t = next;
    }
  }
  const allCells = [...cells.values()].filter((c) => c.openMinutes > 0 || c.bookedMinutes > 0);
  // A continuous span, first open hour to last: a gap in the day is drawn
  // as a gap, not closed up so 11:00 sits beside 18:00.
  const used = allCells.map((c) => c.hour);
  const hours = used.length
    ? Array.from({ length: Math.max(...used) - Math.min(...used) + 1 }, (_, i) => Math.min(...used) + i)
    : [];
  const bands = new Map<string, DemandBand>();
  for (const c of allCells) {
    const part = partOfDay(c.hour);
    const key = `${c.weekday}:${part}`;
    if (!bands.has(key)) bands.set(key, { weekday: c.weekday, part, openHours: 0, bookedHours: 0, fill: 0 });
    const band = bands.get(key)!;
    band.openHours += c.openMinutes / 60;
    band.bookedHours += c.bookedMinutes / 60;
  }
  const bandList = [...bands.values()].map((b) => ({
    ...b,
    openHours: round1(b.openHours),
    bookedHours: round1(b.bookedHours),
    fill: b.openHours > 0 ? Math.min(1, b.bookedHours / b.openHours) : 0,
  }));
  const full = bandList.filter((b) => b.openHours >= 2 && b.fill >= 0.75).sort((a, b) => b.fill - a.fill);
  const quiet = bandList
    .filter((b) => b.openHours >= 4 && b.bookedHours === 0)
    .sort((a, b) => b.openHours - a.openHours);

  const madeHere = input.bookings.filter((b) => inCur(b.createdAt));
  const leadBuckets = [
    { label: 'Same day', max: 1 },
    { label: '1–2 days', max: 3 },
    { label: '3–7 days', max: 8 },
    { label: '1–2 weeks', max: 15 },
    { label: '2–4 weeks', max: 31 },
    { label: 'Over a month', max: Infinity },
  ];
  const lead = leadBuckets.map((bucket, i) => ({
    label: bucket.label,
    count: madeHere.filter((b) => {
      const d = (ms(b.startsAt) - ms(b.createdAt)) / DAY;
      const min = i === 0 ? -Infinity : leadBuckets[i - 1]!.max;
      return d >= min && d < bucket.max;
    }).length,
  }));
  const whenMade = new Map<string, number>();
  for (const b of madeHere) {
    const t = DateTime.fromISO(b.createdAt, { zone: tz });
    const key = `${t.weekday}:${partOfDay(t.hour)}`;
    whenMade.set(key, (whenMade.get(key) ?? 0) + 1);
  }
  const topMade = [...whenMade.entries()].sort((a, b) => b[1] - a[1])[0];
  const demand: Demand = {
    cells: allCells,
    hours,
    full,
    quiet,
    lead,
    bookedWhen:
      topMade && madeHere.length >= 8
        ? {
            weekday: Number(topMade[0].split(':')[0]),
            part: topMade[0].split(':')[1] as DemandBand['part'],
            count: topMade[1],
          }
        : null,
  };

  /* Clients. */
  const periodEnd = Math.min(cur.end, now);
  const activeClients = new Map<string, ReportBooking>();
  for (const b of confirmed.filter((x) => inCur(x.startsAt) && held(x))) {
    const e = b.email.toLowerCase();
    if (!activeClients.has(e) || ms(b.startsAt) > ms(activeClients.get(e)!.startsAt)) activeClients.set(e, b);
  }
  const gaps: number[] = [];
  for (const list of byEmail.values()) {
    const heldList = list.filter(held);
    for (let i = 1; i < heldList.length; i++) {
      if (inCur(heldList[i]!.startsAt))
        gaps.push((ms(heldList[i]!.startsAt) - ms(heldList[i - 1]!.startsAt)) / DAY);
    }
  }
  const quietClients: QuietClient[] = [];
  for (const [email, list] of byEmail) {
    const heldList = list.filter(held);
    if (heldList.length === 0) continue;
    if (list.some((b) => ms(b.startsAt) >= now)) continue;
    const last = heldList[heldList.length - 1]!;
    const away = (periodEnd - ms(last.startsAt)) / DAY;
    if (away >= 45 && away <= 180) {
      quietClients.push({ name: last.name, email, lastSession: last.startsAt, sessions: heldList.length });
    }
  }
  quietClients.sort((a, b) => b.sessions - a.sessions || ms(b.lastSession) - ms(a.lastSession));

  const packs = new Map<string, ReportBooking[]>();
  for (const b of input.bookings) {
    if (!b.packId) continue;
    if (!packs.has(b.packId)) packs.set(b.packId, []);
    packs.get(b.packId)!.push(b);
  }
  let running = 0;
  let completed = 0;
  const stalled: StalledProgramme[] = [];
  for (const list of packs.values()) {
    const size = list[0]!.packSize ?? list.length;
    const booked = list.filter((b) => b.status === 'confirmed');
    const done = booked.filter(held).length;
    const owed = Math.max(0, size - booked.length);
    const lastStart = booked.length ? Math.max(...booked.map((b) => ms(b.startsAt))) : null;
    const relevant = list.some((b) => inCur(b.startsAt) || inCur(b.createdAt)) || owed > 0;
    if (!relevant) continue;
    if (done >= size) {
      if (lastStart !== null && lastStart >= cur.start && lastStart < cur.end) completed += 1;
    } else if (owed > 0 && (lastStart === null || (lastStart < now && now - lastStart > 21 * DAY))) {
      stalled.push({
        name: list[0]!.name,
        email: list[0]!.email,
        serviceName: serviceName(list[0]!.eventTypeId),
        owed,
        lastSession: lastStart !== null ? new Date(lastStart).toISOString() : null,
      });
    } else {
      running += 1;
    }
  }

  const clients: ClientsReport = {
    active: activeClients.size,
    newClients: h.fresh,
    returning: h.back,
    cameBackRate: ratio([...activeClients.values()].filter(cameBackAfter).length, activeClients.size),
    medianDaysBetween: gaps.length ? Math.round(median(gaps)!) : null,
    programmes: { running, completed, stalled: stalled.slice(0, 8) },
    quiet: quietClients.slice(0, 8),
  };

  /* Money. */
  const paymentsHere = input.payments.filter(
    (p) => (p.status === 'paid' || p.status === 'refunded') && inCur(p.paidAt),
  );
  const depositsToCollect = paymentsHere
    .filter((p) => p.paymentMode === 'deposit' && p.eventTypeId)
    .reduce((sum, p) => {
      const s = service.get(p.eventTypeId!);
      if (!s?.priceMinor) return sum;
      const sessions = p.kind === 'pack' ? (s.packSize ?? 1) : 1;
      return sum + Math.max(0, s.priceMinor * sessions - p.amountMinor);
    }, 0);
  const paymentById = new Map(input.payments.map((p) => [p.id, p]));
  const lateKept = { count: 0, amountMinor: 0 };
  for (const b of input.bookings) {
    if (b.status !== 'cancelled' || b.cancelledBy !== 'client' || !inCur(b.cancelledAt) || !b.paymentId)
      continue;
    if (b.packId) continue;
    const p = paymentById.get(b.paymentId);
    if (!p || p.status !== 'paid' || p.refundedMinor >= p.amountMinor) continue;
    const ahead = (ms(b.startsAt) - ms(b.cancelledAt!)) / HOUR;
    if (ahead < input.noticeHours) {
      lateKept.count += 1;
      lateKept.amountMinor += p.amountMinor - p.refundedMinor;
    }
  }
  const money: MoneyReport = {
    valueEarnedMinor: h.value,
    collectedOnlineMinor: h.collected,
    refundedMinor: paymentsHere.reduce((sum, p) => sum + p.refundedMinor, 0),
    depositsToCollectMinor: depositsToCollect,
    lateKept,
    bookedAheadMinor: confirmed
      .filter((b) => ms(b.startsAt) >= now && ms(b.startsAt) < now + 30 * DAY)
      .reduce((sum, b) => sum + (price(b.eventTypeId) ?? 0), 0),
    byService: services
      .filter((s) => s.valueMinor > 0)
      .map((s) => ({ id: s.id, name: s.name, valueMinor: s.valueMinor })),
  };

  /* Cancellations and no-shows. */
  const cancelledHere = input.bookings.filter((b) => b.status === 'cancelled' && inCur(b.cancelledAt));
  const aheadHours = cancelledHere.map((b) => (ms(b.startsAt) - ms(b.cancelledAt!)) / HOUR);
  const dueHere = input.bookings.filter((b) => inCur(b.startsAt));
  const pastConfirmed = confirmed.filter((b) => inCur(b.startsAt) && ms(b.startsAt) < now);
  const marked = pastConfirmed.filter((b) => b.attendance !== null);
  const noShows = pastConfirmed.filter((b) => b.attendance === 'no_show').length;
  const cancellations: CancellationsReport = {
    count: cancelledHere.length,
    byClient: cancelledHere.filter((b) => b.cancelledBy === 'client').length,
    byBusiness: cancelledHere.filter((b) => b.cancelledBy === 'business').length,
    unknown: cancelledHere.filter((b) => !b.cancelledBy).length,
    rate: ratio(dueHere.filter((b) => b.status === 'cancelled').length, dueHere.length),
    medianHoursAhead: aheadHours.length ? Math.round(median(aheadHours)!) : null,
    late: cancelledHere.filter(
      (b) => b.cancelledBy !== 'business' && (ms(b.startsAt) - ms(b.cancelledAt!)) / HOUR < input.noticeHours,
    ).length,
    noShows,
    noShowRate: ratio(noShows, marked.length),
    marked: marked.length,
    past: pastConfirmed.length,
    moved: dueHere.filter((b) => b.rescheduleCount > 0).length,
    reasons: cancelledHere
      .filter((b) => b.cancellationReason && b.cancellationReason.trim())
      .sort((a, b) => ms(b.cancelledAt!) - ms(a.cancelledAt!))
      .slice(0, 6)
      .map((b) => ({
        reason: b.cancellationReason!.trim().slice(0, 300),
        at: b.cancelledAt!,
        serviceName: serviceName(b.eventTypeId),
        by: b.cancelledBy,
      })),
  };

  /* Where people come from. */
  const sourceRows = new Map<string, SourceRow>();
  const row = (source: string) => {
    if (!sourceRows.has(source)) {
      sourceRows.set(source, {
        source,
        label: sourceLabel(source),
        visits: 0,
        bookings: 0,
        conversion: null,
      });
    }
    return sourceRows.get(source)!;
  };
  for (const v of input.visits.filter((x) => inCur(x.visitedAt))) {
    row(v.surface === 'client_link' ? 'client_link' : v.source).visits += 1;
  }
  for (const b of madeHere) row(b.viaClientLink ? 'client_link' : (b.source ?? 'direct')).bookings += 1;
  const sources = [...sourceRows.values()]
    .map((r) => ({
      ...r,
      conversion: input.visitsTracked && r.visits > 0 ? Math.min(1, r.bookings / r.visits) : null,
    }))
    .sort((a, b) => b.bookings - a.bookings || b.visits - a.visits);

  /* Ratings. */
  const ratings: RatingsReport = {
    count: ratingsHere.length,
    average: ratingsHere.length
      ? round1(ratingsHere.reduce((s, r) => s + r.rating, 0) / ratingsHere.length)
      : null,
    distribution: [5, 4, 3, 2, 1].map((n) => ({
      rating: n,
      count: ratingsHere.filter((r) => r.rating === n).length,
    })),
    comments: ratingsHere
      .filter((r) => r.comment && r.comment.trim())
      .sort((a, b) => ms(b.createdAt) - ms(a.createdAt))
      .slice(0, 6)
      .map((r) => ({
        rating: r.rating,
        comment: r.comment!.trim().slice(0, 400),
        serviceName: serviceName(bookingById.get(r.bookingId)?.eventTypeId ?? null),
        at: r.createdAt,
      })),
  };

  const questions = analyseQuestions(responses).filter((q) => q.answered > 0);

  const report: Omit<Report, 'findings'> = {
    period: input.period,
    previous: input.previous,
    headline,
    funnel,
    services,
    demand,
    clients,
    money,
    cancellations,
    sources,
    ratings,
    questions,
    tracking: {
      visits: input.visitsTracked,
      attendanceMarked: marked.length,
      sessionsPast: pastConfirmed.length,
      ratings: input.ratings.length,
    },
  };
  return { ...report, findings: findings(report, currency) };
}

/* ── What to change ───────────────────────────────────────────────────── */

/**
 * The notes at the top: the few things most worth acting on this period,
 * each with the place to act. Ochre ("need") before Mineral ("good"), and
 * never more than six — a page of advice is a page nobody reads. Every rule
 * needs enough to go on; a note drawn from three bookings would be a guess.
 */
export function findings(r: Omit<Report, 'findings'>, currency: string): Finding[] {
  const need: Finding[] = [];
  const good: Finding[] = [];
  const steps = new Map(r.funnel.steps.map((s) => [s.id, s.count]));

  // The journey.
  const visited = steps.get('visited');
  const started = steps.get('started');
  const through = steps.get('through');
  const booked = steps.get('booked') ?? 0;
  if (visited !== undefined && visited >= 20 && started !== undefined && started / visited < 0.3) {
    need.push({
      id: 'visitors-leave',
      tone: 'need',
      title: `Most visitors leave before starting — ${visited - started} of ${visited}`,
      detail:
        'They open your page and go. Look at it as a stranger would: is it clear what you offer, for whom, and what it costs?',
      action: { label: 'Try your booking page', href: 'flow' },
    });
  }
  if (started !== undefined && through !== undefined && started >= 10 && through / started < 0.5) {
    const worst = r.questions
      .filter((q) => q.sentElsewhere > 0)
      .sort((a, b) => b.sentElsewhere - a.sentElsewhere)[0];
    need.push({
      id: 'questions-send-away',
      tone: 'need',
      title: `Your questions send ${pct(1 - through / started)} of people elsewhere`,
      detail: worst
        ? `“${worst.prompt}” does most of it: ${worst.sentElsewhere} of ${worst.answered}${
            worst.routingAnswers[0] ? `, mostly answering “${worst.routingAnswers[0].answer}”` : ''
          }. If that is who you want to reach, change the rule.`
        : 'If the people turned away are people you would like to meet, loosen the rule on the question that does it.',
      action: { label: 'Review your questions', href: 'screening' },
    });
  }
  if (through !== undefined && through >= 8 && booked / through < 0.5) {
    need.push({
      id: 'no-time-chosen',
      tone: 'need',
      title: `Half of those offered your calendar don’t book — ${through - booked} of ${through}`,
      detail:
        'They got through your questions and then did not find a time. Usually there are not enough of them, or not the right ones.',
      action: { label: 'Open more hours', href: 'week' },
    });
  }

  // When.
  const full = r.demand.full[0];
  if (full) {
    good.push({
      id: 'band-full',
      tone: 'good',
      title: `${bandName(full.weekday, full.part)} are ${pct(full.fill)} booked`,
      detail:
        'That is where people want you. Opening a little more there is the likeliest way to more bookings.',
      action: { label: 'Paint more hours', href: 'week' },
    });
  }
  const quiet = r.demand.quiet[0];
  if (quiet) {
    need.push({
      id: 'band-quiet',
      tone: 'need',
      title: `${bandName(quiet.weekday, quiet.part)}: ${quiet.openHours} open hours, nothing booked`,
      detail:
        'Nobody chose them in this period. Close them and give the time to what is full, or keep them as your own.',
      action: { label: 'Change your hours', href: 'week' },
    });
  }
  const utilisation = r.headline.utilisation.value;
  if (utilisation !== null && r.headline.hoursOpen.value >= 10) {
    if (utilisation >= 0.85) {
      good.push({
        id: 'nearly-full',
        tone: 'good',
        title: `You were ${pct(utilisation)} booked`,
        detail:
          'Nearly full. This is the moment to raise a price or open more hours, not to find more clients.',
        action: { label: 'Review your prices', href: 'flow' },
      });
    } else if (utilisation < 0.25 && r.headline.hoursOpen.value >= 20) {
      need.push({
        id: 'mostly-empty',
        tone: 'need',
        title: `${Math.round(r.headline.hoursOpen.value - r.headline.hoursBooked.value)} open hours went unbooked`,
        detail: `Only ${pct(utilisation)} of the time you offered was taken. Fewer, better-placed hours make a page look in demand.`,
        action: { label: 'Look at your week', href: 'week' },
      });
    }
  }

  // Showing up.
  const c = r.cancellations;
  if (c.noShowRate !== null && c.marked >= 5 && c.noShowRate >= 0.15) {
    const worst = [...r.services].sort((a, b) => b.noShows - a.noShows)[0];
    need.push({
      id: 'no-shows',
      tone: 'need',
      title: `${pct(c.noShowRate)} of people didn’t come`,
      detail:
        'A small deposit when booking is the surest cure; a reminder the day before already goes out.' +
        (worst && worst.noShows > 0 ? ` Most were for ${worst.name}.` : ''),
      action: worst ? { label: 'Ask for a deposit', href: `sessions/${worst.id}` } : undefined,
    });
  }
  if (c.count >= 5 && c.late / c.count >= 0.3) {
    need.push({
      id: 'late-cancellations',
      tone: 'need',
      title: `${c.late} of ${c.count} cancellations came late`,
      detail:
        'Inside your minimum notice, when the time is hard to fill again. A deposit that is kept on late cancellation changes this.',
      action: { label: 'See payment settings', href: 'account' },
    });
  }

  // Services.
  const priced = r.services.filter((s) => s.valuePerHourMinor !== null && s.held >= 3);
  if (priced.length >= 2) {
    const sorted = [...priced].sort((a, b) => b.valuePerHourMinor! - a.valuePerHourMinor!);
    const best = sorted[0]!;
    const worst = sorted[sorted.length - 1]!;
    if (worst.valuePerHourMinor! < best.valuePerHourMinor! * 0.6) {
      need.push({
        id: 'low-value-service',
        tone: 'need',
        title: `${worst.name} earns ${formatMinor(worst.valuePerHourMinor!, currency)} an hour; ${best.name} ${formatMinor(best.valuePerHourMinor!, currency)}`,
        detail: 'Same hour of your time, a fraction of the return. Reprice it, shorten it, or offer it less.',
        action: { label: `Open ${worst.name}`, href: `sessions/${worst.id}` },
      });
    }
  }
  for (const s of r.services) {
    if (s.rating !== null && s.ratingCount >= 3 && s.rating < 3.5) {
      need.push({
        id: `low-rating-${s.id}`,
        tone: 'need',
        title: `${s.name} is rated ${s.rating} out of 5`,
        detail:
          'Read what people said below. A service people rate low is rarely rebooked, and never recommended.',
      });
    }
  }
  if (r.ratings.average !== null && r.ratings.count >= 5 && r.ratings.average >= 4.6) {
    good.push({
      id: 'rated-well',
      tone: 'good',
      title: `Rated ${r.ratings.average} out of 5 by ${r.ratings.count} clients`,
      detail:
        'Worth saying on your page and your website: it is the most convincing thing a stranger can read.',
    });
  }

  // Clients.
  if (r.clients.quiet.length >= 3) {
    need.push({
      id: 'quiet-clients',
      tone: 'need',
      title: `${r.clients.quiet.length} clients haven’t been back in over six weeks`,
      detail:
        'People who have worked with you before are the easiest to book. Send them their own link — it takes a click.',
      action: { label: 'Open People', href: 'people' },
    });
  }
  if (r.clients.programmes.stalled.length >= 1) {
    const n = r.clients.programmes.stalled.length;
    need.push({
      id: 'stalled-programmes',
      tone: 'need',
      title: n === 1 ? '1 programme has stalled' : `${n} programmes have stalled`,
      detail:
        'Sessions paid for or promised, and nothing booked for three weeks. A short message usually restarts it.',
      action: { label: 'Open People', href: 'people' },
    });
  }

  // Sources.
  const fromSources = r.sources.filter((s) => s.source !== 'client_link');
  const totalBooked = fromSources.reduce((sum, s) => sum + s.bookings, 0);
  const top = fromSources[0];
  if (top && totalBooked >= 8 && top.bookings / totalBooked >= 0.4 && top.source !== 'direct') {
    good.push({
      id: 'top-source',
      tone: 'good',
      title: `${top.label} brought ${pct(top.bookings / totalBooked)} of your bookings`,
      detail: 'Your best channel this period. Put your booking link wherever you post there.',
    });
  }
  const deadSource = fromSources.find((s) => s.visits >= 30 && s.bookings === 0);
  if (deadSource) {
    need.push({
      id: `dead-source-${deadSource.source}`,
      tone: 'need',
      title: `${deadSource.visits} visits from ${deadSource.label}, no bookings`,
      detail:
        'People arrive from there and do not book. What they read before clicking may promise something your page does not.',
    });
  }

  return [...need, ...good].slice(0, 6);
}
