import { formatMoney } from './money';
import { setupStages, blockers, loose, type ServiceFacts, type Stage } from './service-setup';
import { monogram, serviceColour } from './service-identity';
import type { QuestionInsight, ServiceInsight } from './enquiry-analysis';

/**
 * The arithmetic behind Flow, the home screen: how somebody reaches a
 * business, drawn as the pipeline it is — one service at a time.
 *
 * Each service has its own flow because that is how the booking page runs:
 * a person picks the service first, then answers that service's questions
 * (the shared ones and its own), then sees the calendar. The first version
 * drew one set of questions in front of every service, which put the steps
 * in the wrong order and made each service's numbers a guess.
 *
 * Two ways in — the booking page, where strangers meet the questions, and a
 * client's own link, which skips them. The numbers on the lines are the
 * last 30 days moving through. A service that is not finished has its
 * missing connections drawn as gaps rather than listed on a page of its own.
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
  /** Which questions turn people away, counted per service. */
  questionInsightsByService: Record<string, QuestionInsight[]>;
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
  /** New enquiries who chose it and started its questions. */
  started: number;
  finished: number;
  /** New enquiries the questions let through to this service. */
  qualified: number;
  sentElsewhere: number;
  /** Everyone who booked it, in 30 days. */
  booked: number;
  /** Of those, people who were already clients. */
  bookedByClients: number;
  /** Questions a new enquiry is asked for this service: shared, and its own. */
  sharedQuestions: number;
  ownQuestions: number;
  questionInsights: QuestionInsight[];
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
      started: insight.get(s.id)?.started ?? 0,
      finished: insight.get(s.id)?.completed ?? 0,
      qualified: insight.get(s.id)?.meeting ?? 0,
      sentElsewhere: insight.get(s.id)?.other ?? 0,
      booked: mine.length,
      bookedByClients: mine.filter((b) => b.byExistingClient).length,
      sharedQuestions: input.globalQuestionCount,
      ownQuestions: s.ownQuestionCount,
      questionInsights: input.questionInsightsByService[s.id] ?? [],
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

/* ── Drawing one service ───────────────────────────────────────────────── */

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
  /** The service's lines are drawn in its colour. */
  color?: string;
}

export interface FlowDrawing {
  width: number;
  height: number;
  nodes: DrawnNode[];
  edges: DrawnEdge[];
}

const NODE_H = 62;
const ROW_A = 110;
const ROW_B = 250;
const X = { door: 10, service: 200, questions: 460, calendar: 680, booked: 870 };
const W = { door: 150, service: 220, questions: 180, calendar: 150, booked: 130 };

function hours(minutes: number): string {
  const h = minutes / 60;
  return Number.isInteger(h) ? `${h} h` : `${h.toFixed(1)} h`;
}

/** Whether a new enquiry is asked anything before the calendar for this service. */
export function asksQuestions(lane: Lane): boolean {
  return lane.sharedQuestions + lane.ownQuestions > 0;
}

/** New enquiries who booked this service, as opposed to existing clients. */
export function bookedByNew(lane: Lane): number {
  return lane.booked - lane.bookedByClients;
}

/**
 * One service's flow, in the order the booking page runs it: your page, the
 * service, its questions, the calendar, booked. Existing clients come in
 * below, choose the service on their own link, and pass under the questions
 * straight to the calendar — drawn as exactly that.
 */
