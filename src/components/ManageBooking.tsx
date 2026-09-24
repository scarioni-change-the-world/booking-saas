'use client';

import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { accentStyle, initials } from './brand';
import { DateNavigator } from './booking/DateNavigator';
import { groupSlots } from './booking/slots';
import type { DaySlots } from './types';
import { programmeThread, sessionName } from '@/lib/client-thread';

/** Matches the public booking flow — see ClientBooking for why. */
const SLOTS_BEFORE_MORE = 8;

interface BookingView {
  startsAt: string;
  endsAt: string;
  name: string;
  email: string;
  notes: string | null;
  status: 'confirmed' | 'cancelled';
  meetingUrl: string | null;
  eventTypeId: string;
  eventTypeName: string | null;
}

interface PackView {
  size: number;
  booked: number;
  remaining: number;
  appointments: Array<{ startsAt: string; endsAt: string; status: 'confirmed' | 'cancelled' }>;
}

interface Payload {
  booking: BookingView;
  /** Present only when this booking is one appointment of a programme. */
  pack: PackView | null;
  tenant: {
    name: string;
    timezone: string;
    branding: { logoUrl?: string; accentColor?: string; buttonColor?: string };
  };
}

/**
 * Reschedule and cancel, with no login (brief 2.4).
 *
 * The reschedule picker runs the same availability endpoint as a new booking,
 * so every rule — notice, buffers, overrides, blocks, calendar busy — applies
 * identically. A second implementation here would drift from the first.
 *
 * Shares its visual language with BookingFlow deliberately: this is the same
 * client, days or weeks later, and a booking flow that looks like one product
 * and a manage page that looks like another would read as broken trust, not
 * just inconsistent styling.
 */
