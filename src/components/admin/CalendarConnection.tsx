'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminFetchJson } from '@/lib/admin-fetch';

type CalendarStatus = 'active' | 'needs_reconnect' | 'revoked';

type ProviderId = 'google' | 'microsoft';

interface CalendarInfo {
  connected: boolean;
  status: 'not_connected' | CalendarStatus;
  provider: ProviderId | null;
  accountEmail: string | null;
  health: { connected: boolean; error?: string; checkedAt: string } | null;
  /** Which calendars can be connected here (their keys are set up). */
  available?: { google: boolean; microsoft: boolean };
}

const PROVIDER_NAME: Record<ProviderId, string> = { google: 'Google Calendar', microsoft: 'Outlook' };

const STATUS_COPY: Record<CalendarInfo['status'], { label: string; tone: 'live' | 'attention' | 'muted' }> = {
  not_connected: { label: 'Not connected', tone: 'muted' },
  active: { label: 'Connected', tone: 'live' },
  needs_reconnect: { label: 'Needs reconnecting', tone: 'attention' },
  revoked: { label: 'Disconnected', tone: 'attention' },
};

function toneStyle(tone: 'live' | 'attention' | 'muted') {
  if (tone === 'live') return { background: 'var(--status-live-tint)', color: 'var(--status-live-ink)' };
  if (tone === 'attention') return { background: 'var(--status-attention-tint)', color: 'var(--status-attention-ink)' };
  return { background: 'var(--accent-tint)', color: 'var(--faint)' };
}

/**
 * The business's calendar — Google or Outlook, one at a time — on the Week:
 * the screen whose hours it closes and whose bookings it receives.
 * Connecting the other one replaces it.
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

  async function connect(provider: ProviderId) {
    setBusy(true);
    setError(null);
    try {
      const result = await adminFetchJson<{ url: string }>(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
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
        Busy times there close your hours here, and bookings are added to it. Google adds a Meet link; Outlook
        adds a Teams link on work or school accounts with Teams.
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
            {calendar.provider && <b className="cal-conn-which">{PROVIDER_NAME[calendar.provider]}</b>}
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
                <>
                  {offered(calendar).map((p, i) => (
                    <button
                      key={p}
                      type="button"
                      className={i === 0 ? 'btn-primary' : 'btn-secondary'}
                      disabled={busy}
                      onClick={() => void connect(p)}
                    >
                      {busy ? 'Connecting…' : `Connect ${PROVIDER_NAME[p]}`}
                    </button>
                  ))}
                  {offered(calendar).length === 0 && (
                    <span className="wk-side-hint" style={{ margin: 0 }}>
                      Calendar connections aren’t switched on yet.
                    </span>
                  )}
                </>
              ) : calendar.status === 'needs_reconnect' ? (
                <>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={busy}
                    onClick={() => void connect(calendar.provider ?? 'google')}
                  >
                    {busy ? 'Reconnecting…' : 'Reconnect'}
                  </button>
                  <button type="button" className="btn-link" onClick={() => setConfirming(true)}>
                    Disconnect
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="btn-link" onClick={() => setConfirming(true)}>
                    Disconnect
                  </button>
                  {calendar.provider && offered(calendar).includes(other(calendar.provider)) && (
                    <button
                      type="button"
                      className="btn-link"
                      disabled={busy}
                      onClick={() => void connect(other(calendar.provider!))}
                    >
                      Use {PROVIDER_NAME[other(calendar.provider)]} instead
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function other(p: ProviderId): ProviderId {
  return p === 'google' ? 'microsoft' : 'google';
}

/** The calendars this khloe can connect, Google first. Without the list (an older server), Google. */
function offered(calendar: CalendarInfo): ProviderId[] {
  if (!calendar.available) return ['google'];
  return (['google', 'microsoft'] as const).filter((p) => calendar.available![p]);
}
