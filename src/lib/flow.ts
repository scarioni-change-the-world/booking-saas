import { formatMoney } from './money';
import { setupStages, blockers, loose, type ServiceFacts, type Stage } from './service-setup';
import { monogram, serviceColour } from './service-identity';
import type { QuestionInsight, ServiceInsight } from './enquiry-analysis';

/**
 * The arithmetic behind Flow, the home screen: how somebody reaches a
 * business, drawn as the pipeline it is.
 *
 * Two ways in — the booking page, where strangers meet the questions, and a
 * client's own link, which skips them. Each service is a lane. The numbers
 * on the lines are the last 30 days moving through, and a service that is
 * not finished has its missing connections drawn as gaps rather than listed
 * on a page of its own.
 *
 * Pure and client-safe. The diagram, the plain list that stands in for it
 * on a phone and for a screen reader, and the tests all read this one
 * model, so the three can never disagree about what the flow is.
 */

export interface FlowService {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceMinor: number | null;
  locationKind: string | null;
  locationDetail: string | null;
  bookingMode: 'single' | 'pack';
  packSize: number | null;
  availableToProspects: boolean;
  availableToExistingClients: boolean;
  active: boolean;
  ownQuestionCount: number;
  /** One of the six service colours — see service-identity.ts. */
  color: string;
}

export interface FlowInput {
  tenant: { slug: string; name: string; currency: string };
  /** New enquiries over 30 days, and returning ones counted apart — loadFunnelStats. */
  funnel: { started: number; completed: number; meeting: number; other: number; returning: number };
  globalQuestionCount: number;
  availabilityRuleCount: number;
  hasOtherPathMessage: boolean;
  hasOtherPathUrl: boolean;
  otherPathLabel: string | null;
  services: FlowService[];
  questionInsights: QuestionInsight[];
  serviceInsights: ServiceInsight[];
  /** Bookings made in the last 30 days. */
  bookings: Array<{ eventTypeId: string; status: 'confirmed' | 'cancelled'; byExistingClient: boolean }>;
  weeklyMinutes: number;
  calendarStatus: 'not_connected' | 'active' | 'needs_reconnect' | 'revoked';
  syncFailures: number;
  emailFailures: number;
  clientCount: number;
}

export type PartId = 'page' | 'clients' | 'questions' | 'elsewhere' | 'calendar' | 'booked' | `service:${string}`;

export interface Lane {
  id: string;
  part: PartId;
  name: string;
  /** How it is recognised at a glance, here and on the Week. */
  color: string;
  monogram: string;
  /** Price and length, or the first thing missing. */
  sub: string;
  fromPage: boolean;
  fromClients: boolean;
  /** Offered to somebody, and nothing is stopping it. */
  live: boolean;
  /** New enquiries the questions let through to this service. */
  qualified: number;
  /** Everyone who booked it, in 30 days. */
  booked: number;
  /** Of those, people who were already clients. */
  bookedByClients: number;
  blocking: Stage[];
  loose: Stage[];
}

export interface FlowModel {
  lanes: Lane[];
  archived: Array<{ id: string; name: string }>;
  page: { arrived: number; returning: number };
  clients: { count: number; booked: number; offered: string[] };
  questions: { count: number; started: number; finished: number; leftPartway: number };
  elsewhere: { count: number; said: boolean; label: string | null };
  calendar: { weeklyMinutes: number; noHours: boolean; flag: string | null };
  booked: { total: number; flag: string | null };
}

function laneSub(s: FlowService, currency: string, stages: Stage[]): string {
  const stopped = blockers(stages)[0];
  if (stopped && stopped.id === 'review') return 'offered to nobody';
  if (stopped && stopped.id === 'rules') return 'programme size missing';
  const price = s.priceMinor !== null ? formatMoney(s.priceMinor, currency) : 'price —';
  const length = s.bookingMode === 'pack' && s.packSize ? `${s.packSize} × ${s.durationMinutes} min` : `${s.durationMinutes} min`;
  return `${price} · ${length}`;
}

