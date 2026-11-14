/**
 * "Ask khloe": what a reply can contain, and how it is checked before the
 * business sees it.
 *
 * A reply is a few sentences, buttons to places in the admin, and at most a
 * few proposed changes. A proposed change is only a proposal: the panel
 * shows it as a card, and nothing happens until the business presses
 * Confirm, which calls the same route the screen would. The assistant
 * never deletes, never cancels or moves an appointment, never emails a
 * client and never touches payments: those have no action here at all.
 *
 * Model output is untrusted, so every field is checked here: a change that
 * names a service the business does not have, an impossible date or time,
 * or a price out of range is dropped, never guessed at.
 */

export const PLACES = {
  services: { label: 'Services', href: 'flow' },
  setup: { label: 'Step-by-step setup', href: 'start' },
  week: { label: 'Week', href: 'week' },
  calendar: { label: 'Your calendar', href: 'week#calendar' },
  people: { label: 'People', href: 'people' },
  messages: { label: 'Messages', href: 'messages' },
  questions: { label: 'Questions', href: 'screening' },
  reports: { label: 'Reports', href: 'reports' },
  share: { label: 'Share', href: 'share' },
  account: { label: 'Account', href: 'account' },
  hours: { label: 'Opening hours', href: 'account#opening-hours' },
  look: { label: 'Your booking page’s look', href: 'account#booking-page' },
  payments: { label: 'Getting paid', href: 'account' },
} as const;

export type PlaceId = keyof typeof PLACES | 'service';

export interface AssistantLink {
  place: PlaceId;
  /** For place 'service': which one. */
  serviceId?: string;
}

export type AssistantAction =
  | { type: 'add_service'; name: string; durationMinutes: number; price: number | null }
  | { type: 'update_service'; serviceId: string; name?: string; durationMinutes?: number; price?: number | null }
  | { type: 'pause_service'; serviceId: string }
  | { type: 'resume_service'; serviceId: string }
  /** The usual weekly hours of the days named; start and end null closes them. */
  | { type: 'set_hours'; days: number[]; start: string | null; end: string | null }
  | { type: 'time_off'; from: string; to: string; note: string }
  | { type: 'booking_rules'; noticeHours?: number; windowDays?: number };

export interface AssistantReply {
  reply: string;
  links: AssistantLink[];
  actions: AssistantAction[];
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export const MAX_MESSAGE = 1000;
export const MAX_HISTORY = 8;

/** Structured output: every field present, nullable where it may not apply. */
export const ASSISTANT_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    links: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          place: { type: 'string', enum: [...Object.keys(PLACES), 'service'] },
          serviceId: { type: ['string', 'null'] },
        },
        required: ['place', 'serviceId'],
        additionalProperties: false,
      },
    },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['add_service', 'update_service', 'pause_service', 'resume_service', 'set_hours', 'time_off', 'booking_rules'],
          },
          serviceId: { type: ['string', 'null'] },
          name: { type: ['string', 'null'] },
          durationMinutes: { type: ['integer', 'null'] },
          price: { type: ['number', 'null'] },
          clearPrice: { type: ['boolean', 'null'] },
          days: { type: ['array', 'null'], items: { type: 'integer' } },
          start: { type: ['string', 'null'] },
          end: { type: ['string', 'null'] },
          from: { type: ['string', 'null'] },
          to: { type: ['string', 'null'] },
          note: { type: ['string', 'null'] },
          noticeHours: { type: ['integer', 'null'] },
          windowDays: { type: ['integer', 'null'] },
        },
        required: [
          'type', 'serviceId', 'name', 'durationMinutes', 'price', 'clearPrice', 'days',
          'start', 'end', 'from', 'to', 'note', 'noticeHours', 'windowDays',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['reply', 'links', 'actions'],
  additionalProperties: false,
} as const;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : null);
const minutes = (v: unknown) => {
  const n = int(v);
  return n !== null && n >= 5 && n <= 480 && n % 5 === 0 ? n : null;
};
const money = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100_000 ? Math.round(v * 100) / 100 : null;

/**
 * The reply, checked against what this business actually has. `serviceIds`
 * are its services; `today` bounds time off (none in the past, at most a
 * year ahead).
 */
