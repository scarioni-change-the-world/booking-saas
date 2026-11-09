import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MICROSOFT_SCOPES,
  MicrosoftCalendarProvider,
  MicrosoftGrantExpiredError,
  blocksTime,
  foreignToMicrosoft,
  graphUtcToIso,
} from '@/lib/calendar/microsoft';
import { GoogleCalendarProvider } from '@/lib/calendar/google';
import { encryptSecret } from '@/lib/crypto';
import type { TenantScope } from '@/lib/db';
import type { CalendarConnectionRow } from '@/lib/db/types';

const SECRET = 'test-secret-that-is-at-least-32-characters-long';

function fakeScope() {
  const updates: Array<Record<string, unknown>> = [];
  const scope = {
    update(_table: string, patch: Record<string, unknown>) {
      updates.push(patch);
      return { eq: async () => ({ error: null }) };
    },
  } as unknown as TenantScope;
  return { scope, updates };
}

function connection(overrides: Partial<CalendarConnectionRow> = {}): CalendarConnectionRow {
  return {
    id: 'conn-1',
    tenant_id: 'tenant-1',
    provider: 'microsoft',
    account_email: 'coach@outlook.com',
    calendar_id: 'primary',
    refresh_token_encrypted: encryptSecret('refresh-token-value'),
    access_token_encrypted: encryptSecret('cached-access-token'),
    access_token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    granted_scopes: [...MICROSOFT_SCOPES],
    status: 'active',
    last_checked_at: null,
    last_error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as CalendarConnectionRow;
}

interface Call {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

function mockFetch(responses: Array<{ status?: number; json?: unknown; text?: string }>) {
  const calls: Call[] = [];
  let index = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      let body: unknown = init?.body;
      if (typeof body === 'string' && body.startsWith('{')) body = JSON.parse(body);
      calls.push({ url, method: init?.method ?? 'GET', body, headers: (init?.headers ?? {}) as Record<string, string> });
      const next = responses[Math.min(index, responses.length - 1)];
      index += 1;
      return {
        ok: (next?.status ?? 200) < 400,
        status: next?.status ?? 200,
        json: async () => next?.json ?? {},
        text: async () => next?.text ?? '',
      } as Response;
    }),
  );
  return calls;
}

