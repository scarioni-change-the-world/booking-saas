import { decryptSecret, encryptSecret } from '../crypto';
import type { TenantScope } from '../db';
import type { CalendarConnectionRow } from '../db/types';
import {
  CalendarUnavailableError,
  type BusyInterval,
  type BusyQuery,
  type CalendarEvent,
  type CalendarEventInput,
  type CalendarHealth,
  type CalendarProvider,
} from './provider';

/**
 * Google Calendar, over the REST API with native fetch.
 *
 * Brief 6.1 is the reason there is no `googleapis` import here and must not
 * become one: that package is 114 MB of mostly unused API clients, and on
 * serverless it pushed cold starts past 120 seconds — the booking page appeared
 * to hang. Direct fetch against the three endpoints this app actually uses is
 * the whole integration.
 */

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

/**
 * Scopes requested at consent.
 *
 * Brief 6.6: both of these are Sensitive, not Restricted — they require
 * verification but NOT the paid annual CASA security assessment. The broad
 * `calendar` scope buys nothing this app needs and moves the whole grant into a
 * higher scrutiny tier. Verify the tier in the Cloud Console scope picker,
 * which is authoritative; third-party write-ups on this are frequently wrong.
 */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/userinfo.email',
] as const;

/** Refresh this far before actual expiry, so a request never races the clock. */
const REFRESH_SKEW_SECONDS = 120;

/** Meet links are async; poll this many times before giving up (brief 6.7). */
const MEET_POLL_ATTEMPTS = 3;
const MEET_POLL_DELAY_MS = 700;

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface GoogleEntryPoint {
  entryPointType?: string;
  uri?: string;
}

interface GoogleEvent {
  id: string;
  hangoutLink?: string;
  conferenceData?: {
    createRequest?: { status?: { statusCode?: string } };
    entryPoints?: GoogleEntryPoint[];
  };
}

/**
 * Raised when Google rejects the refresh token itself.
 *
 * Distinct from a transient failure because the remedy is different and
 * manual: the tenant must reconnect. Brief 6.3 is the common cause — while the
 * OAuth app is in Testing mode, refresh tokens die after ~7 days regardless of
 * use, and, the trap, publishing to Production does NOT extend an
 * already-issued token. After reaching Production you must disconnect and
 * reconnect once to obtain a durable one.
 */
export class GoogleGrantExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleGrantExpiredError';
  }
}

function clientCredentials(): { id: string; secret: string } {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set');
  }
  return { id, secret };
}

/** Exchange an authorization code for tokens. Used by the OAuth callback. */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
): Promise<GoogleTokenResponse> {
  const { id, secret } = clientCredentials();

  const response = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: id,
      client_secret: secret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  const body = (await response.json()) as GoogleTokenResponse;
  if (!response.ok || body.error) {
    throw new Error(`Token exchange failed: ${body.error_description ?? body.error ?? response.status}`);
  }
  return body;
}

