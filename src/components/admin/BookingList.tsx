'use client';

import { useEffect, useState } from 'react';
import { InitialsMark } from '@/components/ui';
import { adminFetchJson } from '@/lib/admin-fetch';
import { ReconsideredMark } from '@/components/admin/ReconsideredMark';
import { ServiceBadge } from '@/components/admin/ServiceBadge';
import {
  emailBadge,
  formatRange,
  syncBadge,
  toneStyle,
  useBookingActions,
  type Booking,
} from '@/components/admin/bookings-shared';

/**
 * Every booking as a list: upcoming, past, or cancelled.
 *
 * The plain version of the Week. Some things are better as a list — all
 * the cancellations, everything that happened last month — and a list is
 * what a screen reader can use when a grid of positioned blocks is not.
 */

type View = 'upcoming' | 'past' | 'cancelled';

const TABS: { view: View; label: string }[] = [
  { view: 'upcoming', label: 'Upcoming' },
  { view: 'past', label: 'Past' },
  { view: 'cancelled', label: 'Cancelled' },
];

export function BookingList({ slug }: { slug: string }) {
  const base = `/api/admin/${slug}/bookings`;

  const [view, setView] = useState<View>('upcoming');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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

  const actions = useBookingActions(slug, () => load(view));

  /* The browser's own prompt and confirm, as before. The Week asks the same
     questions inline in its panel; both end up in useBookingActions. */
  function cancel(booking: Booking) {
    const reason = window.prompt(
      `Cancel ${booking.name}'s ${booking.eventTypeName.toLowerCase()}? You can leave a note for your own records (optional).`,
    );
    if (reason === null) return;
    void actions.cancel(booking, reason);
  }

  function addAsClient(booking: Booking) {
    if (
      !window.confirm(
        `Give ${booking.name} their own link and email it to them?\n\n` +
          `Everyone who books gets one; this booking was made before that, or the link could not be made at the time. ` +
          `With it they book without answering your questions.`,
      )
    ) {
      return;
    }
    void actions.addAsClient(booking);
  }

  return (
    <>
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

      {(error || actions.error) && (
        <div className="notice notice-error" role="alert">
          {error ?? actions.error}
        </div>
      )}

      {actions.notice && (
        <div className="notice notice-muted" role="status">
          {actions.notice}
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
                  <span className="data-row-meta svc-line">
                    <ServiceBadge name={b.eventTypeName} size="sm" />
                    {b.eventTypeName}
                  </span>
                  {/* This appointment is part of a programme. Said on the row
                      rather than by grouping the rows: a business scans this
                      list by date, and pulling a programme's appointments
                      together would take two of them out of the order they
                      are looked for in. */}
                  {b.pack && (
                    <span className="programme-mark">
                      Programme · {b.pack.booked} of {b.pack.size}
                      {b.pack.remaining > 0 && (
                        /* The actionable half. A client owed an appointment
                           is somebody to chase, and before this only they
                           could see it. */
                        <strong> · {b.pack.remaining} still to book</strong>
                      )}
                    </span>
                  )}
                  {/* Bought while they already owed sessions.
                   *
                   * Said, never blocked, on the business's own instruction.
                   * There is no payment in this product, so a second
                   * programme is either a real second purchase or somebody
                   * who could not find their own link — and refusing the
                   * booking would turn away the first to protect against
                   * the second. The business can tell which; the software
                   * cannot. */}
                  {b.pack?.priorSessionsOwed ? (
                    <span className="owed-mark">
                      {b.pack.priorSessionsOwed === 1
                        ? 'Booked while 1 session was still owed'
                        : `Booked while ${b.pack.priorSessionsOwed} sessions were still owed`}
                    </span>
                  ) : null}
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

                {/* Above the note and outside the expander: a booking made
                    by somebody who had been turned away an hour earlier is
                    the thing on this row worth seeing without clicking. */}
                {b.reconsidered && <ReconsideredMark reconsidered={b.reconsidered} />}

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

              <div className="bl-actions">
                {b.isClient ? (
                  <span style={{ fontSize: '0.8rem', color: 'var(--faint)' }}>Has their own link</span>
                ) : (
                  <button
                    type="button"
                    className="btn-link"
                    disabled={actions.busyId === b.id}
                    onClick={() => addAsClient(b)}
                  >
                    {actions.busyId === b.id ? 'Working…' : 'Give them their own link'}
                  </button>
                )}
                {b.status === 'confirmed' && (
                  <button
                    type="button"
                    className="btn-link"
                    disabled={actions.busyId === b.id}
                    onClick={() => cancel(b)}
                  >
                    {actions.busyId === b.id ? 'Working…' : 'Cancel'}
                  </button>
                )}
                {b.emailStatus === 'failed' && (
                  <button
                    type="button"
                    className="btn-link"
                    disabled={actions.busyId === b.id}
                    onClick={() => void actions.retryEmail(b)}
                  >
                    {actions.busyId === b.id ? 'Working…' : 'Retry email'}
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