export function buildFlow(input: FlowInput): FlowModel {
  const active = input.services.filter((s) => s.active);
  const insight = new Map(input.serviceInsights.map((i) => [i.eventTypeId, i]));

  const lanes: Lane[] = active.map((s) => {
    const facts: ServiceFacts = {
      id: s.id,
      name: s.name,
      description: s.description,
      durationMinutes: s.durationMinutes,
      priceMinor: s.priceMinor,
      locationKind: s.locationKind,
      locationDetail: s.locationDetail,
      bookingMode: s.bookingMode,
      packSize: s.packSize,
      availableToProspects: s.availableToProspects,
      availableToExistingClients: s.availableToExistingClients,
      ownQuestionCount: s.ownQuestionCount,
      globalQuestionCount: input.globalQuestionCount,
      availabilityRuleCount: input.availabilityRuleCount,
      hasOtherPathMessage: input.hasOtherPathMessage,
      hasOtherPathUrl: input.hasOtherPathUrl,
    };
    /* Only this service's own gaps. Hours and the next-steps message are
       the whole business's, and are drawn once — on Calendar and on
       Elsewhere — rather than as a gap on every lane. */
    const stages = setupStages(facts).filter((st) => st.scope === 'service');
    const mine = input.bookings.filter((b) => b.eventTypeId === s.id && b.status === 'confirmed');
    return {
      id: s.id,
      part: `service:${s.id}` as PartId,
      name: s.name,
      color: serviceColour(s.color),
      monogram: monogram(s.name),
      sub: laneSub(s, input.tenant.currency, stages),
      fromPage: s.availableToProspects,
      fromClients: s.availableToExistingClients,
      live: blockers(stages).length === 0,
      qualified: insight.get(s.id)?.meeting ?? 0,
      booked: mine.length,
      bookedByClients: mine.filter((b) => b.byExistingClient).length,
      blocking: blockers(stages),
      loose: loose(stages),
    };
  });

  const confirmed = input.bookings.filter((b) => b.status === 'confirmed');
  const calendarFlag =
    input.calendarStatus === 'needs_reconnect' || input.calendarStatus === 'revoked'
      ? 'Google Calendar needs reconnecting'
      : input.syncFailures > 0
        ? `${input.syncFailures} not in your calendar`
        : null;

  return {
    lanes,
    archived: input.services.filter((s) => !s.active).map((s) => ({ id: s.id, name: s.name })),
    page: { arrived: input.funnel.started, returning: input.funnel.returning },
    clients: {
      count: input.clientCount,
      booked: confirmed.filter((b) => b.byExistingClient).length,
      offered: active.filter((s) => s.availableToExistingClients).map((s) => s.name),
    },
    questions: {
      count: input.globalQuestionCount,
      started: input.funnel.started,
      finished: input.funnel.completed,
      leftPartway: Math.max(0, input.funnel.started - input.funnel.completed),
    },
    elsewhere: {
      count: input.funnel.other,
      said: input.hasOtherPathMessage || input.hasOtherPathUrl,
      label: input.otherPathLabel,
    },
    calendar: {
      weeklyMinutes: input.weeklyMinutes,
      noHours: input.availabilityRuleCount === 0,
      flag: calendarFlag,
    },
    booked: {
      total: confirmed.length,
      flag: input.emailFailures > 0 ? `${input.emailFailures} ${input.emailFailures === 1 ? 'email' : 'emails'} did not arrive` : null,
    },
  };
}

/* ── Drawing it ────────────────────────────────────────────────────────── */

export interface DrawnNode {
  part: PartId;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  sub: string;
  tone: 'door' | 'part' | 'exit' | 'end' | 'broken';
  flag: string | null;
  /** A service's own colour and mark; absent on every other part. */
  color?: string;
  monogram?: string;
}

export interface DrawnEdge {
  id: string;
  d: string;
  label: string | null;
  lx: number;
  ly: number;
  anchor: 'start' | 'middle' | 'end';
  tone: 'on' | 'out' | 'gap';
  /** Lines into and out of a lane are drawn in that service's colour. */
  color?: string;
}

export interface FlowDrawing {
  width: number;
  height: number;
  nodes: DrawnNode[];
  edges: DrawnEdge[];
}

const COL = { door: 10, questions: 210, service: 420, calendar: 700, booked: 900 };
const W = { door: 150, questions: 150, service: 220, calendar: 150, booked: 130 };
const NODE_H = 62;
const LANE_GAP = 88;
const TOP = 120;

