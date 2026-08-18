'use client';

import { useCallback, useEffect, useState } from 'react';
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

interface Payload {
  booking: BookingView;
  tenant: { name: string; timezone: string };
}

/**
 * Reschedule and cancel, with no login (brief 2.4).
 *
 * The reschedule picker runs the same availability endpoint as a new booking,
 * so every rule — notice, buffers, overrides, blocks, calendar busy — applies
 * identically. A second implementation here would drift from the first.
 */
export default function ManageBooking({ token }: { token: string }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'view' | 'reschedule' | 'cancel'>('view');
  const [days, setDays] = useState<DaySlots[]>([]);
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

  async function openReschedule() {
    if (!payload) return;
    setMode('reschedule');
    setBusy(true);
    setError(null);
    try {
      // Availability for a reschedule is read on the client audience: the
      // person already holds a booking, so the gate does not apply to them.
      const response = await fetch(
        `/api/manage/${encodeURIComponent(token)}/availability`,
      );
      if (response.ok) {
        setDays(((await response.json()) as { days: DaySlots[] }).days);
      } else {
        setDays([]);
        setError('We could not load available times just now.');
      }
    } finally {
      setBusy(false);
    }
  }

  const formatWhen = (iso: string) =>
    new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));

  const formatTime = (iso: string) =>
    new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(
      new Date(iso),
    );

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

  const { booking, tenant } = payload;

  return (
    <main className="widget">
      <h1>{tenant.name}</h1>

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}

      <div className="card">
        <h2>{booking.eventTypeName ?? 'Your booking'}</h2>
        <p style={{ margin: '0 0 6px' }}>{formatWhen(booking.startsAt)}</p>
        <p className="status" style={{ margin: 0 }}>
          {booking.status === 'cancelled' ? 'Cancelled' : `Booked for ${booking.name}`}
        </p>
        {booking.meetingUrl && booking.status === 'confirmed' && (
          <p style={{ margin: '10px 0 0' }}>
            <a href={booking.meetingUrl}>Join the video call</a>
          </p>
        )}
      </div>

      {booking.status === 'confirmed' && mode === 'view' && (
        <div className="actions">
          <button type="button" className="btn-secondary" onClick={openReschedule}>
            Reschedule
          </button>
          <button type="button" className="btn-link" onClick={() => setMode('cancel')}>
            Cancel this booking
          </button>
        </div>
      )}

      {mode === 'reschedule' && (
        <>
          <h2 style={{ marginTop: 24 }}>Pick a new time</h2>
          {busy && <p className="status">Loading times…</p>}
          {!busy && days.length === 0 && (
            <p className="notice notice-muted">No other times are available right now.</p>
          )}
          <div className="grid-days">
            {days.map((day) => (
              <div className="day" key={day.date}>
                <h3>
                  {new Intl.DateTimeFormat(undefined, {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  }).format(new Date(`${day.date}T12:00:00`))}
                </h3>
                <div className="slots">
                  {day.slots.map((iso) => (
                    <button
                      key={iso}
                      type="button"
                      className="slot"
                      disabled={busy}
                      onClick={() => act({ action: 'reschedule', startsAt: iso })}
                    >
                      {formatTime(iso)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="actions">
            <button type="button" className="btn-link" onClick={() => setMode('view')}>
              Keep my current time
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
          <div className="actions">
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Cancelling…' : 'Cancel booking'}
            </button>
            <button type="button" className="btn-link" onClick={() => setMode('view')}>
              Keep it
            </button>
          </div>
        </form>
      )}
    </main>
  );
}