/** Read the email address a grant belongs to, for display in the dashboard. */
export async function fetchAccountEmail(accessToken: string): Promise<string> {
  const response = await fetch(USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Could not read Google account email (${response.status})`);

  const body = (await response.json()) as { email?: string };
  if (!body.email) throw new Error('Google returned no email for this account');
  return body.email;
}

export class GoogleCalendarProvider implements CalendarProvider {
  readonly id = 'google';

  constructor(
    private connection: CalendarConnectionRow,
    private readonly scope: TenantScope,
  ) {}

  /**
   * A valid access token, refreshing only when the cached one has expired.
   *
   * Brief 7.7: the reference implementation refreshed on every single request.
   * Google's quota is per OAuth client and shared across every tenant, so at
   * any scale that spends the budget on token churn rather than on calls that
   * do work.
   */
  private async accessToken(): Promise<string> {
    const { access_token_encrypted, access_token_expires_at } = this.connection;

    if (access_token_encrypted && access_token_expires_at) {
      const expiresAt = new Date(access_token_expires_at).getTime();
      if (expiresAt - REFRESH_SKEW_SECONDS * 1000 > Date.now()) {
        return decryptSecret(access_token_encrypted);
      }
    }

    return this.refreshAccessToken();
  }

  private async refreshAccessToken(): Promise<string> {
    const { id, secret } = clientCredentials();
    const refreshToken = decryptSecret(this.connection.refresh_token_encrypted);

    const response = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: id,
        client_secret: secret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    const body = (await response.json()) as GoogleTokenResponse;

    if (!response.ok || body.error) {
      // invalid_grant is the signature of a dead refresh token — revoked,
      // or expired under Testing mode (brief 6.3). It will never recover on
      // its own, so record it and stop retrying.
      if (body.error === 'invalid_grant') {
        await this.markStatus('needs_reconnect', body.error_description ?? 'invalid_grant');
        throw new GoogleGrantExpiredError(
          'Google refresh token is no longer valid — the calendar must be reconnected.',
        );
      }
      throw new CalendarUnavailableError(
        `Token refresh failed: ${body.error_description ?? body.error ?? response.status}`,
        this.id,
      );
    }

    const expiresAt = new Date(Date.now() + body.expires_in * 1000).toISOString();

    const patch: Partial<CalendarConnectionRow> = {
      access_token_encrypted: encryptSecret(body.access_token),
      access_token_expires_at: expiresAt,
      status: 'active',
      last_error: null,
    };

    // Google usually omits refresh_token on a refresh. When it does rotate one,
    // the old value stops working, so it must be persisted.
    if (body.refresh_token) {
      patch.refresh_token_encrypted = encryptSecret(body.refresh_token);
    }

    await this.scope.update('calendar_connections', patch).eq('id', this.connection.id);
    this.connection = { ...this.connection, ...patch } as CalendarConnectionRow;

    return body.access_token;
  }

  private async markStatus(
    status: CalendarConnectionRow['status'],
    error: string | null,
  ): Promise<void> {
    await this.scope
      .update('calendar_connections', {
        status,
        last_error: error?.slice(0, 500) ?? null,
        last_checked_at: new Date().toISOString(),
      })
      .eq('id', this.connection.id);
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.accessToken();

    const response = await fetch(`${CALENDAR_BASE}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
    });

    if (response.status === 204) return undefined as T;

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new CalendarUnavailableError(
        `Google Calendar ${init.method ?? 'GET'} ${path} failed (${response.status}): ${detail.slice(0, 300)}`,
        this.id,
        response.status,
      );
    }

    return (await response.json()) as T;
  }

  async getBusy(query: BusyQuery): Promise<BusyInterval[]> {
    const result = await this.call<{
      calendars?: Record<string, { busy?: Array<{ start: string; end: string }>; errors?: unknown[] }>;
    }>('/freeBusy', {
      method: 'POST',
      body: JSON.stringify({
        timeMin: query.from,
        timeMax: query.to,
        timeZone: query.timezone,
        items: [{ id: this.connection.calendar_id }],
      }),
    });

    const calendar = result.calendars?.[this.connection.calendar_id];

    // freeBusy returns 200 with a per-calendar `errors` array when it cannot
    // read that calendar. Treating that as "no busy times" is exactly the
    // silent degradation brief 6.8 warns about — it would serve every slot as
    // free. Fail instead.
    if (calendar?.errors?.length) {
      throw new CalendarUnavailableError(
        `freeBusy could not read calendar ${this.connection.calendar_id}: ${JSON.stringify(calendar.errors).slice(0, 200)}`,
        this.id,
      );
    }

    return (calendar?.busy ?? []).map((b) => ({ start: b.start, end: b.end }));
  }

  private eventBody(input: CalendarEventInput, withConference: boolean) {
    return {
      summary: input.summary,
      description: input.description,
      start: { dateTime: input.start, timeZone: input.timezone },
      end: { dateTime: input.end, timeZone: input.timezone },
      attendees: input.attendeeEmail
        ? [{ email: input.attendeeEmail, displayName: input.attendeeName }]
        : undefined,
      ...(withConference
        ? {
            conferenceData: {
              createRequest: {
                requestId: `booking-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
                conferenceSolutionKey: { type: 'hangoutsMeet' },
              },
            },
          }
        : {}),
    };
  }

  /**
   * Pull the video link out of an event.
   *
   * Brief 6.7: when an event is created with conferenceData.createRequest, the
   * response often comes back with status "pending" and no hangoutLink yet.
   * Reading only hangoutLink stores null, and the client's confirmation email
   * silently omits the video link — with nothing logged anywhere. So read
   * entryPoints[] as well, and re-read the event while the request is still
   * pending.
   */
  private static meetUrl(event: GoogleEvent): string | null {
    if (event.hangoutLink) return event.hangoutLink;

    const video = event.conferenceData?.entryPoints?.find(
      (entry) => entry.entryPointType === 'video' && entry.uri,
    );
    return video?.uri ?? null;
  }

  private static isConferencePending(event: GoogleEvent): boolean {
    const code = event.conferenceData?.createRequest?.status?.statusCode;
    return code === 'pending';
  }

  private async resolveMeetUrl(event: GoogleEvent): Promise<string | null> {
    let current = event;

    for (let attempt = 0; attempt < MEET_POLL_ATTEMPTS; attempt += 1) {
      const url = GoogleCalendarProvider.meetUrl(current);
      if (url) return url;
      if (!GoogleCalendarProvider.isConferencePending(current)) return null;

      await new Promise((resolve) => setTimeout(resolve, MEET_POLL_DELAY_MS));
      // conferenceDataVersion=1 on the re-read too. Without it the response can
      // come back without conferenceData at all, so the poll would only ever
      // see hangoutLink — which is the field that is still empty at this point,
      // and the whole reason for reading entryPoints[] instead.
      current = await this.call<GoogleEvent>(
        `/calendars/${encodeURIComponent(this.connection.calendar_id)}` +
          `/events/${encodeURIComponent(current.id)}?conferenceDataVersion=1`,
      );
    }

    // Still pending after polling. The booking is real and the event exists;
    // the link simply is not ready. Returning null here is honest, and
    // sync_status on the booking records that the link is missing.
    return GoogleCalendarProvider.meetUrl(current);
  }

  async createEvent(input: CalendarEventInput): Promise<CalendarEvent> {
    const calendar = encodeURIComponent(this.connection.calendar_id);

    // sendUpdates=none: Google must never email invitations. This app owns all
    // client communication (brief 2.7), and a Google invite alongside the
    // branded confirmation reads as a duplicate booking to the client.
    const event = await this.call<GoogleEvent>(
      `/calendars/${calendar}/events?conferenceDataVersion=1&sendUpdates=none`,
      { method: 'POST', body: JSON.stringify(this.eventBody(input, input.createConference ?? false)) },
    );

    return {
      eventId: event.id,
      meetingUrl: input.createConference ? await this.resolveMeetUrl(event) : null,
    };
  }

  async updateEvent(eventId: string, input: CalendarEventInput): Promise<CalendarEvent> {
    const calendar = encodeURIComponent(this.connection.calendar_id);

    // PATCH, not PUT: a full replace would drop the conferenceData created with
    // the event, and the client's existing video link would stop working after
    // a reschedule.
    const event = await this.call<GoogleEvent>(
      `/calendars/${calendar}/events/${encodeURIComponent(eventId)}?conferenceDataVersion=1&sendUpdates=none`,
      { method: 'PATCH', body: JSON.stringify(this.eventBody(input, false)) },
    );

    return { eventId: event.id, meetingUrl: GoogleCalendarProvider.meetUrl(event) };
  }

  async deleteEvent(eventId: string): Promise<void> {
    const calendar = encodeURIComponent(this.connection.calendar_id);

    try {
      await this.call<void>(
        `/calendars/${calendar}/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
        { method: 'DELETE' },
      );
    } catch (error) {
      // An event already gone is the outcome we wanted. Anything else is real.
      if (
        error instanceof CalendarUnavailableError &&
        (error.status === 404 || error.status === 410)
      ) {
        return;
      }
      throw error;
    }
  }

  /**
   * Read the meeting link off an event that already exists.
   *
   * Backfills bookings written while the conference was still pending — their
   * stored link is null even though the calendar event has one. Without this,
   * the only remedy for an affected booking is asking the client to rebook.
   */
  async readMeetingUrl(eventId: string): Promise<string | null> {
    if (!eventId) return null;

    try {
      const event = await this.call<GoogleEvent>(
        `/calendars/${encodeURIComponent(this.connection.calendar_id)}` +
          `/events/${encodeURIComponent(eventId)}?conferenceDataVersion=1`,
      );
      return GoogleCalendarProvider.meetUrl(event);
    } catch {
      return null;
    }
  }

  /**
   * Create a throwaway event, report exactly what Google said, then delete it.
   *
   * Exists to separate two failures that look identical from the outside: a
   * link read too early, and Google refusing to create the conference at all.
   * The second shows up as createRequest.status.statusCode === 'failure', and
   * no amount of polling will ever fix it — the tenant's Workspace policy is
   * blocking Meet creation. Without a probe like this the two are
   * indistinguishable, and the natural response to a missing link is to add
   * more retries, which is precisely the wrong fix for the second case.
   *
   * Scheduled a week out and deleted in a finally block, so a failure part-way
   * through does not leave debris on the tenant's calendar.
   */
  async diagnoseConference(): Promise<Record<string, unknown>> {
    const calendar = encodeURIComponent(this.connection.calendar_id);
    const start = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    const end = new Date(start.getTime() + 15 * 60_000);
    let eventId: string | null = null;

    try {
      const created = await this.call<GoogleEvent>(
        `/calendars/${calendar}/events?conferenceDataVersion=1&sendUpdates=none`,
        {
          method: 'POST',
          body: JSON.stringify({
            summary: '[diagnostic] safe to delete',
            start: { dateTime: start.toISOString() },
            end: { dateTime: end.toISOString() },
            conferenceData: {
              createRequest: {
                requestId: `diag-${Date.now()}`,
                conferenceSolutionKey: { type: 'hangoutsMeet' },
              },
            },
          }),
        },
      );
      eventId = created.id;

      const immediate = {
        hangoutLink: created.hangoutLink ?? null,
        status: created.conferenceData?.createRequest?.status?.statusCode ?? null,
        entryPoints: (created.conferenceData?.entryPoints ?? []).map((e) => e.entryPointType),
      };

      await new Promise((resolve) => setTimeout(resolve, 1500));
      const after = await this.call<GoogleEvent>(
        `/calendars/${calendar}/events/${encodeURIComponent(eventId)}?conferenceDataVersion=1`,
      );

      return {
        ok: true,
        calendarId: this.connection.calendar_id,
        immediate,
        afterRetry: {
          hangoutLink: after.hangoutLink ?? null,
          status: after.conferenceData?.createRequest?.status?.statusCode ?? null,
          entryPoints: (after.conferenceData?.entryPoints ?? []).map((e) => e.entryPointType),
          resolvedUrl: GoogleCalendarProvider.meetUrl(after),
        },
      };
    } catch (error) {
      return {
        ok: false,
        reason: (error as Error).message,
        status: (error as CalendarUnavailableError).status ?? null,
      };
    } finally {
      if (eventId) {
        await this.deleteEvent(eventId).catch(() => {
          console.error(`[google] diagnostic event ${eventId} could not be removed`);
        });
      }
    }
  }

  /**
   * Ask Google whether this connection actually works.
   *
   * Brief 6.8: the reference implementation's admin panel reported "Connected"
   * because it checked whether an email string existed in the database. It
   * never asked Google, so a dead integration displayed as healthy for as long
   * as nobody looked at the calendar. This makes a real call — a one-minute
   * freeBusy window, the cheapest request that exercises both the refresh token
   * and calendar access — and records the outcome.
   */
  async healthCheck(): Promise<CalendarHealth> {
    const checkedAt = new Date().toISOString();

    try {
      const now = new Date();
      await this.getBusy({
        from: now.toISOString(),
        to: new Date(now.getTime() + 60_000).toISOString(),
        timezone: 'UTC',
      });

      await this.markStatus('active', null);
      return { connected: true, accountEmail: this.connection.account_email, checkedAt };
    } catch (error) {
      const message = (error as Error).message;
      if (!(error instanceof GoogleGrantExpiredError)) {
        await this.markStatus(this.connection.status, message);
      }
      return {
        connected: false,
        accountEmail: this.connection.account_email,
        checkedAt,
        error: message,
      };
    }
  }
}
