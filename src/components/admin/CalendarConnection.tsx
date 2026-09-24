'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminFetchJson } from '@/lib/admin-fetch';

type CalendarStatus = 'active' | 'needs_reconnect' | 'revoked';

interface CalendarInfo {
  connected: boolean;
  status: 'not_connected' | CalendarStatus;
  accountEmail: string | null;
  health: { connected: boolean; error?: string; checkedAt: string } | null;
}

const STATUS_COPY: Record<CalendarInfo['status'], { label: string; tone: 'live' | 'attention' | 'muted' }> = {
  not_connected: { label: 'Not connected', tone: 'muted' },
  active: { label: 'Connected', tone: 'live' },
  needs_reconnect: { label: 'Needs reconnecting', tone: 'attention' },
  revoked: { label: 'Disconnected by Google', tone: 'attention' },
};

function toneStyle(tone: 'live' | 'attention' | 'muted') {
  if (tone === 'live') return { background: 'var(--status-live-tint)', color: 'var(--status-live-ink)' };
  if (tone === 'attention') return { background: 'var(--status-attention-tint)', color: 'var(--status-attention-ink)' };
  return { background: 'var(--accent-tint)', color: 'var(--faint)' };
}

/**
 * Google Calendar, on the Week: the screen whose hours it closes and whose
 * bookings it receives. It lived in Settings, a page away from the only
 * picture it changes.
 */
export function CalendarConnection({ slug }: { slug: string }) {
  const url = `/api/admin/${slug}/calendar`;
  const [calendar, setCalendar] = useState<CalendarInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setCalendar(await adminFetchJson<CalendarInfo>(url));
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, [url]);

  useEffect(() => {
    void load();
  }, [load]);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const result = await adminFetchJson<{ url: string }>(url, { method: 'POST' });
      window.location.href = result.url;
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      await adminFetchJson(url, { method: 'DELETE' });
      setConfirming(false);
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cal-conn">
      <p className="wk-side-lead" style={{ marginTop: 0 }}>
        Busy times there close your hours here, and bookings are added to it with a video link.
      </p>
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      {!calendar ? (
        <p className="wk-side-hint">Checking…</p>
      ) : (
        <>
          <p className="cal-conn-state">
            <span className="notice" style={{ padding: '3px 10px', margin: 0, ...toneStyle(STATUS_COPY[calendar.status].tone) }}>
              {STATUS_COPY[calendar.status].label}
            </span>
            {calendar.accountEmail && <span className="wk-muted">{calendar.accountEmail}</span>}
          </p>
          {calendar.health?.error && <p className="notice notice-error">{calendar.health.error}</p>}
          {confirming ? (
            <div className="wk-actions">
              <span className="wk-side-hint" style={{ margin: 0 }}>
                New bookings will stop reaching your calendar.
              </span>
              <button type="button" className="btn-primary" disabled={busy} onClick={() => void disconnect()}>
                {busy ? 'Disconnecting…' : 'Disconnect'}
              </button>
              <button type="button" className="btn-link" onClick={() => setConfirming(false)}>
                Keep it
              </button>
            </div>
          ) : (
            <div className="wk-actions">
              {calendar.status === 'not_connected' || calendar.status === 'revoked' ? (
                <button type="button" className="btn-primary" disabled={busy} onClick={() => void connect()}>
                  {busy ? 'Connecting…' : 'Connect Google Calendar'}
                </button>
              ) : calendar.status === 'needs_reconnect' ? (
                <>
                  <button type="button" className="btn-primary" disabled={busy} onClick={() => void connect()}>
                    {busy ? 'Reconnecting…' : 'Reconnect'}
                  </button>
                  <button type="button" className="btn-link" onClick={() => setConfirming(true)}>
                    Disconnect
                  </button>
                </>
              ) : (
                <button type="button" className="btn-link" onClick={() => setConfirming(true)}>
                  Disconnect
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
