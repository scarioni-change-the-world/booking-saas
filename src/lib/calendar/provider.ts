/**
 * Calendar provider interface (brief 7.6).
 *
 * Google-only today, but Microsoft 365 is effectively required to compete in
 * this category, so the abstraction goes in now — before lib/availability.ts
 * has any provider-specific knowledge to unpick. The method names are the ones
 * the brief specifies: getBusy, createEvent, updateEvent, deleteEvent,
 * healthCheck.
 */

export interface BusyQuery {
  from: string;
  to: string;
  timezone: string;
}

export interface BusyInterval {
  start: string;
  end: string;
}

export interface CalendarEventInput {
  summary: string;
  description?: string;
  start: string;
  end: string;
  timezone: string;
  attendeeEmail?: string;
  attendeeName?: string;
  /** Request a video link (Meet, Teams) alongside the event. */
  createConference?: boolean;
}

export interface CalendarEvent {
  eventId: string;
  /**
   * May be null even on success. Google creates Meet links asynchronously and
   * frequently returns status "pending" with no link yet (brief 6.7), so a
   * provider is allowed to report the event created and the link not ready.
   */
  meetingUrl: string | null;
}

/**
 * The result of actually asking the provider whether the connection works.
 *
 * Brief 6.8: the reference implementation's admin panel reported "Connected"
 * because it checked whether an email string existed in the database. It never
 * asked Google. A health check that does not make a network call is not a
 * health check, so this returns `checkedAt` — a caller can tell a real result
 * from a stale one.
 */
export interface CalendarHealth {
  connected: boolean;
  accountEmail: string | null;
  checkedAt: string;
  error?: string;
}

export interface CalendarProvider {
  readonly id: string;
  getBusy(query: BusyQuery): Promise<BusyInterval[]>;
  createEvent(input: CalendarEventInput): Promise<CalendarEvent>;
  updateEvent(eventId: string, input: CalendarEventInput): Promise<CalendarEvent>;
  deleteEvent(eventId: string): Promise<void>;
  healthCheck(): Promise<CalendarHealth>;

  /**
   * Read the meeting link off an event that already exists.
   *
   * The repair path. A conference link is provisioned asynchronously, so a
   * booking can be written with a null link that the calendar event does in
   * fact have moments later. Without this there is no way to backfill those
   * rows short of asking the tenant to rebook, and the client's confirmation
   * has already gone out without the link.
   */
  readMeetingUrl(eventId: string): Promise<string | null>;
}

/**
 * Raised when a provider cannot be reached.
 *
 * Callers must decide deliberately between failing closed and degrading, rather
 * than inheriting a silent null. Brief 6.8 argues for failing closed on the
 * booking path: for a paid product a double-booking is worse than a form that
 * says "temporarily unavailable".
 */
export class CalendarUnavailableError extends Error {
  constructor(
    message: string,
    readonly providerId: string,
    /**
     * HTTP status, when the failure came from an API call.
     *
     * Carried explicitly so callers can branch on it. Reading a status back out
     * of the message text works until someone rewords the message, or until a
     * provider's own error body happens to contain a parenthesised number.
     */
    readonly status?: number,
  ) {
    super(message);
    this.name = 'CalendarUnavailableError';
  }
}
