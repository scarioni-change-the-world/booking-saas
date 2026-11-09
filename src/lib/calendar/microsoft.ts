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
 * Outlook and Microsoft 365 calendars, over Microsoft Graph with native
 * fetch (no SDK, for the same cold-start reason as google.ts).
 *
 * Works for both kinds of Microsoft account: personal (outlook.com,
 * hotmail.com) and work or school (Microsoft 365). The differences that
 * matter here:
 *
 *   - Busy times come from calendarView, not getSchedule, because
 *     getSchedule is not available to personal accounts. Only each event's
 *     start, end and "show as" are asked for, never its subject or body.
 *   - Teams links can only be created for work or school accounts with
 *     Teams. The calendar says which online-meeting providers it allows,
 *     and a link is only requested when Teams is one of them; otherwise the
 *     booking is made without a video link, exactly like a business with no
 *     calendar.
 *   - Graph emails a meeting request to every attendee of an event the
 *     organiser creates, with no way to turn that off. khloe sends its own
 *     confirmation, so the client is written into the event's notes rather
 *     than added as an attendee.
 *
 * Event ids are stored with an "ms:" prefix so a booking made while another
 * calendar was connected is recognised as not this calendar's, and left
 * alone instead of failing (see foreignEvent below and in google.ts).
 */

const AUTHORITY = 'https://login.microsoftonline.com/common/oauth2/v2.0';
export const MICROSOFT_AUTH_URL = `${AUTHORITY}/authorize`;
const TOKEN_URL = `${AUTHORITY}/token`;
const GRAPH = 'https://graph.microsoft.com/v1.0';

/**
 * Delegated permissions, the smallest set that does the job:
 * Calendars.ReadWrite to read busy times and keep one event per booking,
 * User.Read for the account's address, offline_access for a refresh token.
 */
export const MICROSOFT_SCOPES = ['offline_access', 'User.Read', 'Calendars.ReadWrite'] as const;

const ID_PREFIX = 'ms:';
const REFRESH_SKEW_SECONDS = 120;
const LINK_POLL_ATTEMPTS = 2;
const LINK_POLL_DELAY_MS = 800;

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface GraphEvent {
  id: string;
  onlineMeeting?: { joinUrl?: string | null } | null;
}

interface GraphViewItem {
  start: { dateTime: string };
  end: { dateTime: string };
  showAs?: string;
  isCancelled?: boolean;
}

export class MicrosoftGrantExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MicrosoftGrantExpiredError';
  }
}

export function microsoftConfigured(): boolean {
  return !!(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET && process.env.MICROSOFT_REDIRECT_URI);
}

function credentials(): { id: string; secret: string } {
  const id = process.env.MICROSOFT_CLIENT_ID;
  const secret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!id || !secret) throw new Error('MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET must be set');
  return { id, secret };
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const { id, secret } = credentials();
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, scope: MICROSOFT_SCOPES.join(' '), ...params }),
  });
  const body = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || body.error) {
    const error = new Error(body.error_description ?? body.error ?? `token request failed (${response.status})`);
    (error as Error & { code?: string }).code = body.error;
    throw error;
  }
  return body;
}

/** Exchange an authorization code for tokens. Used by the OAuth callback. */
export function exchangeMicrosoftCode(code: string, redirectUri: string): Promise<TokenResponse> {
  return tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
}

/** The address the grant belongs to, for display. */
export async function fetchMicrosoftEmail(accessToken: string): Promise<string> {
  const response = await fetch(`${GRAPH}/me?$select=mail,userPrincipalName`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Could not read the Microsoft account (${response.status})`);
  const body = (await response.json()) as { mail?: string | null; userPrincipalName?: string | null };
  const email = body.mail || body.userPrincipalName;
  if (!email) throw new Error('Microsoft returned no address for this account');
  return email;
}

/** A Graph dateTime in UTC ("2026-11-04T09:00:00.0000000") as an ISO instant. */
export function graphUtcToIso(value: string): string {
  return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`).toISOString();
}

/** Whether a "show as" value blocks time. Free and working-elsewhere do not. */
export function blocksTime(item: GraphViewItem): boolean {
  if (item.isCancelled) return false;
  const showAs = (item.showAs ?? 'busy').toLowerCase();
  return showAs !== 'free' && showAs !== 'workingelsewhere';
}

