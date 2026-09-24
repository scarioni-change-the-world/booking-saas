import { DateTime } from 'luxon';
import { substitute, TEMPLATE_TOKENS, type TemplateTokens } from './email/templates';
import type { EmailTemplateKind } from './db/types';

/**
 * The arithmetic behind Messages: every message a business sends, pinned to
 * the moment in a client's journey that sends it.
 *
 * Six emails and an on-screen message used to be a list of text boxes in
 * Settings and a tab under Questions, and nothing on either said when each
 * one goes out or whether it arrived. Laid along the journey, the first is
 * obvious; counted from the log (migration 0027), so is the second.
 *
 * Pure and client-safe: the screen, its preview and the tests share it.
 */

export type MessageId = EmailTemplateKind | 'next_steps';

export interface Moment {
  id: string;
  title: string;
  /** Where the journey goes from here: the calendar, somewhere else, or on. */
  tone: 'on' | 'booked' | 'elsewhere';
  messages: MessageId[];
}

/** In the order a client meets them. */
export const MOMENTS: Moment[] = [
  { id: 'elsewhere', title: 'Sent elsewhere', tone: 'elsewhere', messages: ['next_steps'] },
  {
    id: 'books',
    title: 'Books',
    tone: 'booked',
    messages: ['booking_confirmed', 'booking_pack_confirmed', 'owner_notification'],
  },
  { id: 'day-before', title: 'Day before', tone: 'on', messages: ['booking_reminder'] },
  { id: 'changes', title: 'Changes plans', tone: 'on', messages: ['booking_rescheduled', 'booking_cancelled'] },
  { id: 'link', title: 'Gets their own link', tone: 'booked', messages: ['client_invite'] },
];

export interface MessageInfo {
  label: string;
  /** Who reads it. The owner notification is the one addressed to the business. */
  to: 'client' | 'you';
  channel: 'email' | 'screen';
  /** When it goes out, in a sentence. */
  when: string;
  /** What is always added underneath, whatever the wording says. */
  alwaysAdded: string[];
}

export const MESSAGES: Record<MessageId, MessageInfo> = {
  next_steps: {
    label: 'Your next steps',
    to: 'client',
    channel: 'screen',
    when: 'Shown on screen the moment an answer sends someone somewhere other than your calendar. Not emailed.',
    alwaysAdded: [],
  },
  booking_confirmed: {
    label: 'Confirmation',
    to: 'client',
    channel: 'email',
    when: 'Straight after they book.',
    alwaysAdded: ['A calendar file', 'A link to change or cancel', 'Their own link to book again'],
  },
  booking_pack_confirmed: {
    label: 'Programme, all dates',
    to: 'client',
    channel: 'email',
    when: 'Straight after they book a programme: one email for every date, not one each.',
    alwaysAdded: [
      'One calendar file with every appointment',
      'Each date, with its own link to change or cancel',
      'Their own link, for any session still owed',
    ],
  },
  owner_notification: {
    label: 'New booking, to you',
    to: 'you',
    channel: 'email',
    when: 'Straight after anyone books, to the address in Settings. Reply goes to the client.',
    alwaysAdded: [],
  },
  booking_reminder: {
    label: 'Reminder',
    to: 'client',
    channel: 'email',
    when: 'Once a day, for every appointment in the day ahead.',
    alwaysAdded: ['A link to change or cancel', 'The video link, when there is one'],
  },
  booking_rescheduled: {
    label: 'Moved',
    to: 'client',
    channel: 'email',
    when: 'When an appointment moves to a new time.',
    alwaysAdded: ['A new calendar file', 'A link to change or cancel'],
  },
  booking_cancelled: {
    label: 'Cancelled',
    to: 'client',
    channel: 'email',
    when: 'When an appointment is cancelled, by them or by you.',
    alwaysAdded: ['For a programme: a link to book the session again'],
  },
  client_invite: {
    label: 'Their own link',
    to: 'client',
    channel: 'email',
    when: 'When you give someone their own link, or send it again from People.',
    alwaysAdded: ['Their own link'],
  },
};

/** The reminder run's hour, as the business would read it. */
export const REMINDER_RUN_UTC_HOUR = 8;

export function reminderLocalTime(timezone: string, nowIso: string): string {
  return DateTime.fromISO(nowIso, { zone: 'utc' })
    .set({ hour: REMINDER_RUN_UTC_HOUR, minute: 0 })
    .setZone(timezone)
    .toFormat('HH:mm');
}

/* ── Counting ─────────────────────────────────────────────────────────── */

