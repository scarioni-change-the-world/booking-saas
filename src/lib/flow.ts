import { formatMoney } from './money';
import { setupStages, blockers, loose, type ServiceFacts, type Stage } from './service-setup';
import { monogram, serviceColour } from './service-identity';
import type { QuestionInsight, ServiceInsight } from './enquiry-analysis';

/**
 * The arithmetic behind Flow, the home screen: how somebody reaches a
 * business, one service at a time, as the steps they take.
 *
 * Each service has its own flow because that is how the booking page runs:
 * a person picks the service first, then answers that service's questions
 * (the shared ones and its own), then sees the calendar. The first version
 * drew one set of questions in front of every service, which put the steps
 * in the wrong order and made each service's numbers a guess.
 *
 * Two ways in — the booking page, where strangers meet the questions, and a
 * client's own link, which skips them. The numbers are the last 30 days.
 *
 * It used to be drawn as a network of boxes and lines, and read like a lab
 * chart: counts of people and of appointments sat on one line (a programme
 * of three counts three times), dashed lines drew connections that did not
 * exist, and a red dot stood in for a sentence. It is now four clickable
 * chips in a line — your page, questions, choose a time, booked — each
 * holding one count of people and, when something needs doing, a few words
 * saying so. The sentences, the fixes and the settings open under the path
 * when a chip is chosen.
 *
 * Pure and client-safe; the page and the tests read this one model.
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
  /** Bookings made in the last 30 days. `person` is who made it — their
   *  email, lower-cased — so people can be counted apart from appointments. */
  bookings: Array<{ eventTypeId: string; status: 'confirmed' | 'cancelled'; byExistingClient: boolean; person: string }>;
  weeklyMinutes: number;
  calendarStatus: 'not_connected' | 'active' | 'needs_reconnect' | 'revoked';
  syncFailures: number;
  emailFailures: number;
  clientCount: number;
  /** Sessions paid for and not booked yet, one row per client per service.
   *  eventTypeId is null for a service since deleted, which no lane claims. */
  owed: Array<{ eventTypeId: string | null; name: string; email: string; sessions: number }>;
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
  /** The same, as a person would say it: "A programme of 3 sessions, 30 minutes each · €65.00". */
  words: string;
  /** Sessions in a programme, or null for a single appointment. */
  packSize: number | null;
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
  /** Appointments booked, in 30 days. A programme counts once per session. */
  booked: number;
  /** Of those appointments, ones made by people who were already clients. */
  bookedByClients: number;
  /** People who booked it, in 30 days, however many appointments each. */
  bookedPeople: number;
  /** Of those, people who came in new — through the booking page. */
  bookedPeopleNew: number;
  /** Questions a new enquiry is asked for this service: shared, and its own. */
  sharedQuestions: number;
  ownQuestions: number;
  questionInsights: QuestionInsight[];
  blocking: Stage[];
  loose: Stage[];
  /** Clients still owed a session of this service — named, for the Booked
   *  step's own notes; see owedSessions for the row's quiet total. */
  owed: Array<{ name: string; email: string; sessions: number }>;
  owedSessions: number;
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

function laneWords(s: FlowService, currency: string): string {
  const price = s.priceMinor !== null ? formatMoney(s.priceMinor, currency) : 'no price yet';
  const shape =
    s.bookingMode === 'pack' && s.packSize
      ? `A programme of ${s.packSize} sessions, ${s.durationMinutes} minutes each`
      : `One session, ${s.durationMinutes} minutes`;
  return `${shape} · ${price}`;
}

