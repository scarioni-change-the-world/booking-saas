import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GOOGLE_SCOPES,
  GoogleCalendarProvider,
  GoogleGrantExpiredError,
} from '@/lib/calendar/google';
import { CalendarUnavailableError } from '@/lib/calendar/provider';
import { encryptSecret } from '@/lib/crypto';
import type { TenantScope } from '@/lib/db';
import type { CalendarConnectionRow } from '@/lib/db/types';

const SECRET = 'test-secret-that-is-at-least-32-characters-long';

/** Records the writes the provider makes back to calendar_connections. */
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
    provider: 'google',
    account_email: 'coach@example.com',
    calendar_id: 'primary',
    refresh_token_encrypted: encryptSecret('refresh-token-value'),
    access_token_encrypted: encryptSecret('cached-access-token'),
    // Valid for an hour, so nothing refreshes unless a test says otherwise.
    access_token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    granted_scopes: [...GOOGLE_SCOPES],
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
}

/** Queue of responses, consumed in order, with every request recorded. */
function mockFetch(responses: Array<{ status?: number; json?: unknown; text?: string }>) {
  const calls: Call[] = [];
  let index = 0;

  const impl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    let body: unknown = init?.body;
    if (typeof body === 'string' && body.startsWith('{')) body = JSON.parse(body);
    calls.push({ url, method: init?.method ?? 'GET', body });

    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;

    return {
      ok: (next?.status ?? 200) < 400,
      status: next?.status ?? 200,
      json: async () => next?.json ?? {},
      text: async () => next?.text ?? '',
    } as Response;
  });

  vi.stubGlobal('fetch', impl);
  return calls;
}

beforeEach(() => {
  process.env.APP_SECRET = SECRET;
  process.env.GOOGLE_CLIENT_ID = 'client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('scopes (brief 6.6 — stay out of CASA)', () => {
  it('requests the Sensitive scopes, never the broad calendar scope', () => {
    // calendar.events and calendar.freebusy are Sensitive: verification, but no
    // paid annual CASA assessment. The broad `calendar` scope buys nothing here
    // and raises the tier.
    expect(GOOGLE_SCOPES).toContain('https://www.googleapis.com/auth/calendar.events');
    expect(GOOGLE_SCOPES).toContain('https://www.googleapis.com/auth/calendar.freebusy');
    expect(GOOGLE_SCOPES).not.toContain('https://www.googleapis.com/auth/calendar');
  });
});

describe('access tokens (brief 7.7)', () => {
  it('uses the cached token instead of refreshing on every request', async () => {
    const { scope } = fakeScope();
    const calls = mockFetch([{ json: { calendars: { primary: { busy: [] } } } }]);

    await new GoogleCalendarProvider(connection(), scope).getBusy({
      from: '2027-01-01T00:00:00Z',
      to: '2027-01-02T00:00:00Z',
      timezone: 'UTC',
    });

    // One call — freeBusy. No token endpoint round-trip.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('/freeBusy');
    expect(calls.some((c) => c.url.includes('oauth2.googleapis.com/token'))).toBe(false);
  });

  it('refreshes an expired token, then makes the call', async () => {
    const { scope, updates } = fakeScope();
    const calls = mockFetch([
      { json: { access_token: 'fresh-token', expires_in: 3600 } },
      { json: { calendars: { primary: { busy: [] } } } },
    ]);

    await new GoogleCalendarProvider(
      connection({ access_token_expires_at: new Date(Date.now() - 1000).toISOString() }),
      scope,
    ).getBusy({ from: '2027-01-01T00:00:00Z', to: '2027-01-02T00:00:00Z', timezone: 'UTC' });

    expect(calls[0]!.url).toContain('oauth2.googleapis.com/token');
    expect(calls[1]!.url).toContain('/freeBusy');
    // The new token is persisted, so the next request does not refresh again.
    expect(updates[0]).toHaveProperty('access_token_encrypted');
    expect(updates[0]!.access_token_encrypted).not.toBe('fresh-token');
  });

  it('refreshes just before expiry rather than racing the clock', async () => {
    const { scope } = fakeScope();
    const calls = mockFetch([
      { json: { access_token: 'fresh', expires_in: 3600 } },
      { json: { calendars: { primary: { busy: [] } } } },
    ]);

    // 30 seconds left: inside the skew window, so it must refresh.
    await new GoogleCalendarProvider(
      connection({ access_token_expires_at: new Date(Date.now() + 30_000).toISOString() }),
      scope,
    ).getBusy({ from: '2027-01-01T00:00:00Z', to: '2027-01-02T00:00:00Z', timezone: 'UTC' });

    expect(calls[0]!.url).toContain('oauth2.googleapis.com/token');
  });

  it('persists a rotated refresh token', async () => {
    const { scope, updates } = fakeScope();
    mockFetch([
      { json: { access_token: 'fresh', expires_in: 3600, refresh_token: 'rotated' } },
      { json: { calendars: { primary: { busy: [] } } } },
    ]);

    await new GoogleCalendarProvider(
      connection({ access_token_expires_at: new Date(Date.now() - 1000).toISOString() }),
      scope,
    ).getBusy({ from: '2027-01-01T00:00:00Z', to: '2027-01-02T00:00:00Z', timezone: 'UTC' });

    expect(updates[0]).toHaveProperty('refresh_token_encrypted');
  });
});

