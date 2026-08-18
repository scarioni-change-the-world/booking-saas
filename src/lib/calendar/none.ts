import type {
  BusyInterval,
  BusyQuery,
  CalendarEvent,
  CalendarEventInput,
  CalendarHealth,
  CalendarProvider,
} from './provider';

/**
 * The provider for a tenant who has connected no calendar.
 *
 * Not a stub standing in for missing work — it is the correct behaviour for a
 * tenant that has not connected one, and it is honest about it: no busy
 * intervals, no events, and a health check that reports disconnected rather
 * than pretending. Bookings made against it are written with
 * sync_status = 'not_configured', which is distinguishable from 'failed'.
 */
export class NoCalendarProvider implements CalendarProvider {
  readonly id = 'none';

  async getBusy(_query: BusyQuery): Promise<BusyInterval[]> {
    return [];
  }

  async createEvent(_input: CalendarEventInput): Promise<CalendarEvent> {
    return { eventId: '', meetingUrl: null };
  }

  async updateEvent(_eventId: string, _input: CalendarEventInput): Promise<CalendarEvent> {
    return { eventId: '', meetingUrl: null };
  }

  async deleteEvent(_eventId: string): Promise<void> {
    // Nothing to delete.
  }

  async readMeetingUrl(_eventId: string): Promise<string | null> {
    return null;
  }

  async healthCheck(): Promise<CalendarHealth> {
    return { connected: false, accountEmail: null, checkedAt: new Date().toISOString() };
  }
}
