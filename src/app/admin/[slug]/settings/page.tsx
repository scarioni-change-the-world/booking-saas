'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { adminFetchJson } from '@/lib/admin-fetch';

interface Settings {
  bookingNoticeHours: number;
  bookingWindowDays: number;
  disqualificationMessage: string;
  disqualificationRedirectUrl: string | null;
  disqualificationRedirectLabel: string | null;
  notificationEmail: string | null;
  replyToEmail: string | null;
  updatedAt: string;
}

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
  if (tone === 'attention')
    return { background: 'var(--status-attention-tint)', color: 'var(--status-attention-ink)' };
  return { background: 'var(--accent-tint)', color: 'var(--faint)' };
}

export default function SettingsPage() {
  const { slug } = useParams<{ slug: string }>();
  const settingsUrl = `/api/admin/${slug}/settings`;
  const calendarUrl = `/api/admin/${slug}/calendar`;

  const [settings, setSettings] = useState<Settings | null>(null);
  const [rulesForm, setRulesForm] = useState({ bookingNoticeHours: 24, bookingWindowDays: 60 });
  const [notifyForm, setNotifyForm] = useState({ notificationEmail: '', replyToEmail: '' });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingRules, setSavingRules] = useState(false);
  const [savingNotify, setSavingNotify] = useState(false);
  const [rulesSaved, setRulesSaved] = useState(false);
  const [notifySaved, setNotifySaved] = useState(false);

  const [calendar, setCalendar] = useState<CalendarInfo | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(true);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [calendarBusy, setCalendarBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await adminFetchJson<{ settings: Settings | null }>(settingsUrl);
      if (result.settings) {
        setSettings(result.settings);
        setRulesForm({
          bookingNoticeHours: result.settings.bookingNoticeHours,
          bookingWindowDays: result.settings.bookingWindowDays,
        });
        setNotifyForm({
          notificationEmail: result.settings.notificationEmail ?? '',
          replyToEmail: result.settings.replyToEmail ?? '',
        });
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function loadCalendar() {
    setCalendarLoading(true);
    setCalendarError(null);
    try {
      const result = await adminFetchJson<CalendarInfo>(calendarUrl);
      setCalendar(result);
    } catch (cause) {
      setCalendarError((cause as Error).message);
    } finally {
      setCalendarLoading(false);
    }
  }

  useEffect(() => {
    void load();
    void loadCalendar();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- slug is stable for the life of this page
  }, [slug]);

  async function submitRules(event: React.FormEvent) {
    event.preventDefault();
    setSavingRules(true);
    setError(null);
    setRulesSaved(false);
    try {
      const result = await adminFetchJson<{ settings: Settings }>(settingsUrl, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(rulesForm),
      });
      setSettings(result.settings);
      setRulesSaved(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSavingRules(false);
    }
  }

  async function submitNotify(event: React.FormEvent) {
    event.preventDefault();
    setSavingNotify(true);
    setError(null);
    setNotifySaved(false);
    try {
      const result = await adminFetchJson<{ settings: Settings }>(settingsUrl, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          notificationEmail: notifyForm.notificationEmail || null,
          replyToEmail: notifyForm.replyToEmail || null,
        }),
      });
      setSettings(result.settings);
      setNotifySaved(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSavingNotify(false);
    }
  }

  async function connectGoogle() {
    setCalendarBusy(true);
    setCalendarError(null);
    try {
      const result = await adminFetchJson<{ url: string }>(calendarUrl, { method: 'POST' });
      window.location.href = result.url;
    } catch (cause) {
      setCalendarError((cause as Error).message);
      setCalendarBusy(false);
    }
  }

  async function disconnectGoogle() {
    if (!window.confirm('Disconnect Google Calendar? Booked times will stop syncing.')) return;
    setCalendarBusy(true);
    setCalendarError(null);
    try {
      await adminFetchJson(calendarUrl, { method: 'DELETE' });
      await loadCalendar();
    } catch (cause) {
      setCalendarError((cause as Error).message);
    } finally {
      setCalendarBusy(false);
    }
  }

  return (
    <>
      <div className="admin-page-head">
        <div>
          <div className="admin-eyebrow">Settings</div>
          <h1>How booking works</h1>
        </div>
      </div>

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}

      {loading && <p className="status">Loading…</p>}

      {!loading && settings && (
        <>
          <form className="card" onSubmit={submitRules} style={{ marginBottom: 14 }}>
            <div className="admin-card-title">Booking rules</div>
            <p style={{ fontSize: '0.9rem', color: 'var(--muted)', margin: '-4px 0 16px' }}>
              How much warning you need, and how far into the future people can book.
            </p>

            <div className="admin-field-row">
              <div className="field">
                <label htmlFor="notice-hours">Minimum notice (hours)</label>
                <input
                  id="notice-hours"
                  type="number"
                  min={0}
                  max={8760}
                  required
                  value={rulesForm.bookingNoticeHours}
                  onChange={(e) =>
                    setRulesForm({ ...rulesForm, bookingNoticeHours: Number(e.target.value) })
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="window-days">How far ahead people can book (days)</label>
                <input
                  id="window-days"
                  type="number"
                  min={0}
                  max={3650}
                  required
                  value={rulesForm.bookingWindowDays}
                  onChange={(e) =>
                    setRulesForm({ ...rulesForm, bookingWindowDays: Number(e.target.value) })
                  }
                />
              </div>
            </div>

            <div className="actions">
              <button type="submit" className="btn-primary" disabled={savingRules}>
                {savingRules ? 'Saving…' : 'Save'}
              </button>
              {rulesSaved && !savingRules && (
                <span style={{ fontSize: '0.85rem', color: 'var(--status-live-ink)' }}>Saved</span>
              )}
            </div>
          </form>

          <form className="card" onSubmit={submitNotify} style={{ marginBottom: 14 }}>
            <div className="admin-card-title">Notifications</div>
            <p style={{ fontSize: '0.9rem', color: 'var(--muted)', margin: '-4px 0 16px' }}>
              Where new-booking alerts go, and what address replies land on. Leave blank to skip.
            </p>

            <div className="admin-field-row">
              <div className="field">
                <label htmlFor="notify-email">Notify this address</label>
                <input
                  id="notify-email"
                  type="email"
                  value={notifyForm.notificationEmail}
                  onChange={(e) => setNotifyForm({ ...notifyForm, notificationEmail: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="reply-email">Reply-to on emails to clients</label>
                <input
                  id="reply-email"
                  type="email"
                  value={notifyForm.replyToEmail}
                  onChange={(e) => setNotifyForm({ ...notifyForm, replyToEmail: e.target.value })}
                />
              </div>
            </div>

            <div className="actions">
              <button type="submit" className="btn-primary" disabled={savingNotify}>
                {savingNotify ? 'Saving…' : 'Save'}
              </button>
              {notifySaved && !savingNotify && (
                <span style={{ fontSize: '0.85rem', color: 'var(--status-live-ink)' }}>Saved</span>
              )}
            </div>
          </form>
        </>
      )}

      <div className="card">
        <div className="admin-card-title">Google Calendar</div>
        <p style={{ fontSize: '0.9rem', color: 'var(--muted)', margin: '-4px 0 16px' }}>
          Busy times block your calendar from showing as open, and bookings get added with a video
          link automatically.
        </p>

        {calendarError && (
          <div className="notice notice-error" role="alert">
            {calendarError}
          </div>
        )}

        {calendarLoading && <p className="status">Checking…</p>}

        {!calendarLoading && calendar && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <span
                className="notice"
                style={{ padding: '4px 11px', margin: 0, ...toneStyle(STATUS_COPY[calendar.status].tone) }}
              >
                {STATUS_COPY[calendar.status].label}
              </span>
              {calendar.accountEmail && (
                <span style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>{calendar.accountEmail}</span>
              )}
            </div>

            {calendar.health?.error && (
              <p className="notice notice-error" style={{ marginBottom: 16 }}>
                {calendar.health.error}
              </p>
            )}

            <div className="actions">
              {calendar.status === 'not_connected' || calendar.status === 'revoked' ? (
                <button type="button" className="btn-primary" disabled={calendarBusy} onClick={connectGoogle}>
                  {calendarBusy ? 'Connecting…' : 'Connect Google Calendar'}
                </button>
              ) : calendar.status === 'needs_reconnect' ? (
                <>
                  <button type="button" className="btn-primary" disabled={calendarBusy} onClick={connectGoogle}>
                    {calendarBusy ? 'Reconnecting…' : 'Reconnect'}
                  </button>
                  <button type="button" className="btn-link" disabled={calendarBusy} onClick={disconnectGoogle}>
                    Disconnect
                  </button>
                </>
              ) : (
                <button type="button" className="btn-secondary" disabled={calendarBusy} onClick={disconnectGoogle}>
                  {calendarBusy ? 'Disconnecting…' : 'Disconnect'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