export default function ManageBooking({ token }: { token: string }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'view' | 'reschedule' | 'cancel' | 'rebook'>('view');
  /** Which "Show N more" links have been opened, keyed by day and period. */
  const [expandedPeriods, setExpandedPeriods] = useState<Record<string, boolean>>({});
  const [days, setDays] = useState<DaySlots[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    const response = await fetch(`/api/manage/${encodeURIComponent(token)}`);
    if (!response.ok) {
      setError('We could not find that booking. The link may have expired.');
      return;
    }
    setPayload((await response.json()) as Payload);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/manage/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Request failed');
      setMode('view');
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function openPicker(next: 'reschedule' | 'rebook') {
    if (!payload) return;
    setMode(next);
    setBusy(true);
    setError(null);
    try {
      // Availability for a reschedule is read on the client audience: the
      // person already holds a booking, so the gate does not apply to them.
      const response = await fetch(
        `/api/manage/${encodeURIComponent(token)}/availability`,
      );
      if (response.ok) {
        const result = (await response.json()) as { days: DaySlots[] };
        setDays(result.days);
        setSelectedDate(result.days.find((d) => d.slots.length > 0)?.date ?? null);
      } else {
        setDays([]);
        setSelectedDate(null);
        setError('We could not load available times just now.');
      }
    } finally {
      setBusy(false);
    }
  }

  const dayFormat = new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const dowFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
  const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

  const formatDay = (date: string) => dayFormat.format(new Date(`${date}T12:00:00`));
  const formatInstantDay = (iso: string) => dayFormat.format(new Date(iso));
  const formatTime = (iso: string) => timeFormat.format(new Date(iso));

  /* The frame the public booking flow stands in. This screen is reached
     from a confirmation email, so for many clients it is the second thing
     they ever see of the business — arriving at a different-looking product
     is the moment a booking page stops feeling like one. */
  const shell = (children: ReactNode, accent?: CSSProperties) => (
    <div className="bk bk-standalone" style={accent}>
      <main className="bk-page">
        <div className="bk-solo">
          <div className="bk-panel">
            <div className="bk-steps">{children}</div>
          </div>
        </div>
        <p className="bk-credit">
          Powered by <span className="bk-wordmark">intro</span>
        </p>
      </main>
    </div>
  );

  if (error && !payload) {
    return shell(
      <p className="bk-error" role="alert">
        {error}
      </p>,
    );
  }

  if (!payload) {
    return shell(
      <p className="bk-status" role="status">
        Loading…
      </p>,
    );
  }

  const { booking, tenant, pack } = payload;

  // The existing booking's own span is its duration — a reschedule keeps the
  // same session length, so there is no need to fetch the event type again
  // just to compute the range shown on each slot.
  const durationMinutes = Math.round(
    (new Date(booking.endsAt).getTime() - new Date(booking.startsAt).getTime()) / 60_000,
  );
  const formatTimeRange = (iso: string) => {
    const start = new Date(iso);
    const end = new Date(start.getTime() + durationMinutes * 60_000);
    return `${timeFormat.format(start)} – ${timeFormat.format(end)}`;
  };

  const activeDay = days.find((d) => d.date === selectedDate) ?? null;

  return shell(
    <>
      <div className="bk-identity">
        <div className="bk-avatar">
          {tenant.branding.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- tenant-supplied, arbitrary remote host
            <img src={tenant.branding.logoUrl} alt="" />
          ) : (
            initials(tenant.name)
          )}
        </div>
        <p className="bk-business">{tenant.name}</p>
      </div>

      {error && (
        <p className="bk-error" role="alert">
          {error}
        </p>
      )}

      {booking.status === 'confirmed' ? (
        <div className="bk-confirmed">
          <p className="bk-confirmed-when">{formatInstantDay(booking.startsAt)}</p>
          <p className="bk-confirmed-time">{formatTimeRange(booking.startsAt)}</p>
          <p className="bk-confirmed-what">{booking.eventTypeName ?? 'Your booking'}</p>
        </div>
      ) : (
        /* Cancelled. Stated plainly on a flat surface rather than in the
           filled card a live booking gets — the card means "this is
           happening", and a cancelled booking wearing it reads as still on.
           No red: the client asked for this. */
        <div className="bk-cancelled">
          <h1 className="bk-heading">{booking.eventTypeName ?? 'Your booking'}</h1>
          <p className="bk-lede">
            {formatInstantDay(booking.startsAt)} at {formatTime(booking.startsAt)}
          </p>
          <p className="bk-cancelled-mark">Cancelled</p>
        </div>
      )}

      {booking.meetingUrl && booking.status === 'confirmed' && (
        <a className="bk-join" href={booking.meetingUrl}>
          Join the video call
        </a>
      )}

      {/* A programme, as a thread: every session in order — done, next, and
          booked — and each one still owed drawn as a gap in its place, with
          the way to book it on that spot. It used to be a list of dates with
          a count underneath, which told somebody halfway through what they
          held but not where they were. */}
      {pack && mode === 'view' && (
        <div className="bk-programme">
          <h2 className="bk-programme-title">Your programme</h2>
          <p className="bk-programme-count">
            {pack.size} sessions
            {pack.remaining > 0 ? ` · ${pack.remaining} still to book` : ''}
          </p>

          <ol className="bk-thread">
            {(() => {
              const steps = programmeThread(pack.appointments, pack.remaining, new Date().toISOString());
              const firstOwed = steps.findIndex((st) => st.tone === 'owed');
              return steps.map((st, i) => {
                const isThis = st.startsAt === booking.startsAt && booking.status === 'confirmed';
                return (
                  <li key={`${st.position}-${st.tone}`} className={`is-${st.tone}${isThis ? ' is-this' : ''}`}>
                    {st.tone === 'owed' ? (
                      <>
                        <b>{sessionName(st.position)}</b>
                        <span>
                          {st.cancelledStartsAt
                            ? `Cancelled from ${formatInstantDay(st.cancelledStartsAt)} — still yours to book`
                            : 'Still yours to book'}
                        </span>
                        {i === firstOwed && (
                          <button type="button" className="bk-thread-act" onClick={() => void openPicker('rebook')}>
                            Book it →
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <b>
                          {formatInstantDay(st.startsAt!)}, {formatTime(st.startsAt!)}
                        </b>
                        <span>
                          {st.tone === 'done' ? 'Done' : st.tone === 'next' ? 'Next' : 'Booked'}
                          {isThis ? ' · this one' : ''}
                        </span>
                      </>
                    )}
                  </li>
                );
              });
            })()}
          </ol>
        </div>
      )}

      {booking.status === 'confirmed' && mode === 'view' && (
        <div className="bk-manage-actions">
          <button
            type="button"
            className="btn-secondary btn-full"
            onClick={() => void openPicker('reschedule')}
          >
            Reschedule
          </button>
          <button type="button" className="bk-textlink" onClick={() => setMode('cancel')}>
            Cancel this booking
          </button>
        </div>
      )}

      {(mode === 'reschedule' || mode === 'rebook') && (
        <section>
          <h1 className="bk-heading">
            {mode === 'rebook' ? 'Book your replacement appointment' : 'Pick a new time'}
          </h1>

          {busy && (
            <p className="bk-status" role="status">
              Finding available times…
            </p>
          )}
          {!busy && days.length === 0 && (
            <p className="bk-empty">No other times are available right now.</p>
          )}

          {days.length > 0 && (
            <>
              <DateNavigator
                days={days}
                selectedDate={selectedDate}
                onSelect={setSelectedDate}
                dowFormat={dowFormat}
              />

              {activeDay && (
                <div className="bk-times">
                  <h2 className="bk-day">{formatDay(activeDay.date)}</h2>

                  {groupSlots(activeDay.slots).map((group) => {
                    const key = `${activeDay.date}:${group.period}`;
                    const expanded = expandedPeriods[key] ?? false;
                    const shown = expanded
                      ? group.slots
                      : group.slots.slice(0, SLOTS_BEFORE_MORE);
                    const hidden = group.slots.length - shown.length;

                    return (
                      <div className="bk-period" key={group.period}>
                        <h3 className="bk-period-label">{group.label}</h3>
                        <div className="bk-slots">
                          {shown.map((iso) => (
                            <button
                              key={iso}
                              type="button"
                              className="bk-slot"
                              disabled={busy}
                              onClick={() =>
                                act({
                                  action: mode === 'rebook' ? 'book-replacement' : 'reschedule',
                                  startsAt: iso,
                                })
                              }
                            >
                              {formatTimeRange(iso)}
                            </button>
                          ))}
                        </div>
                        {hidden > 0 && (
                          <button
                            type="button"
                            className="bk-textlink bk-more"
                            onClick={() =>
                              setExpandedPeriods((prev) => ({ ...prev, [key]: true }))
                            }
                          >
                            Show {hidden} more
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          <p className="bk-after">
            <button type="button" className="bk-textlink" onClick={() => setMode('view')}>
              {mode === 'rebook' ? 'Not now' : 'Keep my current time'}
            </button>
          </p>
        </section>
      )}

      {mode === 'cancel' && (
        <form
          className="bk-form"
          onSubmit={(event) => {
            event.preventDefault();
            void act({ action: 'cancel', reason });
          }}
        >
          <h1 className="bk-heading">Cancel this booking</h1>
          <div className="field">
            <label htmlFor="reason">Let us know why (optional)</label>
            <textarea
              id="reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <button type="submit" className="btn-primary btn-full" disabled={busy}>
            {busy ? 'Cancelling…' : 'Cancel booking'}
          </button>
          <p className="bk-after">
            <button type="button" className="bk-textlink" onClick={() => setMode('view')}>
              Keep it
            </button>
          </p>
        </form>
      )}
    </>,
    accentStyle(tenant.branding.accentColor),
  );
}
