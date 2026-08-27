'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAutoResize } from './useAutoResize';
import type { DaySlots } from './types';

interface Entitlement {
  id: string;
  eventTypeId: string;
  eventTypeName: string;
  durationMinutes: number;
  totalSessions: number;
  usedSessions: number;
  remaining: number;
}

interface BookingResult {
  startsAt: string;
  status: 'booked' | 'unavailable' | 'no_sessions_left';
  booking: { startsAt: string; manageToken: string; meetingUrl: string | null } | null;
}

type Step = 'loading' | 'not-found' | 'no-package' | 'pick-package' | 'pick-times' | 'booking' | 'done';

interface Props {
  slug: string;
  token: string;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error ?? 'Request failed');
  return body as T;
}

async function postJson<T>(url: string, payload: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error ?? 'Request failed');
  return body as T;
}

/**
 * A client redeeming a package they've already paid for — pick a session
 * type (if they have more than one package), then select as many open
 * times as they have sessions left, across as many days as they like, and
 * book all of them in one visit.
 *
 * Deliberately its own component rather than a mode bolted onto BookingFlow:
 * the two flows share almost no steps (no questions, no single-slot
 * "details" form — a client's name and email are already on file) and a
 * shared component trying to serve both shapes was the more likely place to
 * introduce a bug into the already-solid prospect flow.
 */