export interface SendRow {
  kind: EmailTemplateKind;
  status: 'sent' | 'failed' | 'not_configured';
}

export interface Tally {
  sent: number;
  failed: number;
  notSent: number;
}

export function tallySends(rows: readonly SendRow[]): Record<EmailTemplateKind, Tally> {
  const empty = (): Tally => ({ sent: 0, failed: 0, notSent: 0 });
  const out = Object.fromEntries(
    (Object.keys(TEMPLATE_TOKENS) as EmailTemplateKind[]).map((k) => [k, empty()]),
  ) as Record<EmailTemplateKind, Tally>;
  for (const row of rows) {
    const t = out[row.kind];
    if (!t) continue;
    if (row.status === 'sent') t.sent += 1;
    else if (row.status === 'failed') t.failed += 1;
    else t.notSent += 1;
  }
  return out;
}

/**
 * A tally in the fewest words that are still true.
 *
 * "Not sent" is kept apart from "failed" because they have different
 * fixes: a failure is one address or one outage, "not sent" means email is
 * not set up at all and nothing is reaching anyone.
 */
export function describeTally(t: Tally): string {
  const parts: string[] = [];
  if (t.sent > 0 || (t.failed === 0 && t.notSent === 0)) parts.push(`${t.sent} sent`);
  if (t.failed > 0) parts.push(`${t.failed} failed`);
  if (t.notSent > 0) parts.push(`${t.notSent} not sent`);
  return parts.join(' · ');
}

/* ── Preview ──────────────────────────────────────────────────────────── */

/**
 * Made-up but believable details for the preview, in the business's own
 * zone and with one of their own services, so what they read is what a
 * client would read — not "{{serviceName}}".
 */
export function sampleTokens(input: {
  tenantName: string;
  serviceName: string | null;
  timezone: string;
  nowIso: string;
}): TemplateTokens {
  const when = DateTime.fromISO(input.nowIso, { zone: 'utc' })
    .setZone(input.timezone)
    .plus({ days: 7 })
    .set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
  return {
    clientName: 'Maya',
    clientEmail: 'maya@example.com',
    serviceName: input.serviceName ?? 'your session',
    // The format the real emails use — see formatDateTime in booking-email.ts.
    dateTime: when.toFormat("cccc, LLLL d 'at' h:mm a"),
    // A made-up room, so placing the token shows something rather than nothing.
    meetingLink: 'https://meet.google.com/abc-defg-hij',
    packSize: '3',
    tenantName: input.tenantName,
  };
}

/** The links a real send adds underneath, as the preview shows them. */
export function sampleLinks(kind: EmailTemplateKind, tokens: TemplateTokens, timezone: string, nowIso: string): string[] {
  switch (kind) {
    case 'booking_confirmed':
      return ['Change or cancel your booking', `Book with ${tokens.tenantName} again`];
    case 'booking_rescheduled':
    case 'booking_reminder':
      return ['Change or cancel your booking'];
    case 'booking_cancelled':
      return [];
    case 'client_invite':
      return ['Book a session'];
    case 'booking_pack_confirmed': {
      const first = DateTime.fromISO(nowIso, { zone: 'utc' })
        .setZone(timezone)
        .plus({ days: 7 })
        .set({ hour: 10, minute: 0 });
      return [
        ...[0, 7, 14].map(
          (d, i) => `${i + 1}. ${first.plus({ days: d }).toFormat("cccc, LLLL d 'at' h:mm a")} — change or cancel`,
        ),
        'Book any appointment you are still owed',
      ];
    }
    default:
      return [];
  }
}

export interface Preview {
  subject: string;
  body: string;
  links: string[];
  /** {{tokens}} in the wording that this kind of email never fills in. */
  unknownTokens: string[];
}

/**
 * What a client would receive, from wording that may not be saved yet —
 * which is the point: the effect of an edit is on screen before it is.
 */
export function previewEmail(
  kind: EmailTemplateKind,
  wording: { subject: string; body: string },
  tokens: TemplateTokens,
  links: string[],
): Preview {
  const allowed = new Set(TEMPLATE_TOKENS[kind]);
  const used = [...`${wording.subject}\n${wording.body}`.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!);
  const unknownTokens = [...new Set(used.filter((t) => !allowed.has(t)))];
  // Only this kind's own tokens are filled, exactly as a real send would.
  const own: TemplateTokens = {};
  for (const key of allowed) if (key in tokens) own[key] = tokens[key]!;
  return {
    subject: substitute(wording.subject, own),
    body: substitute(wording.body, own),
    links,
    unknownTokens,
  };
}