/** An event id this provider did not create: a booking made under another calendar. */
export function foreignToMicrosoft(eventId: string): boolean {
  return !eventId.startsWith(ID_PREFIX);
}

export class MicrosoftCalendarProvider implements CalendarProvider {
  readonly id = 'microsoft';
  private teams: boolean | null = null;

  constructor(
    private connection: CalendarConnectionRow,
    private readonly scope: TenantScope,
  ) {}

  private async accessToken(): Promise<string> {
    const { access_token_encrypted, access_token_expires_at } = this.connection;
    if (access_token_encrypted && access_token_expires_at) {
      if (new Date(access_token_expires_at).getTime() - REFRESH_SKEW_SECONDS * 1000 > Date.now()) {
        return decryptSecret(access_token_encrypted);
      }
    }
    return this.refresh();
  }

  private async refresh(): Promise<string> {
    let body: TokenResponse;
    try {
      body = await tokenRequest({
        grant_type: 'refresh_token',
        refresh_token: decryptSecret(this.connection.refresh_token_encrypted),
      });
    } catch (cause) {
      const code = (cause as Error & { code?: string }).code;
      // invalid_grant: revoked, expired, or the password changed. Only a
      // reconnect fixes it, so record that and stop trying.
      if (code === 'invalid_grant' || code === 'interaction_required') {
        await this.markStatus('needs_reconnect', (cause as Error).message);
        throw new MicrosoftGrantExpiredError('The Outlook connection has expired — reconnect your calendar.');
      }
      throw new CalendarUnavailableError(`Token refresh failed: ${(cause as Error).message}`, this.id);
    }

    const patch: Partial<CalendarConnectionRow> = {
      access_token_encrypted: encryptSecret(body.access_token),
      access_token_expires_at: new Date(Date.now() + body.expires_in * 1000).toISOString(),
      status: 'active',
      last_error: null,
    };
    // Microsoft rotates refresh tokens: keep the newest one.
    if (body.refresh_token) patch.refresh_token_encrypted = encryptSecret(body.refresh_token);

    await this.scope.update('calendar_connections', patch).eq('id', this.connection.id);
    this.connection = { ...this.connection, ...patch } as CalendarConnectionRow;
    return body.access_token;
  }

  private async markStatus(status: CalendarConnectionRow['status'], error: string | null): Promise<void> {
    await this.scope
      .update('calendar_connections', {
        status,
        last_error: error?.slice(0, 500) ?? null,
        last_checked_at: new Date().toISOString(),
      })
      .eq('id', this.connection.id);
  }