export function sanitizeAssistantReply(
  raw: unknown,
  context: { serviceIds: string[]; today: string },
): AssistantReply {
  const value = (raw ?? {}) as { reply?: unknown; links?: unknown; actions?: unknown };
  const known = new Set(context.serviceIds);
  const reply = typeof value.reply === 'string' ? value.reply.trim().slice(0, 2000) : '';

  const links: AssistantLink[] = [];
  for (const item of Array.isArray(value.links) ? value.links : []) {
    const l = (item ?? {}) as { place?: unknown; serviceId?: unknown };
    if (l.place === 'service') {
      if (typeof l.serviceId === 'string' && known.has(l.serviceId)) links.push({ place: 'service', serviceId: l.serviceId });
    } else if (typeof l.place === 'string' && l.place in PLACES) {
      links.push({ place: l.place as keyof typeof PLACES });
    }
    if (links.length >= 3) break;
  }

  const actions: AssistantAction[] = [];
  const yearAhead = new Date(Date.parse(`${context.today}T00:00:00Z`) + 366 * 86_400_000).toISOString().slice(0, 10);
  for (const item of Array.isArray(value.actions) ? value.actions : []) {
    const a = (item ?? {}) as Record<string, unknown>;
    const serviceId = typeof a.serviceId === 'string' && known.has(a.serviceId) ? a.serviceId : null;
    switch (a.type) {
      case 'add_service': {
        const name = text(a.name, 80);
        const length = minutes(a.durationMinutes);
        if (name && length) actions.push({ type: 'add_service', name, durationMinutes: length, price: money(a.price) });
        break;
      }
      case 'update_service': {
        if (!serviceId) break;
        const change: Extract<AssistantAction, { type: 'update_service' }> = { type: 'update_service', serviceId };
        const name = text(a.name, 80);
        if (name) change.name = name;
        const length = minutes(a.durationMinutes);
        if (length) change.durationMinutes = length;
        if (a.clearPrice === true) change.price = null;
        else if (money(a.price) !== null) change.price = money(a.price);
        if (Object.keys(change).length > 2) actions.push(change);
        break;
      }
      case 'pause_service':
      case 'resume_service':
        if (serviceId) actions.push({ type: a.type, serviceId });
        break;
      case 'set_hours': {
        const days = [...new Set((Array.isArray(a.days) ? a.days : []).filter((d): d is number => Number.isInteger(d) && d >= 1 && d <= 7))].sort(
          (x, y) => x - y,
        );
        if (days.length === 0) break;
        if (a.start === null && a.end === null) {
          actions.push({ type: 'set_hours', days, start: null, end: null });
        } else if (typeof a.start === 'string' && typeof a.end === 'string' && HHMM.test(a.start) && HHMM.test(a.end) && a.start < a.end) {
          actions.push({ type: 'set_hours', days, start: a.start, end: a.end });
        }
        break;
      }
      case 'time_off': {
        const from = typeof a.from === 'string' && ISO_DATE.test(a.from) ? a.from : null;
        const to = typeof a.to === 'string' && ISO_DATE.test(a.to) ? a.to : from;
        if (from && to && from >= context.today && to >= from && to <= yearAhead) {
          actions.push({ type: 'time_off', from, to, note: text(a.note, 200) });
        }
        break;
      }
      case 'booking_rules': {
        const rules: Extract<AssistantAction, { type: 'booking_rules' }> = { type: 'booking_rules' };
        const notice = int(a.noticeHours);
        if (notice !== null && notice >= 0 && notice <= 720) rules.noticeHours = notice;
        const window = int(a.windowDays);
        if (window !== null && window >= 1 && window <= 730) rules.windowDays = window;
        if (rules.noticeHours !== undefined || rules.windowDays !== undefined) actions.push(rules);
        break;
      }
    }
    if (actions.length >= 4) break;
  }

  return {
    reply: reply || (actions.length ? 'Here is what I would change. Nothing happens until you confirm.' : 'Sorry, I could not answer that. Try asking another way.'),
    links,
    actions,
  };
}

/** The examples on the button's hint and in an empty panel. */
export const ASSISTANT_EXAMPLES = [
  'Add a 45-minute massage for €60',
  'Close next Friday',
  'Open Saturdays from 10 to 2',
  'Why can’t people book next week?',
  'How do I give a client their own link?',
];