export function drawServiceFlow(model: FlowModel, lane: Lane, slug: string): FlowDrawing {
  const mid = ROW_A + NODE_H / 2;
  const midB = ROW_B + NODE_H / 2;
  const asks = asksQuestions(lane);
  const noHours = model.calendar.noHours;
  const c = lane.color;

  const nodes: DrawnNode[] = [
    {
      part: 'page',
      x: X.door,
      y: ROW_A,
      w: W.door,
      h: NODE_H,
      title: 'Your page',
      sub: `/t/${slug}`,
      tone: 'door',
      flag: null,
    },
    {
      part: lane.part,
      x: X.service,
      y: ROW_A,
      w: W.service,
      h: NODE_H,
      title: lane.name,
      sub: lane.sub,
      tone: lane.live ? 'part' : 'broken',
      flag: null,
      color: c,
      monogram: lane.monogram,
    },
    {
      part: 'questions',
      x: X.questions,
      y: ROW_A,
      w: W.questions,
      h: NODE_H,
      title: 'Questions',
      sub: asks
        ? `${lane.sharedQuestions + lane.ownQuestions} asked · ${lane.finished}/${lane.started} done`
        : 'nothing asked',
      tone: 'part',
      flag: null,
    },
    {
      part: 'elsewhere',
      x: X.questions,
      y: 12,
      w: W.questions,
      h: 54,
      title: 'Elsewhere',
      sub: model.elsewhere.said ? (model.elsewhere.label ?? 'your message') : 'nothing written',
      tone: 'exit',
      flag: model.elsewhere.said || !asks ? null : 'Nothing written',
    },
    {
      part: 'calendar',
      x: X.calendar,
      y: ROW_A,
      w: W.calendar,
      h: NODE_H,
      title: 'Calendar',
      sub: noHours ? 'no hours' : `${hours(model.calendar.weeklyMinutes)} a week`,
      tone: noHours ? 'broken' : 'part',
      flag: model.calendar.flag,
    },
    {
      part: 'booked',
      x: X.booked,
      y: ROW_A,
      w: W.booked,
      h: NODE_H,
      title: 'Booked',
      sub: `${lane.booked} in 30 days`,
      tone: 'end',
      flag: model.booked.flag,
    },
    {
      part: 'clients',
      x: X.door,
      y: ROW_B,
      w: W.door,
      h: NODE_H,
      title: 'Existing clients',
      sub: 'own link, no questions',
      tone: 'door',
      flag: null,
    },
  ];

  const newWay = lane.fromPage;
  const clientWay = lane.fromClients;
  const inAt = X.service + 40;
  const outAt = X.service + W.service - 40;

  const edges: DrawnEdge[] = [
    {
      id: 'page-service',
      d: `M${X.door + W.door} ${mid} H${X.service}`,
      label: newWay ? String(asks ? lane.started : bookedByNew(lane)) : null,
      lx: (X.door + W.door + X.service) / 2,
      ly: mid - 8,
      anchor: 'middle',
      tone: newWay ? 'on' : 'gap',
      color: newWay ? c : undefined,
    },
    {
      id: 'service-questions',
      d: `M${X.service + W.service} ${mid} H${X.questions}`,
      label: null,
      lx: 0,
      ly: 0,
      anchor: 'middle',
      tone: newWay ? 'on' : 'gap',
      color: newWay ? c : undefined,
    },
    {
      id: 'questions-elsewhere',
      d: `M${X.questions + W.questions / 2} ${ROW_A} V${12 + 54}`,
      label: asks && newWay ? String(lane.sentElsewhere) : null,
      lx: X.questions + W.questions / 2 + 10,
      ly: (ROW_A + 66) / 2 + 4,
      anchor: 'start',
      tone: asks && newWay ? 'out' : 'gap',
    },
    {
      id: 'questions-calendar',
      d: `M${X.questions + W.questions} ${mid} H${X.calendar}`,
      label: newWay && !noHours ? String(asks ? lane.qualified : bookedByNew(lane)) : null,
      lx: (X.questions + W.questions + X.calendar) / 2,
      ly: mid - 8,
      anchor: 'middle',
      tone: newWay && !noHours ? 'on' : 'gap',
      color: newWay && !noHours ? c : undefined,
    },
    {
      id: 'calendar-booked',
      d: `M${X.calendar + W.calendar} ${mid} H${X.booked}`,
      label: noHours ? null : String(lane.booked),
      lx: (X.calendar + W.calendar + X.booked) / 2,
      ly: mid - 8,
      anchor: 'middle',
      tone: noHours ? 'gap' : 'on',
      color: noHours ? undefined : c,
    },
    {
      id: 'clients-service',
      d: `M${X.door + W.door} ${midB} H${inAt - 12} Q${inAt} ${midB} ${inAt} ${midB - 12} V${ROW_A + NODE_H}`,
      label: clientWay ? String(lane.bookedByClients) : null,
      lx: inAt - 18,
      ly: midB - 8,
      anchor: 'end',
      tone: clientWay ? 'on' : 'gap',
      color: clientWay ? c : undefined,
    },
    {
      /* Under the questions, not through them: that is the whole point of
         a client's own link. */
      id: 'service-calendar-direct',
      d: `M${outAt} ${ROW_A + NODE_H} V${midB - 12} Q${outAt} ${midB} ${outAt + 12} ${midB} H${X.calendar + 28} Q${X.calendar + 40} ${midB} ${X.calendar + 40} ${midB - 12} V${ROW_A + NODE_H}`,
      label: clientWay ? 'skips the questions' : 'not offered to existing clients',
      lx: (outAt + X.calendar + 40) / 2,
      ly: midB + 18,
      anchor: 'middle',
      tone: clientWay && !noHours ? 'on' : 'gap',
      color: clientWay && !noHours ? c : undefined,
    },
  ];

  return { width: X.booked + W.booked + 10, height: ROW_B + NODE_H + 30, nodes, edges };
}

/**
 * One service's flow in words, for a screen reader and for anyone who
 * would rather read it: the same parts and counts, in the order people
 * move through them.
 */
export function describeLane(model: FlowModel, lane: Lane): string {
  const parts: string[] = [`${lane.name}, the last 30 days`];
  if (!lane.fromPage && !lane.fromClients) {
    parts.push('It is offered to nobody, so nobody can reach it yet');
  }
  if (lane.fromPage) {
    parts.push(
      asksQuestions(lane)
        ? `${lane.started} new ${lane.started === 1 ? 'person' : 'people'} chose it and started its questions, ${lane.finished} finished, ${lane.qualified} were let through to the calendar and ${lane.sentElsewhere} were sent elsewhere`
        : `New people go straight to the calendar; ${bookedByNew(lane)} booked`,
    );
  }
  if (lane.fromClients) parts.push(`${lane.bookedByClients} existing clients booked it through their own link, without the questions`);
  if (model.calendar.noHours) parts.push('There are no opening hours, so nothing can be booked');
  parts.push(`${lane.booked} bookings in total`);
  return `${parts.join('. ')}.`;
}