describe('dead grants (brief 6.3)', () => {
  it('marks the connection needs_reconnect on invalid_grant', async () => {
    // The Testing-mode 7-day expiry, and the reason publishing to Production
    // still requires one disconnect/reconnect cycle.
    const { scope, updates } = fakeScope();
    mockFetch([
      { status: 400, json: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } },
    ]);

    const provider = new GoogleCalendarProvider(
      connection({ access_token_expires_at: new Date(Date.now() - 1000).toISOString() }),
      scope,
    );

    await expect(
      provider.getBusy({ from: '2027-01-01T00:00:00Z', to: '2027-01-02T00:00:00Z', timezone: 'UTC' }),
    ).rejects.toBeInstanceOf(GoogleGrantExpiredError);

    expect(updates[0]).toMatchObject({ status: 'needs_reconnect' });
  });

  it('treats a transient token failure as unavailable, not as a dead grant', async () => {
    const { scope, updates } = fakeScope();
    mockFetch([{ status: 503, json: { error: 'backend_error' } }]);

    const provider = new GoogleCalendarProvider(
      connection({ access_token_expires_at: new Date(Date.now() - 1000).toISOString() }),
      scope,
    );

    await expect(
      provider.getBusy({ from: '2027-01-01T00:00:00Z', to: '2027-01-02T00:00:00Z', timezone: 'UTC' }),
    ).rejects.toBeInstanceOf(CalendarUnavailableError);

    // Must not be marked needs_reconnect — the grant is fine, Google was not.
    expect(updates.some((u) => u.status === 'needs_reconnect')).toBe(false);
  });
});

describe('getBusy (brief 6.8 — degraded modes must be visible)', () => {
  it('returns the busy intervals', async () => {
    const { scope } = fakeScope();
    mockFetch([
      {
        json: {
          calendars: {
            primary: {
              busy: [{ start: '2027-01-01T09:00:00Z', end: '2027-01-01T10:00:00Z' }],
            },
          },
        },
      },
    ]);

    const busy = await new GoogleCalendarProvider(connection(), scope).getBusy({
      from: '2027-01-01T00:00:00Z',
      to: '2027-01-02T00:00:00Z',
      timezone: 'UTC',
    });

    expect(busy).toEqual([{ start: '2027-01-01T09:00:00Z', end: '2027-01-01T10:00:00Z' }]);
  });

  it('throws rather than reporting "no busy times" when the calendar is unreadable', async () => {
    // freeBusy answers 200 with a per-calendar errors array. Reading that as an
    // empty busy list would offer every slot as free — the exact silent
    // degradation that let a dead integration serve double bookings.
    const { scope } = fakeScope();
    mockFetch([
      { json: { calendars: { primary: { errors: [{ reason: 'notFound' }] } } } },
    ]);

    await expect(
      new GoogleCalendarProvider(connection(), scope).getBusy({
        from: '2027-01-01T00:00:00Z',
        to: '2027-01-02T00:00:00Z',
        timezone: 'UTC',
      }),
    ).rejects.toBeInstanceOf(CalendarUnavailableError);
  });
});