function curve(x1: number, y1: number, x2: number, y2: number): string {
  if (y1 === y2) return `M${x1} ${y1} H${x2}`;
  const mx = (x1 + x2) / 2;
  return `M${x1} ${y1} C${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
}

/**
 * A line that runs level first and turns only at the end — for the client
 * door, which sits below the lanes: rising straight away would cut through
 * the questions, which is exactly the part those people skip.
 */
function elbow(x1: number, y1: number, x2: number, y2: number): string {
  if (y1 === y2) return `M${x1} ${y1} H${x2}`;
  const turn = x2 - 44;
  return `M${x1} ${y1} H${turn} C${x2 - 14} ${y1}, ${turn} ${y2}, ${x2} ${y2}`;
}

function hours(minutes: number): string {
  const h = minutes / 60;
  return Number.isInteger(h) ? `${h} h` : `${h.toFixed(1)} h`;
}

/**
 * Where everything goes. Services stack as lanes; the questions sit level
 * with the lanes that come through them, and a client's own link level with
 * the ones that come through it, so every line runs the way people do.
 */
export function drawFlow(model: FlowModel, slug: string): FlowDrawing {
  const lanes = model.lanes;
  const laneY = (i: number) => TOP + i * LANE_GAP;
  const lanesBottom = lanes.length > 0 ? laneY(lanes.length - 1) + NODE_H : TOP + NODE_H;

  const centreOf = (indices: number[], fallback: number) =>
    indices.length === 0
      ? fallback
      : (laneY(Math.min(...indices)) + laneY(Math.max(...indices))) / 2;

  const pageLanes = lanes.map((l, i) => (l.fromPage || !l.fromClients ? i : -1)).filter((i) => i >= 0);
  const clientLanes = lanes.map((l, i) => (l.fromClients ? i : -1)).filter((i) => i >= 0);

  const questionsY = centreOf(pageLanes, TOP);
  const clientsY = Math.max(lanesBottom + 30, centreOf(clientLanes, lanesBottom + 30));
  const calendarY = centreOf(lanes.map((_, i) => i), TOP);
  const height = clientsY + NODE_H + 20;

  const nodes: DrawnNode[] = [
    {
      part: 'elsewhere',
      x: COL.questions,
      y: 18,
      w: W.questions,
      h: 54,
      title: 'Elsewhere',
      sub: model.elsewhere.said ? (model.elsewhere.label ?? 'your message') : 'nothing written',
      tone: 'exit',
      flag: model.elsewhere.said ? null : 'Nothing written',
    },
    {
      part: 'page',
      x: COL.door,
      y: questionsY,
      w: W.door,
      h: NODE_H,
      title: 'Your page',
      sub: `/t/${slug}`,
      tone: 'door',
      flag: null,
    },
    {
      part: 'questions',
      x: COL.questions,
      y: questionsY,
      w: W.questions,
      h: NODE_H,
      title: 'Questions',
      sub:
        model.questions.count === 0
          ? 'nothing asked'
          : `${model.questions.count} · ${model.questions.finished} finished`,
      tone: 'part',
      flag: null,
    },
    {
      part: 'clients',
      x: COL.door,
      y: clientsY,
      w: W.door,
      h: NODE_H,
      title: 'Existing clients',
      sub: 'own link, no questions',
      tone: 'door',
      flag: null,
    },
    {
      part: 'calendar',
      x: COL.calendar,
      y: calendarY,
      w: W.calendar,
      h: NODE_H,
      title: 'Calendar',
      sub: model.calendar.noHours ? 'no hours' : `${hours(model.calendar.weeklyMinutes)} a week`,
      tone: model.calendar.noHours ? 'broken' : 'part',
      flag: model.calendar.flag,
    },
    {
      part: 'booked',
      x: COL.booked,
      y: calendarY,
      w: W.booked,
      h: NODE_H,
      title: 'Booked',
      sub: `${model.booked.total} in 30 days`,
      tone: 'end',
      flag: model.booked.flag,
    },
    ...lanes.map<DrawnNode>((l, i) => ({
      part: l.part,
      x: COL.service,
      y: laneY(i),
      w: W.service,
      h: NODE_H,
      title: l.name,
      sub: l.sub,
      tone: l.live ? 'part' : 'broken',
      flag: null,
      color: l.color,
      monogram: l.monogram,
    })),
  ];

  const mid = (y: number, h = NODE_H) => y + h / 2;
  const edges: DrawnEdge[] = [
    {
      id: 'page-questions',
      d: `M${COL.door + W.door} ${mid(questionsY)} H${COL.questions}`,
      label: String(model.page.arrived),
      lx: (COL.door + W.door + COL.questions) / 2,
      ly: mid(questionsY) - 8,
      anchor: 'middle',
      tone: 'on',
    },
    {
      id: 'questions-elsewhere',
      d: `M${COL.questions + W.questions / 2} ${questionsY} V${18 + 54}`,
      label: String(model.elsewhere.count),
      lx: COL.questions + W.questions / 2 + 10,
      ly: (questionsY + 72) / 2 + 4,
      anchor: 'start',
      tone: 'out',
    },
  ];

  lanes.forEach((l, i) => {
    const y = mid(laneY(i));
    const into = COL.service;
    if (l.fromPage) {
      edges.push({
        id: `questions-${l.id}`,
        d: curve(COL.questions + W.questions, mid(questionsY), into, y - (l.fromClients ? 8 : 0)),
        label: String(l.qualified),
        lx: into - 10,
        ly: y - (l.fromClients ? 8 : 0) - 7,
        anchor: 'end',
        tone: 'on',
        color: l.color,
      });
    }
    if (l.fromClients) {
      edges.push({
        id: `clients-${l.id}`,
        d: elbow(COL.door + W.door, mid(clientsY), into, y + (l.fromPage ? 8 : 0)),
        label: String(l.bookedByClients),
        lx: into - 10,
        ly: y + (l.fromPage ? 8 : 0) + 15,
        anchor: 'end',
        tone: 'on',
        color: l.color,
      });
    }
    if (!l.fromPage && !l.fromClients) {
      /* The broken line: where this lane would join. Why it does not is
         said on the lane itself, so the line carries no second copy. */
      edges.push({
        id: `gap-${l.id}`,
        d: curve(COL.questions + W.questions, mid(questionsY), into, y),
        label: null,
        lx: into - 10,
        ly: y - 7,
        anchor: 'end',
        tone: 'gap',
      });
    }
    const reachesCalendar = !model.calendar.noHours && (l.fromPage || l.fromClients);
    edges.push({
      id: `${l.id}-calendar`,
      d: curve(COL.service + W.service, y, COL.calendar, mid(calendarY)),
      label: reachesCalendar ? String(l.booked) : null,
      lx: COL.service + W.service + 10,
      ly: y - 7,
      anchor: 'start',
      tone: reachesCalendar ? 'on' : 'gap',
      color: reachesCalendar ? l.color : undefined,
    });
  });

  edges.push({
    id: 'calendar-booked',
    d: `M${COL.calendar + W.calendar} ${mid(calendarY)} H${COL.booked}`,
    label: String(model.booked.total),
    lx: (COL.calendar + W.calendar + COL.booked) / 2,
    ly: mid(calendarY) - 8,
    anchor: 'middle',
    tone: model.calendar.noHours ? 'gap' : 'on',
  });

  return { width: COL.booked + W.booked + 10, height, nodes, edges };
}

/**
 * The flow in words, for the screen reader and for anyone who would
 * rather read it: the same parts, the same counts, in the order people
 * move through them.
 */
export function describeFlow(model: FlowModel): string {
  const parts = [
    `${model.page.arrived} new ${model.page.arrived === 1 ? 'person' : 'people'} reached your page in the last 30 days`,
    `${model.questions.finished} finished the questions`,
    `${model.elsewhere.count} were sent elsewhere`,
    ...model.lanes.map((l) =>
      l.fromPage || l.fromClients
        ? `${l.name}: ${l.qualified} let through, ${l.booked} booked`
        : `${l.name} is offered to nobody`,
    ),
    `${model.clients.booked} ${model.clients.booked === 1 ? 'booking was' : 'bookings were'} by people who were already clients`,
    `${model.booked.total} bookings in total`,
  ];
  return `${parts.join('. ')}.`;
}
