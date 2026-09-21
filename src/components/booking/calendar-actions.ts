import { buildIcs } from '@/lib/ics';

/**
 * Putting a confirmed booking into the client's own calendar, from the page.
 *
 * The confirmation email already carries an .ics attachment. This is for the
 * person who books on a phone, sees "you're booked", and puts the phone down
 * without ever opening their mail — which is most of them. A booking that
 * only exists in an unread inbox is how people miss appointments.
 *
 * Two offers rather than one, because neither works everywhere. A Google
 * Calendar URL is a plain link that works on any device signed into Google
 * and nothing else; a downloaded .ics works with Apple Calendar, Outlook and
 * the rest but is awkward in some mobile browsers. Offering both costs one
 * extra line on the screen and removes a whole class of "it didn't work".
 *
 * buildIcs is reused from the server rather than reimplemented — it is pure
 * text assembly with no Node dependency, and the escaping rules it already
 * gets right (RFC 5545 §3.3.11, and a bare \r) are exactly the ones a second
 * implementation would get wrong.
 */

export interface CalendarEvent {
  title: string;
  startsAt: string;
  durationMinutes: number;
  details?: string;
  location?: string;
  uid: string;
}

function endOf(event: CalendarEvent): string {
  return new Date(
    new Date(event.startsAt).getTime() + event.durationMinutes * 60_000,
  ).toISOString();
}

/** "20260115T090000Z" — the compact UTC form both Google and RFC 5545 use. */
function compactUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function googleCalendarUrl(event: CalendarEvent): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${compactUtc(event.startsAt)}/${compactUtc(endOf(event))}`,
  });
  if (event.details) params.set('details', event.details);
  if (event.location) params.set('location', event.location);

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function icsFor(event: CalendarEvent): string {
  return buildIcs({
    uid: event.uid,
    summary: event.title,
    description: event.details,
    location: event.location,
    startsAt: event.startsAt,
    endsAt: endOf(event),
  });
}

/**
 * Hand the browser a file to save.
 *
 * A Blob rather than a `data:` URI: several mobile browsers refuse to
 * download a top-level data: URL outright, which would make the button do
 * nothing at all on exactly the devices most people book from. The object
 * URL is revoked straight after, because it holds the file in memory until
 * it is.
 */
export function downloadIcs(event: CalendarEvent, filename = 'booking.ics'): void {
  const blob = new Blob([icsFor(event)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}