beforeEach(() => {
  process.env.APP_SECRET = SECRET;
  process.env.MICROSOFT_CLIENT_ID = 'ms-client';
  process.env.MICROSOFT_CLIENT_SECRET = 'ms-secret';
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('helpers', () => {
  it('reads Graph UTC times as instants', () => {
    expect(graphUtcToIso('2026-11-04T09:00:00.0000000')).toBe('2026-11-04T09:00:00.000Z');
    expect(graphUtcToIso('2026-11-04T09:00:00Z')).toBe('2026-11-04T09:00:00.000Z');
  });

  it('treats free and working-elsewhere as not busy, and cancelled events as nothing', () => {
    const t = { start: { dateTime: '' }, end: { dateTime: '' } };
    expect(blocksTime({ ...t, showAs: 'busy' })).toBe(true);
    expect(blocksTime({ ...t, showAs: 'oof' })).toBe(true);
    expect(blocksTime({ ...t, showAs: 'tentative' })).toBe(true);
    expect(blocksTime({ ...t, showAs: 'free' })).toBe(false);
    expect(blocksTime({ ...t, showAs: 'workingElsewhere' })).toBe(false);
    expect(blocksTime({ ...t, showAs: 'busy', isCancelled: true })).toBe(false);
  });

  it('asks for the smallest set of permissions', () => {
    expect([...MICROSOFT_SCOPES].sort()).toEqual(['Calendars.ReadWrite', 'User.Read', 'offline_access'].sort());
  });

  it('knows its own event ids from another calendar’s', () => {
    expect(foreignToMicrosoft('ms:AAMk')).toBe(false);
    expect(foreignToMicrosoft('abc123googleid')).toBe(true);
  });
});

describe('MicrosoftCalendarProvider', () => {
  it('reads busy times from calendarView, asking only for times, and follows pages', async () => {
    const calls = mockFetch([
      {
        json: {
          value: [
            { start: { dateTime: '2026-11-04T09:00:00.0000000' }, end: { dateTime: '2026-11-04T10:00:00.0000000' }, showAs: 'busy' },
            { start: { dateTime: '2026-11-04T11:00:00.0000000' }, end: { dateTime: '2026-11-04T12:00:00.0000000' }, showAs: 'free' },
          ],
          '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/calendarView?page=2',
        },
      },
      { json: { value: [{ start: { dateTime: '2026-11-05T08:00:00' }, end: { dateTime: '2026-11-05T08:30:00' }, showAs: 'oof' }] } },
    ]);
    const { scope } = fakeScope();
    const busy = await new MicrosoftCalendarProvider(connection(), scope).getBusy({
      from: '2026-11-04T00:00:00Z',
      to: '2026-11-06T00:00:00Z',
      timezone: 'Europe/Madrid',
    });
    expect(busy).toEqual([
      { start: '2026-11-04T09:00:00.000Z', end: '2026-11-04T10:00:00.000Z' },
      { start: '2026-11-05T08:00:00.000Z', end: '2026-11-05T08:30:00.000Z' },
    ]);
    expect(calls[0]!.url).toContain('/me/calendarView?');
    expect(decodeURIComponent(calls[0]!.url)).toContain('$select=start,end,showAs,isCancelled');
    expect(calls[0]!.headers.prefer).toBe('outlook.timezone="UTC"');
    expect(calls[1]!.url).toBe('https://graph.microsoft.com/v1.0/me/calendarView?page=2');
  });

  it('creates an event without attendees (no Microsoft invitation), with a Teams link when allowed', async () => {
    const calls = mockFetch([
      { json: { allowedOnlineMeetingProviders: ['teamsForBusiness'] } },
      { json: { id: 'AAMkEvent', onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/x' } } },
    ]);
    const { scope } = fakeScope();
    const event = await new MicrosoftCalendarProvider(connection(), scope).createEvent({
      summary: 'Discovery call — Ana',
      description: 'Looking forward',
      start: '2026-11-04T09:00:00.000Z',
      end: '2026-11-04T09:30:00.000Z',
      timezone: 'Europe/Madrid',
      attendeeEmail: 'ana@example.com',
      attendeeName: 'Ana',
      createConference: true,
    });
    expect(event).toEqual({ eventId: 'ms:AAMkEvent', meetingUrl: 'https://teams.microsoft.com/l/meetup-join/x' });
    const body = calls[1]!.body as Record<string, unknown>;
    expect(body.attendees).toBeUndefined();
    expect(body.isOnlineMeeting).toBe(true);
    expect(body.onlineMeetingProvider).toBe('teamsForBusiness');
    expect(body.start).toEqual({ dateTime: '2026-11-04T09:00:00.000', timeZone: 'UTC' });
    expect(JSON.stringify(body.body)).toContain('ana@example.com');
  });

  it('makes no Teams request on a personal account', async () => {
    const calls = mockFetch([
      { json: { allowedOnlineMeetingProviders: ['skypeForConsumer'] } },
      { json: { id: 'AAMkEvent' } },
    ]);
    const { scope } = fakeScope();
    const event = await new MicrosoftCalendarProvider(connection(), scope).createEvent({
      summary: 's',
      start: '2026-11-04T09:00:00Z',
      end: '2026-11-04T09:30:00Z',
      timezone: 'UTC',
      createConference: true,
    });
    expect(event.meetingUrl).toBeNull();
    expect((calls[1]!.body as Record<string, unknown>).isOnlineMeeting).toBeUndefined();
  });

  it('leaves events made under Google alone, and deletes its own', async () => {
    const calls = mockFetch([{ status: 204 }]);
    const { scope } = fakeScope();
    const provider = new MicrosoftCalendarProvider(connection(), scope);
    await provider.deleteEvent('googleeventid');
    await provider.updateEvent('googleeventid', { summary: 's', start: '2026-11-04T09:00:00Z', end: '2026-11-04T09:30:00Z', timezone: 'UTC' });
    expect(calls).toHaveLength(0);
    await provider.deleteEvent('ms:AAMkEvent');
    expect(calls[0]!.method).toBe('DELETE');
    expect(calls[0]!.url).toContain('/me/events/AAMkEvent');
  });

  it('keeps the rotated refresh token, and asks for a reconnect when the grant is dead', async () => {
    mockFetch([{ json: { access_token: 'new-access', expires_in: 3600, refresh_token: 'rotated' } }, { json: { value: [] } }]);
    const { scope, updates } = fakeScope();
    await new MicrosoftCalendarProvider(connection({ access_token_expires_at: null }), scope).getBusy({
      from: '2026-11-04T00:00:00Z',
      to: '2026-11-04T01:00:00Z',
      timezone: 'UTC',
    });
    expect(updates[0]!.refresh_token_encrypted).toBeTruthy();

    mockFetch([{ status: 400, json: { error: 'invalid_grant', error_description: 'expired' } }]);
    const second = fakeScope();
    await expect(
      new MicrosoftCalendarProvider(connection({ access_token_expires_at: null }), second.scope).getBusy({
        from: '2026-11-04T00:00:00Z',
        to: '2026-11-04T01:00:00Z',
        timezone: 'UTC',
      }),
    ).rejects.toBeInstanceOf(MicrosoftGrantExpiredError);
    expect(second.updates[0]!.status).toBe('needs_reconnect');
  });
});

describe('GoogleCalendarProvider with an Outlook-made event', () => {
  it('leaves it alone', async () => {
    process.env.GOOGLE_CLIENT_ID = 'g';
    process.env.GOOGLE_CLIENT_SECRET = 'g';
    const calls = mockFetch([{ status: 204 }]);
    const { scope } = fakeScope();
    const google = new GoogleCalendarProvider(connection({ provider: 'google' }), scope);
    await google.deleteEvent('ms:AAMkEvent');
    expect(await google.readMeetingUrl('ms:AAMkEvent')).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