/** Distinct people among some bookings, and how many of them came in new. */
function countPeople(bookings: FlowInput['bookings']): { all: number; fresh: number } {
  const fresh = new Set(bookings.filter((b) => !b.byExistingClient).map((b) => b.person));
  const all = new Set(bookings.map((b) => b.person));
  return { all: all.size, fresh: fresh.size };
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
    const people = countPeople(mine);
    const owed = input.owed.filter((o) => o.eventTypeId === s.id).map((o) => ({ name: o.name, email: o.email, sessions: o.sessions }));
    return {
      id: s.id,
      part: `service:${s.id}` as PartId,
      name: s.name,
      color: serviceColour(s.color),
      monogram: monogram(s.name),
      sub: laneSub(s, input.tenant.currency, stages),
      words: laneWords(s, input.tenant.currency),
      packSize: s.bookingMode === 'pack' && s.packSize ? s.packSize : null,
      fromPage: s.availableToProspects,
      fromClients: s.availableToExistingClients,
      live: blockers(stages).length === 0,
      started: insight.get(s.id)?.started ?? 0,
      finished: insight.get(s.id)?.completed ?? 0,
      qualified: insight.get(s.id)?.meeting ?? 0,
      sentElsewhere: insight.get(s.id)?.other ?? 0,
      booked: mine.length,
      bookedByClients: mine.filter((b) => b.byExistingClient).length,
      bookedPeople: people.all,
      bookedPeopleNew: people.fresh,
      sharedQuestions: input.globalQuestionCount,
      ownQuestions: s.ownQuestionCount,
      questionInsights: input.questionInsightsByService[s.id] ?? [],
      blocking: blockers(stages),
      loose: loose(stages),
      owed,
      owedSessions: owed.reduce((sum, o) => sum + o.sessions, 0),
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

/** Whether a new enquiry is asked anything before the calendar for this service. */
export function asksQuestions(lane: Lane): boolean {
  return lane.sharedQuestions + lane.ownQuestions > 0;
}

/* ── One service, as four steps ────────────────────────────────────────── */

export type StepId = 'find' | 'questions' | 'times' | 'booked';

export interface StepNote {
  /** 'need' is something to do; 'info' is only worth knowing. */
  tone: 'info' | 'need';
  text: string;
  /** Relative to the business's admin, e.g. `messages?m=next_steps`. */
  action?: { label: string; href: string };
}

export interface FlowStep {
  id: StepId;
  /** The chip's name: two or three words. */
  label: string;
  /** Shown on the chip when there is no count to show. */
  short: string;
  /** A few words on the chip when something needs doing, or null. */
  flag: string | null;
  /** The step in full, for its opened detail. */
  title: string;
  /** What the step is set to, in one plain line. */
  detail: string;
  /**
   * 'set' is working; 'missing' stops the service and says so; 'waiting'
   * comes after a missing step, so nobody reaches it yet; 'skipped' is a
   * step this service's people never meet.
   */
  state: 'set' | 'missing' | 'waiting' | 'skipped';
  /** One count of people — never appointments — with an optional line under it. */
  figure: { value: string; label: string; sub?: string } | null;
  change: { label: string; href: string } | null;
  notes: StepNote[];
}

const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

function hoursWords(minutes: number): string {
  const h = Math.round((minutes / 60) * 10) / 10;
  return `${h} ${h === 1 ? 'hour' : 'hours'}`;
}

/** Appointments beyond the people who made them, explained — or nothing. */
function appointmentsNote(lane: Lane): string | null {
  if (lane.booked <= lane.bookedPeople) return null;
  return lane.packSize
    ? `That is ${lane.booked} appointments, because it is a programme of ${lane.packSize} sessions.`
    : `That is ${lane.booked} appointments: some people booked more than once.`;
}

export interface LaneState {
  label: string;
  live: boolean;
}

/** Whether people can book this service now, in two or three words. */
export function laneState(model: FlowModel, lane: Lane): LaneState {
  if (!lane.fromPage && !lane.fromClients) return { label: 'Not offered yet', live: false };
  if (lane.blocking.length > 0 || model.calendar.noHours) return { label: 'Not bookable yet', live: false };
  return { label: 'Taking bookings', live: true };
}

/**
 * The service's last 30 days in one sentence, and at most two short
 * lines under it: who else booked, and why there are more appointments
 * than people. Read aloud, it should make sense to somebody who has never
 * seen the screen.
 */
export function readout(model: FlowModel, lane: Lane): { text: string; asides: string[] } {
  if (!lane.fromPage && !lane.fromClients) {
    return { text: 'Nobody can book this yet: it isn’t offered to anyone.', asides: [] };
  }
  const stop = lane.blocking.find((st) => st.id !== 'review');
  if (stop) return { text: `Nobody can book this yet. ${stop.note}`, asides: [] };
  if (model.calendar.noHours) {
    return { text: 'Nobody can book this yet: you haven’t set any hours.', asides: [] };
  }

  const clientsOnly = lane.bookedPeople - lane.bookedPeopleNew;
  let text: string;
  if (lane.fromPage && asksQuestions(lane)) {
    text =
      lane.started === 0
        ? 'Nobody new has started booking this in the last 30 days.'
        : `In the last 30 days, ${people(lane.started)} started booking this, ${lane.qualified} could choose a time, and ${lane.bookedPeopleNew === 0 ? 'nobody' : lane.bookedPeopleNew} booked.`;
  } else if (lane.fromPage) {
    text =
      lane.bookedPeopleNew === 0
        ? 'Nobody new has booked this in the last 30 days.'
        : `In the last 30 days, ${people(lane.bookedPeopleNew)} booked this.`;
  } else {
    text =
      clientsOnly === 0
        ? 'No existing client has booked this in the last 30 days.'
        : `In the last 30 days, ${people(clientsOnly)} booked this on their own link.`;
  }

  const asides: string[] = [];
  if (lane.fromPage && clientsOnly > 0) {
    asides.push(`${people(clientsOnly)} who ${clientsOnly === 1 ? 'was already a client' : 'were already clients'} also booked it, on their own link.`);
  }
  const extra = appointmentsNote(lane);
  if (extra) asides.push(extra);
  return { text, asides };
}

/**
 * The four steps a person takes to book this service, in order. Every
 * count is of people. A step that stops the service is 'missing' and says
 * how to fix it; the steps after it are 'waiting'.
 */
export function serviceSteps(model: FlowModel, lane: Lane, slug: string): FlowStep[] {
  const asks = asksQuestions(lane);
  const settings = `sessions/${lane.id}`;
  const counted = lane.fromPage && asks;

  /* 1 · Finding it */
  let find: FlowStep;
  if (lane.fromPage) {
    find = {
      id: 'find',
      label: 'Your page',
      short: `/t/${slug}`,
      flag: null,
      title: 'They find it on your booking page',
      detail: `/t/${slug}`,
      state: 'set',
      figure: counted ? { value: String(lane.started), label: 'chose it' } : null,
      change: { label: 'Change', href: settings },
      notes: [
        lane.fromClients
          ? { tone: 'info', text: `Existing clients can also book it on their own link${asks ? ', without the questions' : ''}.` }
          : { tone: 'info', text: 'Existing clients don’t see it on their own link.', action: { label: 'Offer it to them', href: settings } },
      ],
    };
  } else if (lane.fromClients) {
    find = {
      id: 'find',
      label: 'Their own link',
      short: 'Existing clients only',
      flag: null,
      title: 'Existing clients find it on their own link',
      detail: 'It isn’t on your booking page, so new people don’t see it.',
      state: 'set',
      figure: null,
      change: { label: 'Change', href: settings },
      notes: [{ tone: 'info', text: 'Only people who have booked with you before can book this.', action: { label: 'Put it on your page', href: settings } }],
    };
  } else {
    find = {
      id: 'find',
      label: 'Your page',
      short: 'Not offered to anyone',
      flag: null,
      title: 'They find it',
      detail: 'It isn’t on your booking page, and it isn’t offered to existing clients.',
      state: 'missing',
      figure: null,
      change: { label: 'Choose who sees it', href: settings },
      notes: [],
    };
  }

  /* 2 · The questions */
  let questions: FlowStep;
  const questionsHref = `screening?service=${encodeURIComponent(lane.id)}`;
  if (!lane.fromPage && lane.fromClients) {
    questions = {
      id: 'questions',
      label: 'Questions',
      short: 'Skipped',
      flag: null,
      title: 'No questions',
      detail: 'Their own link skips the questions.',
      state: 'skipped',
      figure: null,
      change: null,
      notes: [],
    };
  } else if (!asks) {
    questions = {
      id: 'questions',
      label: 'Questions',
      short: 'None asked',
      flag: null,
      title: 'No questions',
      detail: 'New people go straight to choosing a time.',
      state: 'set',
      figure: null,
      change: { label: 'Add questions', href: questionsHref },
      notes: [],
    };
  } else {
    const n = lane.sharedQuestions + lane.ownQuestions;
    const notes: StepNote[] = [];
    const unfinished = Math.max(0, lane.started - lane.finished);
    if (unfinished > 0) {
      notes.push({ tone: 'info', text: `${people(unfinished)} didn’t finish.`, action: { label: 'See who', href: 'people?show=unfinished' } });
    }
    const sent = lane.sentElsewhere;
    const was = sent === 1 ? 'was' : 'were';
    if (model.elsewhere.said) {
      if (sent > 0) {
        notes.push({
          tone: 'info',
          text: `${people(sent)} ${was} sent to your other next step${model.elsewhere.label ? `, “${model.elsewhere.label}”` : ''}.`,
          action: { label: 'See who', href: 'people?figure=other' },
        });
      }
    } else {
      notes.push({
        tone: 'need',
        text:
          sent > 0
            ? `${people(sent)} ${was} sent to your other next step, but it isn’t written yet, so they saw nothing.`
            : 'If an answer sends someone to your other next step, they will see nothing: it isn’t written yet.',
        action: { label: 'Write it', href: 'messages?m=next_steps' },
      });
    }
    questions = {
      id: 'questions',
      label: 'Questions',
      short: `${n} asked`,
      flag: model.elsewhere.said ? null : 'Next step not written',
      title: `They answer ${n} ${n === 1 ? 'question' : 'questions'}`,
      detail:
        lane.ownQuestions === 0
          ? 'The ones you ask for every service'
          : lane.sharedQuestions === 0
            ? 'Asked only for this service'
            : `${lane.sharedQuestions} asked for every service, ${lane.ownQuestions} just for this one`,
      state: 'set',
      figure: counted && lane.started > 0 ? { value: `${lane.finished} of ${lane.started}`, label: 'finished' } : null,
      change: { label: 'Change', href: questionsHref },
      notes,
    };
  }

  /* 3 · Choosing a time */
  const pickTitle = lane.packSize ? `They choose ${lane.packSize} times` : 'They choose a time';
  const times: FlowStep = model.calendar.noHours
    ? {
        id: 'times',
        label: 'Choose a time',
        short: 'No hours set',
        flag: null,
        title: pickTitle,
        detail: 'You haven’t set any hours, so there is nothing to choose.',
        state: 'missing',
        figure: null,
        change: { label: 'Set your hours', href: 'week' },
        notes: [],
      }
    : {
        id: 'times',
        label: 'Choose a time',
        short: `${hoursWords(model.calendar.weeklyMinutes)} a week`,
        flag: model.calendar.flag,
        title: pickTitle,
        detail: `From your usual hours, ${hoursWords(model.calendar.weeklyMinutes)} a week`,
        state: 'set',
        figure: counted ? { value: String(lane.qualified), label: 'could book' } : null,
        change: { label: 'Change', href: 'week' },
        notes: model.calendar.flag
          ? [{ tone: 'need', text: `${model.calendar.flag}.`, action: { label: 'Open the Week', href: 'week#calendar' } }]
          : [],
      };

  /* 4 · Booked */
  const extra = appointmentsNote(lane);
  const owedFlag = lane.owedSessions > 0 ? `${lane.owedSessions === 1 ? '1 session' : `${lane.owedSessions} sessions`} still to book` : null;
  const booked: FlowStep = {
    id: 'booked',
    label: 'Booked',
    short: 'Nobody yet',
    flag: [model.booked.flag, owedFlag].filter(Boolean).join(' · ') || null,
    title: 'They’re booked',
    detail: 'They get a confirmation email, and their own link to change it or book again.',
    state: 'set',
    figure: {
      value: String(lane.bookedPeople),
      label: lane.bookedPeople === 1 ? 'person' : 'people',
      sub: extra ? `${lane.booked} appointments` : undefined,
    },
    change: { label: 'Change', href: 'messages' },
    notes: [
      ...(model.booked.flag
        ? [{ tone: 'need' as const, text: `${model.booked.flag} in the last 30 days.`, action: { label: 'See which', href: 'messages' } }]
        : []),
      /* Named, so opening this step says who — not just how many. */
      ...lane.owed.map((o) => ({
        tone: 'need' as const,
        text: `${o.name || o.email} ${o.sessions === 1 ? 'has 1 session' : `has ${o.sessions} sessions`} paid for and not booked yet.`,
        action: { label: 'See in People', href: `people?person=${encodeURIComponent(o.email)}` },
      })),
    ],
  };

  const steps = [find, questions, times, booked];
  /* Nobody gets past a missing step, so the ones after it wait. */
  const firstMissing = steps.findIndex((st) => st.state === 'missing');
  if (firstMissing >= 0) {
    for (const st of steps.slice(firstMissing + 1)) {
      if (st.state === 'set') {
        st.state = 'waiting';
        st.figure = null;
        st.notes = [];
        st.flag = null;
        st.short = `Waiting for step ${firstMissing + 1}`;
      }
    }
  }
  return steps;
}

/** Which step an older link or a test run's phase names. */
export function stepForPart(part: string | null): StepId | null {
  if (!part) return null;
  if (part === 'page' || part === 'clients' || part === 'service' || part.startsWith('service:')) return 'find';
  if (part === 'questions' || part === 'elsewhere') return 'questions';
  if (part === 'calendar') return 'times';
  if (part === 'booked') return 'booked';
  return null;
}
