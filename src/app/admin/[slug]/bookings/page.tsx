'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { adminFetchJson } from '@/lib/admin-fetch';

type View = 'upcoming' | 'past' | 'cancelled';
type SyncStatus = 'pending' | 'synced' | 'failed' | 'not_configured';

interface AnsweredQuestion {
  questionId: string;
  prompt: string;
  kind: 'text' | 'yes_no' | 'single_choice';
  answer: string;
  qualifies: boolean | null;
}

interface Booking {
  id: string;
  eventTypeName: string;
  startsAt: string;
  endsAt: string;
  name: string;
  email: string;
  notes: string | null;
  status: 'confirmed' | 'cancelled';
  cancelledAt: string | null;
  cancellationReason: string | null;
  meetingUrl: string | null;
  syncStatus: SyncStatus;
  syncError: string | null;
  qualification: { outcome: 'qualified' | 'redirected'; answers: AnsweredQuestion[] } | null;
  createdAt: string;
}

const TABS: { view: View; label: string }[] = [
  { view: 'upcoming', label: 'Upcoming' },
  { view: 'past', label: 'Past' },
  { view: 'cancelled', label: 'Cancelled' },
];

const dayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

function formatRange(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  return `${dayFormat.format(start)} · ${timeFormat.format(start)} – ${timeFormat.format(end)}`;
}

function syncBadge(status: SyncStatus): { label: string; tone: 'live' | 'attention' | 'broken' } | null {
  if (status === 'failed') return { label: 'Calendar sync failed', tone: 'broken' };
  if (status === 'pending') return { label: 'Syncing…', tone: 'attention' };
  return null;
}

function toneStyle(tone: 'live' | 'attention' | 'broken') {
  if (tone === 'live') return { background: 'var(--status-live-tint)', color: 'var(--status-live-ink)' };
  if (tone === 'attention')
    return { background: 'var(--status-attention-tint)', color: 'var(--status-attention-ink)' };
  return { background: 'var(--status-broken-tint)', color: 'var(--status-broken)' };
}

export default function BookingsPage() {
  const { slug } = useParams<{ slug: string }>();
  const base = `/api/admin/${slug}/bookings`;

  const [view, setView] = useState<View>('upcoming');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  async function load(v: View) {
    setLoading(true);
    setError(null);
    try {
      const result = await adminFetchJson<{ bookings: Booking[] }>(`${base}?view=${v}`);
      setBookings(result.bookings);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(view);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- slug is stable for the life of this page
  }, [slug, view]);

  async function cancel(booking: Booking) {
    const reason = window.prompt(
      `Cancel ${booking.name}'s ${booking.eventTypeName.toLowerCase()}? You can leave a note for your own records (optional).`,
    );
    if (reason === null) return; // they hit Cancel on the prompt itself

    setCancellingId(booking.id);
    setError(null);
    try {
      await adminFetchJson(`${base}/${booking.id}/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: reason || undefined }),
      });
      await load(view);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <>
      <div className="admin-page-head">
        <div>
          <div className="admin-eyebrow">Bookings</div>
          <h1>Everyone who came through</h1>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        {TABS.map((tab) => (
          <button
            key={tab.view}
            type="button"
            className={view === tab.view ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setView(tab.view)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}

      {loading && <p className="status">Loading…</p>}

      {!loading && bookings.length === 0 && (
        <p className="notice notice-muted">
          {view === 'upcoming' && 'Nothing booked yet.'}
          {view === 'past' && 'No completed bookings yet.'}
          {view === 'cancelled' && 'Nothing cancelled — good.'}
        </p>
      )}

      <div className="admin-list">
        {bookings.map((b) => {
          const expanded = expandedId === b.id;
          const sync = syncBadge(b.syncStatus);
          return (
            <div key={b.id} className="card admin-row" style={{ alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 11, flexWrap: 'wrap' }}>
                  <h2 style={{ fontSize: '1.05rem' }}>{b.name}</h2>
                  <span style={{ fontSize: '0.8rem', color: 'var(--faint)' }}>{b.eventTypeName}</span>
                </div>

                <p style={{ margin: '4px 0 0', fontSize: '0.9rem', color: 'var(--muted)' }}>
                  {formatRange(b.startsAt, b.endsAt)}
                </p>
                <p style={{ margin: '2px 0 0', fontSize: '0.85rem', color: 'var(--faint)' }}>{b.email}</p>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                  {b.qualification?.outcome === 'redirected' && (
                    <span
                      className="notice"
                      style={{ padding: '4px 11px', margin: 0, ...toneStyle('attention') }}
                    >
                      Sent down the other path
                    </span>
                  )}
                  {sync && (
                    <span className="notice" style={{ padding: '4px 11px', margin: 0, ...toneStyle(sync.tone) }}>
                      {sync.label}
                    </span>
                  )}
                  {b.meetingUrl && (
                    <a
                      href={b.meetingUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="notice"
                      style={{ padding: '4px 11px', margin: 0, ...toneStyle('live') }}
                    >
                      Video link
                    </a>
                  )}
                  {b.status === 'cancelled' && (
                    <span className="notice" style={{ padding: '4px 11px', margin: 0, ...toneStyle('broken') }}>
                      Cancelled{b.cancellationReason ? `: ${b.cancellationReason}` : ''}
                    </span>
                  )}
                </div>

                {b.notes && (
                  <p style={{ margin: '12px 0 0', fontSize: '0.88rem', color: 'var(--muted)' }}>
                    “{b.notes}”
                  </p>
                )}

                {expanded && b.qualification && b.qualification.answers.length > 0 && (
                  <div
                    style={{
                      marginTop: 14,
                      paddingTop: 14,
                      borderTop: '1px solid var(--border)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                    }}
                  >
                    {b.qualification.answers.map((a) => (
                      <div key={a.questionId}>
                        <div style={{ fontSize: '0.82rem', color: 'var(--faint)' }}>{a.prompt}</div>
                        <div
                          style={{
                            fontSize: '0.92rem',
                            color: a.qualifies === false ? 'var(--status-attention-ink)' : 'var(--ink)',
                          }}
                        >
                          {a.answer}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {b.qualification && b.qualification.answers.length > 0 && (
                  <button
                    type="button"
                    className="btn-link"
                    style={{ marginTop: 10, padding: 0, fontSize: '0.85rem' }}
                    onClick={() => setExpandedId(expanded ? null : b.id)}
                  >
                    {expanded ? 'Hide their answers' : 'Show their answers'}
                  </button>
                )}
              </div>

              {b.status === 'confirmed' && (
                <button
                  type="button"
                  className="btn-link"
                  disabled={cancellingId === b.id}
                  onClick={() => cancel(b)}
                >
                  {cancellingId === b.id ? 'Cancelling…' : 'Cancel'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
