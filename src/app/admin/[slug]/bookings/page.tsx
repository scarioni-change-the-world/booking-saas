'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { InitialsMark, PageHeader } from '@/components/ui';
import { adminFetchJson } from '@/lib/admin-fetch';

type View = 'upcoming' | 'past' | 'cancelled';
type SyncStatus = 'pending' | 'synced' | 'failed' | 'not_configured';
type EmailStatus = 'pending' | 'sent' | 'failed' | 'not_configured';

interface AnsweredQuestion {
  questionId: string;
  prompt: string;
  kind: 'text' | 'yes_no' | 'single_choice';
  answer: string;
  outcomePathType: 'meeting' | 'other' | null;
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
  emailStatus: EmailStatus;
  emailError: string | null;
  qualification: { outcomePathType: 'meeting' | 'other'; answers: AnsweredQuestion[] } | null;
  createdAt: string;
  /** Whether this person already has a client record, matched on their
   * email — see the bookings route for why not on client_id. */
  isClient: boolean;
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

/** Same shape as syncBadge — both are "a side effect that must never block
 * the booking, with its outcome shown rather than hidden" (see
 * src/lib/booking-email.ts). 'not_configured' gets a badge too, quiet
 * rather than absent: with no badge at all it looks identical to a real
 * send, which is exactly the ambiguity worth avoiding while SMTP isn't
 * set up yet. */
function emailBadge(
  status: EmailStatus,
): { label: string; tone: 'live' | 'attention' | 'broken' | 'muted' } | null {
  if (status === 'failed') return { label: 'Email failed', tone: 'broken' };
  if (status === 'pending') return { label: 'Sending email…', tone: 'attention' };
  if (status === 'not_configured') return { label: 'Email not sent — SMTP not configured', tone: 'muted' };
  return null;
}

function toneStyle(tone: 'live' | 'attention' | 'broken' | 'muted') {
  if (tone === 'live') return { background: 'var(--status-live-tint)', color: 'var(--status-live-ink)' };
  if (tone === 'attention')
    return { background: 'var(--status-attention-tint)', color: 'var(--status-attention-ink)' };
  if (tone === 'muted') return { background: 'var(--accent-tint)', color: 'var(--faint)' };
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
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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

  async function retryEmail(booking: Booking) {
    setRetryingId(booking.id);
    setError(null);
    try {
      await adminFetchJson(`${base}/${booking.id}/retry-email`, { method: 'POST' });
      await load(view);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setRetryingId(null);
    }
  }

  /**
   * Promote someone who booked into a client with their own private link —
   * the bridge that was missing between "passed the questions once" and
   * "we know each other now, skip them".
   *
   * Deliberately a decision rather than something that happens by itself on
   * every booking: the gate exists because a tenant chooses whose time is
   * worth taking, and someone who booked one discovery call has not yet
   * earned a permanent pass through it. This just removes the retyping.
   *
   * Goes through the ordinary POST /clients, prefilled — not a second way
   * of creating a client.
   */
  async function addAsClient(booking: Booking) {
    if (
      !window.confirm(
        `Add ${booking.name} as a client and email them their own booking link?\n\n` +
          `From then on they book without answering your questions.`,
      )
    ) {
      return;
    }

    setPromotingId(booking.id);
    setError(null);
    setNotice(null);
    try {
      const result = await adminFetchJson<{ inviteStatus: 'sent' | 'failed' | 'not_configured' | null }>(
        `/api/admin/${slug}/clients`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: booking.name, email: booking.email, sendInvite: true }),
        },
      );

      setNotice(
        result.inviteStatus === 'sent'
          ? `${booking.name} is now a client — their booking link is on its way to them.`
          : `${booking.name} is now a client, but the email didn't go out${
              result.inviteStatus === 'not_configured' ? ' (email isn’t set up yet)' : ''
            }. Send them their link from the Clients page.`,
      );
      await load(view);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setPromotingId(null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Bookings"
        title="Everyone who booked"
        description="Appointments, what each person answered first, and whether their confirmation and calendar event went out."
      />

      {/* Filters, not actions. These were a filled primary button beside two
          secondaries, which put the loudest control on the page on "which
          list am I looking at" — and made three views look like one
          recommended choice and two alternatives. Pills are what the brief
          reserves for exactly this. */}
      <div className="filter-chip-row" role="group" aria-label="Which bookings to show">
        {TABS.map((tab) => (
          <button
            key={tab.view}
            type="button"
            className={`filter-chip${view === tab.view ? ' active' : ''}`}
            aria-pressed={view === tab.view}
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

      {notice && (
        <div className="notice notice-muted" role="status">
          {notice}
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
          const email = emailBadge(b.emailStatus);
          return (
            <div key={b.id} className="card admin-row" style={{ alignItems: 'flex-start' }}>
              <InitialsMark name={b.name} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 11, flexWrap: 'wrap' }}>
                  <span className="data-row-title">{b.name}</span>
                  <span className="data-row-meta">{b.eventTypeName}</span>
                </div>

                <p style={{ margin: '4px 0 0', fontSize: '0.9rem', color: 'var(--muted)' }}>
                  {formatRange(b.startsAt, b.endsAt)}
                </p>
                <p style={{ margin: '2px 0 0', fontSize: '0.85rem', color: 'var(--faint)' }}>{b.email}</p>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                  {b.qualification?.outcomePathType === 'other' && (
                    <span
                      className="notice"
                      style={{ padding: '4px 11px', margin: 0, ...toneStyle('attention') }}
                    >
                      Led to another next step
                    </span>
                  )}
                  {sync && (
                    <span className="notice" style={{ padding: '4px 11px', margin: 0, ...toneStyle(sync.tone) }}>
                      {sync.label}
                    </span>
                  )}
                  {email && (
                    <span
                      className="notice"
                      style={{ padding: '4px 11px', margin: 0, ...toneStyle(email.tone) }}
                      title={b.emailError ?? undefined}
                    >
                      {email.label}
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
                      /* An answer that led somewhere other than the calendar
                         used to render in the warning colour, which marked
                         the person's own words as a fault. It is noted
                         underneath instead, as a fact about where it led. */
                      <div key={a.questionId} className="answer-pair">
                        <p className="answer-pair-question">{a.prompt}</p>
                        <p className="answer-pair-answer">{a.answer}</p>
                        {a.outcomePathType === 'other' && (
                          <p className="answer-pair-path">Led to another next step</p>
                        )}
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

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
                {b.isClient ? (
                  <span style={{ fontSize: '0.8rem', color: 'var(--faint)' }}>Client</span>
                ) : (
                  <button
                    type="button"
                    className="btn-link"
                    disabled={promotingId === b.id}
                    onClick={() => addAsClient(b)}
                  >
                    {promotingId === b.id ? 'Adding…' : 'Add as client'}
                  </button>
                )}
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
                {b.emailStatus === 'failed' && (
                  <button
                    type="button"
                    className="btn-link"
                    disabled={retryingId === b.id}
                    onClick={() => retryEmail(b)}
                  >
                    {retryingId === b.id ? 'Retrying…' : 'Retry email'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
