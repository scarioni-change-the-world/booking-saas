'use client';

import { useCallback, useEffect, useState } from 'react';
import { accentStyle, initials } from './brand';
import type { DaySlots } from './types';

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
  appointments: Array<{ startsAt: string; status: 'confirmed' | 'cancelled' }>;
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

  if (error && !payload) {
    return (
      <main className="widget">
        <div className="notice notice-error">{error}</div>
      </main>
    );
  }

  if (!payload) {
    return (
      <main className="widget">
        <p className="status">Loading…</p>
      </main>
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

  return (
    <main className="widget" style={accentStyle(tenant.branding.accentColor)}>
      <div className="brand-row">
        <div className="brand-mark">
          {tenant.branding.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- tenant-supplied, arbitrary remote host
            <img src={tenant.branding.logoUrl} alt="" />
          ) : (
            initials(tenant.name)
          )}
        </div>
        <span className="brand-name">{tenant.name}</span>
      </div>

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}

      {booking.status === 'confirmed' ? (
        <div className="hero">
          <div className="eyebrow">{formatInstantDay(booking.startsAt)}</div>
          <div className="when">{formatTime(booking.startsAt)}</div>
          <div className="what">{booking.eventTypeName ?? 'Your booking'}</div>
        </div>
      ) : (
        <div className="card">
          <h2>{booking.eventTypeName ?? 'Your booking'}</h2>
          <p style={{ margin: '6px 0 0', color: 'var(--muted)' }}>
            {formatInstantDay(booking.startsAt)} at {formatTime(booking.startsAt)}
          </p>
          <p className="status" style={{ margin: '10px 0 0' }}>
            Cancelled
          </p>
        </div>
      )}

      {booking.meetingUrl && booking.status === 'confirmed' && (
        <a className="hero-link" href={booking.meetingUrl} style={{ marginBottom: 14 }}>
          Join the video call
        </a>
      )}

      {/* A programme: where it stands, and — if a cancellation left it short
          — the way to put that right. Without this, cancelling one
          appointment of a three-session programme simply lost it: the client
          had paid for three, held two, and had nowhere to go. */}
      {pack && mode === 'view' && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h2 style={{ marginTop: 0 }}>Your programme</h2>
          <p style={{ margin: '6px 0 0', color: 'var(--muted)' }}>
            {pack.booked} of {pack.size} appointments booked.
          </p>

          <ol className="pack-standing">
            {pack.appointments.map((appointment) => (
              <li
                key={`${appointment.startsAt}-${appointment.status}`}
                data-cancelled={appointment.status === 'cancelled' ? 'true' : undefined}
              >
                <span>
                  {formatInstantDay(appointment.startsAt)} at{' '}
                  {formatTime(appointment.startsAt)}
                </span>
                {appointment.status === 'cancelled' && <em>Cancelled</em>}
              </li>
            ))}
          </ol>

          {pack.remaining > 0 && (
            <>
              <p style={{ margin: '14px 0 0' }}>
                {pack.remaining === 1
                  ? 'You have one appointment still to book.'
                  : `You have ${pack.remaining} appointments still to book.`}
              </p>
              <button
                type="button"
                className="btn-primary btn-full"
                style={{ marginTop: 12 }}
                onClick={() => void openPicker('rebook')}
              >
                {pack.remaining === 1 ? 'Book it now' : 'Book the next one'}
              </button>
            </>
          )}
        </div>
      )}

      {booking.status === 'confirmed' && mode === 'view' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button type="button" className="btn-secondary btn-full" onClick={() => void openPicker('reschedule')}>
            Reschedule
          </button>
          <button
            type="button"
            className="btn-link"
            style={{ alignSelf: 'center' }}
            onClick={() => setMode('cancel')}
          >
            Cancel this booking
          </button>
        </div>
      )}

      {(mode === 'reschedule' || mode === 'rebook') && (
        <>
          <h2 style={{ marginTop: 24 }}>
            {mode === 'rebook' ? 'Book your replacement appointment' : 'Pick a new time'}
          </h2>
          {busy && <p className="status">Loading times…</p>}
          {!busy && days.length === 0 && (
            <p className="notice notice-muted">No other times are available right now.</p>
          )}

          {days.length > 0 && (
            <>
              <div className="date-strip">
                {days.map((day) => {
                  const date = new Date(`${day.date}T12:00:00`);
                  const has = day.slots.length > 0;
                  const active = day.date === selectedDate;
                  return (
                    <button
                      key={day.date}
                      type="button"
                      className={`date-chip${active ? ' active' : ''}${has ? '' : ' empty'}`}
                      disabled={!has || busy}
                      onClick={() => setSelectedDate(day.date)}
                    >
                      <span className="dow">{dowFormat.format(date)}</span>
                      <span className="num">{date.getDate()}</span>
                    </button>
                  );
                })}
              </div>

              {activeDay && (
                <>
                  <p className="day-label">{formatDay(activeDay.date)}</p>
                  <div className="slots">
                    {activeDay.slots.map((iso) => (
                      <button
                        key={iso}
                        type="button"
                        className="slot"
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
                </>
              )}
            </>
          )}

          <div className="actions" style={{ justifyContent: 'center' }}>
            <button type="button" className="btn-link" onClick={() => setMode('view')}>
              {mode === 'rebook' ? 'Not now' : 'Keep my current time'}
            </button>
          </div>
        </>
      )}

      {mode === 'cancel' && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void act({ action: 'cancel', reason });
          }}
        >
          <h2 style={{ marginTop: 24 }}>Cancel this booking</h2>
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
          <div className="actions" style={{ justifyContent: 'center' }}>
            <button type="button" className="btn-link" onClick={() => setMode('view')}>
              Keep it
            </button>
          </div>
        </form>
      )}

      <p className="footer-credit">Powered by intro</p>
    </main>
  );
}
