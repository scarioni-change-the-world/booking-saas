/**
 * A minimal, valid iCalendar (RFC 5545) VEVENT — attached to a booking
 * confirmation email so it drops straight into the client's own calendar.
 *
 * Hand-written rather than a library: this is plain structured text, not a
 * stateful protocol with attachment/auth handling the way SMTP is (see
 * src/lib/email/smtp.ts for where that line gets drawn) — the same category
 * as src/lib/tokens.ts, and small enough to keep pure and directly testable.
 */

export interface IcsEventInput {
  /** Stable per-event identity — the booking id is exactly this, so a
   * reschedule's re-sent invite updates the same calendar entry instead of
   * creating a second one. */
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  /** ISO 8601, any offset — normalised to UTC below. */
  startsAt: string;
  endsAt: string;
  organizer?: { name: string; email: string };
  attendee?: { name: string; email: string };
}

/** "20260115T090000Z" — the one timestamp shape RFC 5545 requires for a
 * UTC value (a trailing Z, no separators). */
function toIcsUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * RFC 5545 §3.3.11: a comma, semicolon or backslash must be backslash-
 * escaped, and a literal newline becomes the two-character sequence \n —
 * without this, a description containing either breaks the file for every
 * calendar client, not just some.
 *
 * Line endings are normalised to \n *first*, before that newline escaping —
 * a bare \r (no paired \n) previously survived untouched into the output.
 * RFC 5545 content lines are CRLF-terminated, and several real-world
 * calendar parsers are lenient enough to treat a stray, unescaped \r as a
 * line break on its own. Every text field here ultimately reaches a
 * calendar client (SUMMARY, DESCRIPTION, and both CN parameters — one of
 * which, ATTENDEE, is a prospect's own submitted name), so an unescaped \r
 * was a way to inject a fabricated content line — a fake ATTENDEE or
 * ORGANIZER, say — into a booking's own confirmation invite.
 */
function escapeIcsText(value: string): string {
  return value
    .replace(/\r\n|\r/g, '\n')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/** RFC 5545 §3.1: a line over 75 octets must be folded — a CRLF followed by
 * a single leading space, which every reader is required to treat as if it
 * were never there. Without this a long description can silently truncate
 * or corrupt the rest of the file in stricter clients. */
function foldLine(line: string): string {
  const bytes = Buffer.byteLength(line, 'utf8');
  if (bytes <= 75) return line;

  const chunks: string[] = [];
  let rest = line;
  let first = true;
  while (Buffer.byteLength(rest, 'utf8') > (first ? 75 : 74)) {
    const limit = first ? 75 : 74;
    let cut = limit;
    // Never split a UTF-8 multi-byte character in half.
    while (cut > 0 && Buffer.byteLength(rest.slice(0, cut), 'utf8') > limit) cut -= 1;
    chunks.push((first ? '' : ' ') + rest.slice(0, cut));
    rest = rest.slice(cut);
    first = false;
  }
  chunks.push(' ' + rest);
  return chunks.join('\r\n');
}

/** Build one VEVENT wrapped in a complete VCALENDAR — the whole attachment
 * a single booking's confirmation or reschedule email needs. */
export function buildIcs(input: IcsEventInput): string {
  return buildIcsCalendar([input]);
}

/**
 * Several events in one file.
 *
 * A programme booked as a pack is ten appointments, and ten separate .ics
 * attachments is ten things to open. RFC 5545 allows any number of VEVENTs
 * inside one VCALENDAR, and every calendar client adds them all from a
 * single file — so the client taps once and the whole programme is in their
 * diary.
 *
 * Each event keeps its own UID, because they remain independent
 * appointments: cancelling session three must update session three's entry
 * and nothing else.
 */
export function buildIcsCalendar(events: readonly IcsEventInput[]): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Intro//Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const input of events) lines.push(...eventLines(input));

  lines.push('END:VCALENDAR');

  // RFC 5545 requires CRLF line endings throughout, not just at fold points.
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

function eventLines(input: IcsEventInput): string[] {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${input.uid}@intro`,
    `DTSTAMP:${toIcsUtc(new Date().toISOString())}`,
    `DTSTART:${toIcsUtc(input.startsAt)}`,
    `DTEND:${toIcsUtc(input.endsAt)}`,
    `SUMMARY:${escapeIcsText(input.summary)}`,
  ];

  if (input.description) lines.push(`DESCRIPTION:${escapeIcsText(input.description)}`);
  if (input.location) lines.push(`LOCATION:${escapeIcsText(input.location)}`);
  if (input.organizer) {
    lines.push(`ORGANIZER;CN=${escapeIcsText(input.organizer.name)}:mailto:${input.organizer.email}`);
  }
  if (input.attendee) {
    lines.push(
      `ATTENDEE;CN=${escapeIcsText(input.attendee.name)};ROLE=REQ-PARTICIPANT:mailto:${input.attendee.email}`,
    );
  }

  lines.push('END:VEVENT');
  return lines;
}