  private async call<T>(pathOrUrl: string, init: RequestInit = {}): Promise<T> {
    const token = await this.accessToken();
    const url = pathOrUrl.startsWith('https://') ? pathOrUrl : `${GRAPH}${pathOrUrl}`;
    const response = await fetch(url, {
      ...init,
      headers: {
        ...init.headers,
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        prefer: 'outlook.timezone="UTC"',
      },
    });
    if (response.status === 204) return undefined as T;
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new CalendarUnavailableError(
        `Outlook ${init.method ?? 'GET'} ${url.replace(GRAPH, '')} failed (${response.status}): ${detail.slice(0, 300)}`,
        this.id,
        response.status,
      );
    }
    return (await response.json()) as T;
  }

  async getBusy(query: BusyQuery): Promise<BusyInterval[]> {
    const params = new URLSearchParams({
      startDateTime: new Date(query.from).toISOString(),
      endDateTime: new Date(query.to).toISOString(),
      $select: 'start,end,showAs,isCancelled',
      $top: '250',
    });
    const busy: BusyInterval[] = [];
    let next: string | null = `/me/calendarView?${params.toString()}`;
    // calendarView pages; follow it, but not for ever.
    for (let page = 0; next && page < 20; page += 1) {
      const result: { value?: GraphViewItem[]; '@odata.nextLink'?: string } = await this.call(next);
      for (const item of result.value ?? []) {
        if (blocksTime(item)) busy.push({ start: graphUtcToIso(item.start.dateTime), end: graphUtcToIso(item.end.dateTime) });
      }
      next = result['@odata.nextLink'] ?? null;
    }
    return busy;
  }

  /** Whether this calendar can make Teams meetings (work or school accounts with Teams). */
  private async canMakeTeams(): Promise<boolean> {
    if (this.teams !== null) return this.teams;
    try {
      const calendar = await this.call<{ allowedOnlineMeetingProviders?: string[] }>(
        '/me/calendar?$select=allowedOnlineMeetingProviders',
      );
      this.teams = (calendar.allowedOnlineMeetingProviders ?? []).some((p) => p.toLowerCase() === 'teamsforbusiness');
    } catch {
      this.teams = false;
    }
    return this.teams;
  }

  private body(input: CalendarEventInput) {
    const who = [input.attendeeName, input.attendeeEmail].filter(Boolean).join(' · ');
    const notes = [who && `Client: ${who}`, input.description].filter(Boolean).join('\n\n');
    return {
      subject: input.summary,
      body: { contentType: 'text', content: notes },
      // The instants in UTC; Outlook shows them in the owner's own zone.
      start: { dateTime: new Date(input.start).toISOString().replace('Z', ''), timeZone: 'UTC' },
      end: { dateTime: new Date(input.end).toISOString().replace('Z', ''), timeZone: 'UTC' },
    };
  }

  private static link(event: GraphEvent): string | null {
    return event.onlineMeeting?.joinUrl || null;
  }

  async createEvent(input: CalendarEventInput): Promise<CalendarEvent> {
    const teams = input.createConference ? await this.canMakeTeams() : false;
    let event = await this.call<GraphEvent>('/me/calendar/events', {
      method: 'POST',
      body: JSON.stringify({
        ...this.body(input),
        ...(teams ? { isOnlineMeeting: true, onlineMeetingProvider: 'teamsForBusiness' } : {}),
      }),
    });

    let link = MicrosoftCalendarProvider.link(event);
    // The Teams link can take a moment to be attached; read the event again briefly.
    for (let attempt = 0; teams && !link && attempt < LINK_POLL_ATTEMPTS; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, LINK_POLL_DELAY_MS));
      event = await this.call<GraphEvent>(`/me/events/${encodeURIComponent(event.id)}?$select=id,onlineMeeting`);
      link = MicrosoftCalendarProvider.link(event);
    }
    return { eventId: `${ID_PREFIX}${event.id}`, meetingUrl: link };
  }

  async updateEvent(eventId: string, input: CalendarEventInput): Promise<CalendarEvent> {
    // Made while another calendar was connected: it lives there, not here.
    if (foreignToMicrosoft(eventId)) return { eventId, meetingUrl: null };
    const event = await this.call<GraphEvent>(`/me/events/${encodeURIComponent(eventId.slice(ID_PREFIX.length))}`, {
      method: 'PATCH',
      body: JSON.stringify(this.body(input)),
    });
    return { eventId, meetingUrl: MicrosoftCalendarProvider.link(event) };
  }

  async deleteEvent(eventId: string): Promise<void> {
    if (foreignToMicrosoft(eventId)) return;
    try {
      await this.call<void>(`/me/events/${encodeURIComponent(eventId.slice(ID_PREFIX.length))}`, { method: 'DELETE' });
    } catch (error) {
      if (error instanceof CalendarUnavailableError && (error.status === 404 || error.status === 410)) return;
      throw error;
    }
  }

  async readMeetingUrl(eventId: string): Promise<string | null> {
    if (!eventId || foreignToMicrosoft(eventId)) return null;
    try {
      const event = await this.call<GraphEvent>(
        `/me/events/${encodeURIComponent(eventId.slice(ID_PREFIX.length))}?$select=id,onlineMeeting`,
      );
      return MicrosoftCalendarProvider.link(event);
    } catch {
      return null;
    }
  }

  async healthCheck(): Promise<CalendarHealth> {
    const checkedAt = new Date().toISOString();
    try {
      const now = new Date();
      await this.getBusy({ from: now.toISOString(), to: new Date(now.getTime() + 60_000).toISOString(), timezone: 'UTC' });
      await this.markStatus('active', null);
      return { connected: true, accountEmail: this.connection.account_email, checkedAt };
    } catch (error) {
      const message = (error as Error).message;
      if (!(error instanceof MicrosoftGrantExpiredError)) await this.markStatus(this.connection.status, message);
      return { connected: false, accountEmail: this.connection.account_email, checkedAt, error: message };
    }
  }
}