describe('createEvent and Meet links (brief 6.7)', () => {
  const input = {
    summary: 'Discovery call — Ana',
    start: '2027-01-04T09:00:00Z',
    end: '2027-01-04T09:30:00Z',
    timezone: 'Europe/Madrid',
    attendeeEmail: 'ana@example.com',
    attendeeName: 'Ana',
    createConference: true,
  };

  it('reads the link from entryPoints when hangoutLink is absent', async () => {
    // The bug: reading only hangoutLink stored null, and the confirmation email
    // silently dropped the video link with nothing logged.
    const { scope } = fakeScope();
    mockFetch([
      {
        json: {
          id: 'event-1',
          conferenceData: {
            createRequest: { status: { statusCode: 'success' } },
            entryPoints: [
              { entryPointType: 'phone', uri: 'tel:+34000000000' },
              { entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij' },
            ],
          },
        },
      },
    ]);

    const event = await new GoogleCalendarProvider(connection(), scope).createEvent(input);
    expect(event.meetingUrl).toBe('https://meet.google.com/abc-defg-hij');
  });

  it('re-reads the event while the conference request is still pending', async () => {
    const { scope } = fakeScope();
    const calls = mockFetch([
      { json: { id: 'event-1', conferenceData: { createRequest: { status: { statusCode: 'pending' } } } } },
      {
        json: {
          id: 'event-1',
          conferenceData: {
            createRequest: { status: { statusCode: 'success' } },
            entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/xyz' }],
          },
        },
      },
    ]);

    const event = await new GoogleCalendarProvider(connection(), scope).createEvent(input);

    expect(event.meetingUrl).toBe('https://meet.google.com/xyz');
    expect(calls[0]!.method).toBe('POST');
    expect(calls[1]!.method).toBe('GET'); // the re-read
  });

  it('reports the event created with a null link when it never resolves', async () => {
    // Honest rather than throwing: the booking is real and the event exists.
    const { scope } = fakeScope();
    mockFetch([
      { json: { id: 'event-1', conferenceData: { createRequest: { status: { statusCode: 'pending' } } } } },
    ]);

    const event = await new GoogleCalendarProvider(connection(), scope).createEvent(input);
    expect(event.eventId).toBe('event-1');
    expect(event.meetingUrl).toBeNull();
  });

  it('never lets Google email the attendee', async () => {
    // brief 2.7: the app owns all client communication. A Google invite
    // alongside the branded confirmation reads as a duplicate booking.
    const { scope } = fakeScope();
    const calls = mockFetch([{ json: { id: 'event-1', hangoutLink: 'https://meet.google.com/a' } }]);

    await new GoogleCalendarProvider(connection(), scope).createEvent(input);
    expect(calls[0]!.url).toContain('sendUpdates=none');
    expect(calls[0]!.url).toContain('conferenceDataVersion=1');
  });

  it('does not request a conference when the caller did not ask for one', async () => {
    const { scope } = fakeScope();
    const calls = mockFetch([{ json: { id: 'event-1' } }]);

    await new GoogleCalendarProvider(connection(), scope).createEvent({
      ...input,
      createConference: false,
    });

    expect(calls[0]!.body).not.toHaveProperty('conferenceData');
  });
});

describe('updateEvent', () => {
  it('patches rather than replacing, so the existing Meet link survives', async () => {
    const { scope } = fakeScope();
    const calls = mockFetch([{ json: { id: 'event-1', hangoutLink: 'https://meet.google.com/a' } }]);

    await new GoogleCalendarProvider(connection(), scope).updateEvent('event-1', {
      summary: 'Moved',
      start: '2027-01-05T09:00:00Z',
      end: '2027-01-05T09:30:00Z',
      timezone: 'Europe/Madrid',
    });

    expect(calls[0]!.method).toBe('PATCH');
    expect(calls[0]!.url).toContain('sendUpdates=none');
    expect(calls[0]!.body).not.toHaveProperty('conferenceData');
  });
});

describe('conference data on the re-read (brief 6.7)', () => {
  it('asks for conferenceDataVersion when polling a pending event', async () => {
    // The poll exists to read entryPoints[], which is what conferenceDataVersion
    // governs. Omitting it on the re-read can return an event with no
    // conferenceData at all, leaving only the hangoutLink that is still empty —
    // silently defeating the fix.
    const { scope } = fakeScope();
    const calls = mockFetch([
      { json: { id: 'e1', conferenceData: { createRequest: { status: { statusCode: 'pending' } } } } },
      {
        json: {
          id: 'e1',
          conferenceData: {
            createRequest: { status: { statusCode: 'success' } },
            entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/z' }],
          },
        },
      },
    ]);

    await new GoogleCalendarProvider(connection(), scope).createEvent({
      summary: 'x',
      start: '2027-01-04T09:00:00Z',
      end: '2027-01-04T09:30:00Z',
      timezone: 'UTC',
      createConference: true,
    });

    expect(calls[1]!.method).toBe('GET');
    expect(calls[1]!.url).toContain('conferenceDataVersion=1');
  });
});

describe('readMeetingUrl — the repair path', () => {
  it('reads the link off an event booked before the link resolved', async () => {
    const { scope } = fakeScope();
    const calls = mockFetch([
      {
        json: {
          id: 'e1',
          conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/late' }] },
        },
      },
    ]);

    const url = await new GoogleCalendarProvider(connection(), scope).readMeetingUrl('e1');
    expect(url).toBe('https://meet.google.com/late');
    expect(calls[0]!.url).toContain('conferenceDataVersion=1');
  });

  it('returns null rather than throwing when the event is gone', async () => {
    // Used to backfill in bulk, so one deleted event must not abort the run.
    const { scope } = fakeScope();
    mockFetch([{ status: 404, text: 'not found' }]);
    await expect(
      new GoogleCalendarProvider(connection(), scope).readMeetingUrl('e1'),
    ).resolves.toBeNull();
  });

  it('returns null for an empty id without calling Google', async () => {
    const { scope } = fakeScope();
    const calls = mockFetch([{ json: {} }]);
    await expect(
      new GoogleCalendarProvider(connection(), scope).readMeetingUrl(''),
    ).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe('diagnoseConference', () => {
  it('distinguishes a failed conference request from a slow one', async () => {
    // statusCode 'failure' never resolves however long you poll — usually a
    // Workspace policy blocking Meet creation. Adding retries is the wrong fix.
    const { scope } = fakeScope();
    mockFetch([
      { json: { id: 'diag', conferenceData: { createRequest: { status: { statusCode: 'failure' } } } } },
      { json: { id: 'diag', conferenceData: { createRequest: { status: { statusCode: 'failure' } } } } },
      { status: 204 },
    ]);

    const result = await new GoogleCalendarProvider(connection(), scope).diagnoseConference();
    expect(result.ok).toBe(true);
    expect((result.afterRetry as { status: string }).status).toBe('failure');
    expect((result.afterRetry as { resolvedUrl: string | null }).resolvedUrl).toBeNull();
  });

  it('always deletes the probe event, even when the check fails', async () => {
    const { scope } = fakeScope();
    const calls = mockFetch([
      { json: { id: 'diag' } },
      { status: 500, text: 'boom' },
      { status: 204 },
    ]);

    await new GoogleCalendarProvider(connection(), scope).diagnoseConference();
    expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('diag'))).toBe(true);
  });
});

describe('deleteEvent', () => {
  it('treats an already-deleted event as success', async () => {
    const { scope } = fakeScope();
    mockFetch([{ status: 410, text: 'deleted' }]);

    await expect(
      new GoogleCalendarProvider(connection(), scope).deleteEvent('event-1'),
    ).resolves.toBeUndefined();
  });

  it('branches on the HTTP status, not on the message text', async () => {
    // A provider error body containing a parenthesised number must not be
    // mistaken for a 404, and rewording the message must not change behaviour.
    const { scope } = fakeScope();
    mockFetch([{ status: 500, text: 'upstream said (404) somewhere in this text' }]);

    await expect(
      new GoogleCalendarProvider(connection(), scope).deleteEvent('e1'),
    ).rejects.toBeInstanceOf(CalendarUnavailableError);
  });

  it('still reports a real failure', async () => {
    const { scope } = fakeScope();
    mockFetch([{ status: 500, text: 'server error' }]);

    await expect(
      new GoogleCalendarProvider(connection(), scope).deleteEvent('event-1'),
    ).rejects.toBeInstanceOf(CalendarUnavailableError);
  });
});

describe('healthCheck (brief 6.8)', () => {
  it('actually calls Google rather than checking for a stored email', async () => {
    const { scope } = fakeScope();
    const calls = mockFetch([{ json: { calendars: { primary: { busy: [] } } } }]);

    const health = await new GoogleCalendarProvider(connection(), scope).healthCheck();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('/freeBusy');
    expect(health.connected).toBe(true);
    expect(health.checkedAt).toBeTruthy();
  });

  it('reports disconnected with the reason when the call fails', async () => {
    const { scope } = fakeScope();
    mockFetch([{ status: 403, text: 'insufficient permissions' }]);

    const health = await new GoogleCalendarProvider(connection(), scope).healthCheck();

    expect(health.connected).toBe(false);
    expect(health.error).toContain('403');
  });

  it('records the outcome so the dashboard can surface it', async () => {
    const { scope, updates } = fakeScope();
    mockFetch([{ json: { calendars: { primary: { busy: [] } } } }]);

    await new GoogleCalendarProvider(connection(), scope).healthCheck();
    expect(updates[0]).toMatchObject({ status: 'active', last_error: null });
    expect(updates[0]).toHaveProperty('last_checked_at');
  });
});