export default function ClientPackageBooking({ slug, token }: Props) {
  useAutoResize();

  const [step, setStep] = useState<Step>('loading');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [clientName, setClientName] = useState('');
  const [entitlements, setEntitlements] = useState<Entitlement[]>([]);
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);

  const [days, setDays] = useState<DaySlots[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  const [results, setResults] = useState<BookingResult[] | null>(null);
  const [remaining, setRemaining] = useState(0);

  const base = `/api/t/${encodeURIComponent(slug)}`;

  const viewerZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await getJson<{ client: { name: string }; entitlements: Entitlement[] }>(
          `${base}/client/${encodeURIComponent(token)}`,
        );
        if (cancelled) return;

        setClientName(result.client.name);
        const withBalance = result.entitlements.filter((e) => e.remaining > 0);
        setEntitlements(withBalance);

        if (withBalance.length === 0) {
          setStep('no-package');
        } else if (withBalance.length === 1) {
          setEntitlement(withBalance[0]!);
          setStep('pick-times');
        } else {
          setStep('pick-package');
        }
      } catch {
        if (!cancelled) setStep('not-found');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base, token]);

  const loadAvailability = useCallback(
    async (chosen: Entitlement) => {
      setBusy(true);
      setError(null);
      try {
        const params = new URLSearchParams({ eventTypeId: chosen.eventTypeId, audience: 'client' });
        const result = await getJson<{ days: DaySlots[] }>(`${base}/availability?${params.toString()}`);
        setDays(result.days);
        setSelectedDate(result.days.find((d) => d.slots.length > 0)?.date ?? null);
      } catch (cause) {
        setError((cause as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [base],
  );

  useEffect(() => {
    if (step === 'pick-times' && entitlement) void loadAvailability(entitlement);
  }, [step, entitlement, loadAvailability]);

  function toggleSlot(iso: string) {
    setSelected((prev) => {
      if (prev.includes(iso)) return prev.filter((s) => s !== iso);
      if (entitlement && prev.length >= entitlement.remaining) return prev; // at the cap
      return [...prev, iso];
    });
  }

  async function submitBookings() {
    if (!entitlement || selected.length === 0) return;
    setBusy(true);
    setStep('booking');
    setError(null);
    try {
      const result = await postJson<{ results: BookingResult[]; remaining: number }>(
        `${base}/client/${encodeURIComponent(token)}/bookings`,
        { entitlementId: entitlement.id, startTimes: selected },
      );
      setResults(result.results);
      setRemaining(result.remaining);
      setStep('done');
    } catch (cause) {
      setError((cause as Error).message);
      setStep('pick-times');
    } finally {
      setBusy(false);
    }
  }

  const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const dowFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
  const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
  const formatDay = (date: string) => dayFormat.format(new Date(`${date}T12:00:00`));
  const formatTimeRange = (iso: string, durationMinutes: number) => {
    const start = new Date(iso);
    const end = new Date(start.getTime() + durationMinutes * 60_000);
    return `${timeFormat.format(start)} – ${timeFormat.format(end)}`;
  };

  const activeDay = days.find((d) => d.date === selectedDate) ?? null;

  if (step === 'loading') {
    return (
      <main className="widget">
        <p className="status">Loading…</p>
      </main>
    );
  }

  if (step === 'not-found') {
    return (
      <main className="widget">
        <div className="notice notice-error" role="alert">
          This link isn't valid. Check it against the one you were sent, or ask for a new one.
        </div>
      </main>
    );
  }

  if (step === 'no-package') {
    return (
      <main className="widget">
        <h2>Hi {clientName.split(' ')[0]}</h2>
        <p className="notice notice-muted">
          There's no active package on this link right now — every session may already be used, or
          nothing has been granted yet. Reach out if that doesn't sound right.
        </p>
      </main>
    );
  }

  return (
    <main className="widget">
      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}

      {step === 'pick-package' && (
        <>
          <h2>Hi {clientName.split(' ')[0]}, what would you like to book?</h2>
          <div className="type-list">
            {entitlements.map((e) => (
              <button
                key={e.id}
                type="button"
                className="type"
                onClick={() => {
                  setEntitlement(e);
                  setStep('pick-times');
                }}
              >
                <strong>{e.eventTypeName}</strong>
                <span>{e.remaining} of {e.totalSessions} sessions left</span>
              </button>
            ))}
          </div>
        </>
      )}

      {step === 'pick-times' && entitlement && (
        <>
          <h2>{entitlement.eventTypeName}</h2>
          <p className="lede">
            You have <strong>{entitlement.remaining - selected.length}</strong> of{' '}
            {entitlement.remaining} sessions left to pick. Select as many times as you like, across
            as many days as you like.
          </p>

          {busy && days.length === 0 && <p className="status">Loading times…</p>}

          {!busy && days.length === 0 && (
            <p className="notice notice-muted">No times are available in the next few weeks.</p>
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
                      disabled={!has}
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
                    {activeDay.slots.map((iso) => {
                      const isSelected = selected.includes(iso);
                      const atCap = !isSelected && selected.length >= entitlement.remaining;
                      return (
                        <button
                          key={iso}
                          type="button"
                          className={`slot${isSelected ? ' selected' : ''}`}
                          disabled={atCap}
                          style={atCap ? { opacity: 0.4 } : undefined}
                          onClick={() => toggleSlot(iso)}
                        >
                          {formatTimeRange(iso, entitlement.durationMinutes)}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}

          <p className="tz">Times shown in your timezone ({viewerZone}).</p>

          {entitlements.length > 1 && (
            <div className="actions" style={{ justifyContent: 'center' }}>
              <button
                type="button"
                className="btn-link"
                onClick={() => {
                  setEntitlement(null);
                  setSelected([]);
                  setDays([]);
                  setStep('pick-package');
                }}
              >
                Choose a different package
              </button>
            </div>
          )}

          <button
            type="button"
            className="btn-primary btn-full"
            disabled={selected.length === 0 || busy}
            onClick={submitBookings}
            style={{ marginTop: 14 }}
          >
            {selected.length === 0
              ? 'Pick at least one time'
              : `Book ${selected.length} session${selected.length === 1 ? '' : 's'}`}
          </button>
        </>
      )}

      {step === 'booking' && <p className="status">Booking…</p>}

      {step === 'done' && results && (
        <>
          <h2>
            {results.filter((r) => r.status === 'booked').length} of {results.length} booked
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
            {results.map((r) => (
              <div
                key={r.startsAt}
                className="card"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '13px 16px',
                }}
              >
                <span>
                  {dayFormat.format(new Date(r.startsAt))} at {timeFormat.format(new Date(r.startsAt))}
                </span>
                <span
                  className="notice"
                  style={{
                    margin: 0,
                    padding: '3px 10px',
                    background: r.status === 'booked' ? 'var(--status-live-tint)' : 'var(--status-attention-tint)',
                    color: r.status === 'booked' ? 'var(--status-live-ink)' : 'var(--status-attention-ink)',
                  }}
                >
                  {r.status === 'booked' ? 'Booked' : 'Not available'}
                </span>
              </div>
            ))}
          </div>

          {results.some((r) => r.status !== 'booked') && (
            <p className="notice notice-muted" style={{ marginTop: 14 }}>
              A couple of times went while you were booking — nothing was charged against your
              package for those. You still have {remaining} session{remaining === 1 ? '' : 's'} left
              to use.
            </p>
          )}

          {results.every((r) => r.status === 'booked') && remaining > 0 && (
            <p className="notice notice-muted" style={{ marginTop: 14 }}>
              You still have {remaining} session{remaining === 1 ? '' : 's'} left on this package —
              use this same link any time to book more.
            </p>
          )}
        </>
      )}

      <p className="footer-credit">Powered by intro</p>
    </main>
  );
}
