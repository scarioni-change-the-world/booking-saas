'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { adminFetchJson } from '@/lib/admin-fetch';
import { embedSnippet } from '@/lib/embed';

interface Settings {
  bookingNoticeHours: number;
  bookingWindowDays: number;
  notificationEmail: string | null;
  replyToEmail: string | null;
  currency: string;
  updatedAt: string;
}

/**
 * The currencies offered in the picker.
 *
 * A short list rather than all 180 of ISO 4217: this product's customers are
 * coaches, therapists and consultants, and a dropdown they have to scroll
 * for a minute to find "EUR" in is worse than one that occasionally lacks
 * the right code. The column accepts any three letters, so a currency that
 * is missing here is a one-line addition, not a migration.
 */
const CURRENCIES = ['EUR', 'GBP', 'USD', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CAD', 'AUD', 'NZD', 'JPY', 'BRL', 'MXN'];

/** The reader's own name for a currency — "euro" in Madrid, "Euro" in
 * Berlin — rather than a hard-coded English table. */
function currencyName(code: string): string {
  try {
    return (
      new Intl.DisplayNames(undefined, { type: 'currency' }).of(code) ?? code
    );
  } catch {
    return code;
  }
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
  const [rulesForm, setRulesForm] = useState({
    bookingNoticeHours: 24,
    bookingWindowDays: 60,
    currency: 'EUR',
  });
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
          currency: result.settings.currency,
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
      <PageHeader
        eyebrow="Settings"
        title="How booking works"
        description="Notice period, how far ahead people can book, the emails they receive and your calendar connection."
      />

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}

      {loading && <p className="status">Loading…</p>}

      {!loading && settings && (
        <>
          <EmbedCard slug={slug} />

          <form className="card" onSubmit={submitRules} style={{ marginBottom: 14 }}>
            <div className="admin-card-title">Booking rules</div>
            <p style={{ fontSize: '0.9rem', color: 'var(--muted)', margin: '-4px 0 16px' }}>
              How much warning you need, how far ahead people can book, and what you
              charge in.
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

            <div className="field" style={{ maxWidth: 260 }}>
              <label htmlFor="currency">Currency</label>
              <select
                id="currency"
                value={rulesForm.currency}
                onChange={(e) => setRulesForm({ ...rulesForm, currency: e.target.value })}
              >
                {CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {code} — {currencyName(code)}
                  </option>
                ))}
              </select>
              <p className="field-note">
                Every price you set on a service is shown in this. Changing it
                re-labels existing prices rather than converting them, so check
                your services after.
              </p>
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

      {/* The wording of every email moved to Messages, where each one sits
          at the moment it is sent. Pointed to rather than repeated here: one
          place to change a message. */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="admin-card-title">What your emails say</div>
        <p style={{ fontSize: '0.9rem', color: 'var(--muted)', margin: '-4px 0 0' }}>
          The wording of every email, and whether each one arrived, is on{' '}
          <a href={`/admin/${slug}/messages`}>Messages</a>.
        </p>
      </div>

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

/**
 * Put the booking page inside your own website.
 *
 * This is the setting whose absence made the whole embed mechanism
 * unreachable. The column, the per-tenant frame-ancestors policy and the
 * deliberate exemption from the dashboard's X-Frame-Options have all existed
 * since early on — with no way for anyone to add a domain, so every tenant's
 * policy resolved to 'none' and nobody could embed anything. The machinery
 * was finished and the door had no handle.
 *
 * The list is edited as text rather than as rows of inputs because that is
 * how people have their domains: in their head, or pasted from an address
 * bar. One per line, normalised on save.
 */
function EmbedCard({ slug }: { slug: string }) {
  const url = `/api/admin/${slug}/embed`;

  const [text, setText] = useState('');
  const [domains, setDomains] = useState<string[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const load = useCallback(async () => {
    try {
      const result = await adminFetchJson<{ domains: string[] }>(url);
      setDomains(result.domains);
      setText(result.domains.join('\n'));
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, [url]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await adminFetchJson<{ domains: string[]; rejected: string[] }>(url, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domains: text.split('\n') }),
      });
      setDomains(result.domains);
      setText(result.domains.join('\n'));
      setRejected(result.rejected);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const snippet = origin ? embedSnippet(origin, slug) : '';

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* Selectable text either way. */
    }
  }

  return (
    <section className="card" style={{ marginBottom: 14 }}>
      <div className="admin-card-title">On your own website</div>
      <p style={{ fontSize: '0.9rem', color: 'var(--muted)', margin: '-4px 0 16px', maxWidth: '62ch' }}>
        Your booking page can sit inside a page on your own site, so nobody has to leave it to book.
        List the sites allowed to do that — one per line.
      </p>

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}

      <form onSubmit={save}>
        <div className="field">
          <label htmlFor="embed-domains">Sites allowed to show your booking page</label>
          <p className="field-description">
            Just the address, like <code>www.yourstudio.com</code>. Paste a full link and we&apos;ll
            trim it. <code>*.yourstudio.com</code> covers every subdomain.
          </p>
          <textarea
            id="embed-domains"
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="www.yourstudio.com"
          />
        </div>

        {rejected.length > 0 && (
          /* Named rather than silently dropped: a domain that quietly failed
             to save looks exactly like one that saved and does not work. */
          <div className="notice notice-error" role="alert">
            Couldn&apos;t use {rejected.map((r) => `"${r}"`).join(', ')} — that doesn&apos;t look
            like a web address. Everything else was saved.
          </div>
        )}

        <div className="actions">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save sites'}
          </button>
        </div>
      </form>

      {domains.length === 0 ? (
        <p className="notice notice-muted" style={{ marginTop: 16 }}>
          No sites listed yet, so your booking page can&apos;t be shown inside another site. It
          still works on its own at <code>{origin}/t/{slug}</code>.
        </p>
      ) : (
        <div style={{ marginTop: 20 }}>
          <div className="admin-card-title" style={{ marginBottom: 6 }}>
            Paste this into your page
          </div>
          <p style={{ fontSize: '0.85rem', color: 'var(--faint)', margin: '0 0 10px', maxWidth: '62ch' }}>
            Wherever you want the booking page to appear. The second line lets it grow and shrink to
            fit, so it never scrolls inside itself.
          </p>
          <pre className="embed-snippet">{snippet}</pre>
          <div className="actions">
            <button type="button" className="btn-secondary" onClick={copySnippet}>
              {copied ? 'Copied' : 'Copy snippet'}
            </button>
          </div>
          <span aria-live="polite" className="sr-only">
            {copied ? 'Embed snippet copied to clipboard' : ''}
          </span>
        </div>
      )}
    </section>
  );
}
