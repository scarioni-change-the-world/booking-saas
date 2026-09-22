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

interface SingleType {
  id: string;
  name: string;
  durationMinutes: number;
}

/** One thing this client can pick from — either a package to redeem from or
 * a one-off session to book outright. Distinguished by `kind` rather than
 * two parallel lists everywhere downstream needs to branch on. */
type Option =
  | ({ kind: 'package' } & Entitlement)
  | ({ kind: 'single' } & SingleType);

/**
 * The service an option books against.
 *
 * Both members of the union have an `id`, and they mean different things: a
 * package's is the entitlement's, a one-off's is the event type's. Reading
 * `option.id` for availability therefore typechecked and asked the server
 * for a service whose id was really a grant's — so every package redemption
 * answered "Unknown event type" and showed no times at all. Asking through
 * this function instead makes the two cases impossible to confuse.
 */
export function serviceIdOf(option: Option): string {
  return option.kind === 'package' ? option.eventTypeId : option.id;
}

interface BatchResult {
  startsAt: string;
  status: 'booked' | 'unavailable' | 'no_sessions_left';
  booking: { startsAt: string; manageToken: string; meetingUrl: string | null } | null;
}

interface SingleBooking {
  startsAt: string;
  manageToken: string;
  meetingUrl: string | null;
}

type Step =
  | 'loading'
  | 'not-found'
  | 'nothing-to-book'
  | 'pick-option'
  | 'pick-times' // package redemption — several slots, one visit
  | 'booking'
  | 'done'
  | 'pick-time-single' // one-off booking — a single slot
  | 'booking-single'
  | 'done-single';

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
 * An existing client's own private link (brief 2.1, 2.3) — the token IS the
 * credential, same shape as a booking's manage token (migration 0010). Two
 * things a client might do from here: redeem sessions from a package
 * they've already paid for, or book a one-off session outright. Both skip
 * the qualification gate entirely — that only ever applies to a prospect who
 * hasn't been screened yet, not someone the tenant already knows.
 *
 * Deliberately its own component rather than a mode bolted onto BookingFlow:
 * the two flows share almost no steps (no questions, no name/email "details"
 * form — a client's identity is already on file, resolved from the token)
 * and a shared component trying to serve both shapes was the more likely
 * place to introduce a bug into the already-solid prospect flow. This used
 * to be package-redemption only (ClientPackageBooking); one-off booking was
 * added once the plain, token-less /t/[slug]/client door — unlisted, but
 * not actually authenticated — was retired in its favour.
 */
export default function ClientBooking({ slug, token }: Props) {
  useAutoResize();

  const [step, setStep] = useState<Step>('loading');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [clientName, setClientName] = useState('');
  const [entitlements, setEntitlements] = useState<Entitlement[]>([]);
  const [singleTypes, setSingleTypes] = useState<SingleType[]>([]);
  const [option, setOption] = useState<Option | null>(null);

  const [days, setDays] = useState<DaySlots[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Package redemption — several slots at once.
  const [selected, setSelected] = useState<string[]>([]);
  const [results, setResults] = useState<BatchResult[] | null>(null);
  const [remaining, setRemaining] = useState(0);

  // One-off booking — a single slot.
  const [singleSlot, setSingleSlot] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<SingleBooking | null>(null);

  const base = `/api/t/${encodeURIComponent(slug)}`;

  const viewerZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await getJson<{
          client: { name: string };
          entitlements: Entitlement[];
          singleEventTypes: SingleType[];
        }>(`${base}/client/${encodeURIComponent(token)}`);
        if (cancelled) return;

        setClientName(result.client.name);
        const withBalance = result.entitlements.filter((e) => e.remaining > 0);
        setEntitlements(withBalance);
        setSingleTypes(result.singleEventTypes);

        const options: Option[] = [
          ...withBalance.map((e): Option => ({ kind: 'package', ...e })),
          ...result.singleEventTypes.map((t): Option => ({ kind: 'single', ...t })),
        ];

        if (options.length === 0) {
          setStep('nothing-to-book');
        } else if (options.length === 1) {
          chooseOption(options[0]!);
        } else {
          setStep('pick-option');
        }
      } catch {
        if (!cancelled) setStep('not-found');
      }
      // chooseOption is stable across the life of this component (defined
      // below with no dependency on anything that changes) — safe to call
      // from here without adding it to the effect's own dependencies.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    })();
    return () => {
      cancelled = true;
    };
  }, [base, token]);

  function chooseOption(chosen: Option) {
    setOption(chosen);
    setStep(chosen.kind === 'package' ? 'pick-times' : 'pick-time-single');
  }

  const loadAvailability = useCallback(
    async (eventTypeId: string) => {
      setBusy(true);
      setError(null);
      try {
        const params = new URLSearchParams({ eventTypeId, audience: 'client' });
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
    if ((step === 'pick-times' || step === 'pick-time-single') && option) {
      void loadAvailability(serviceIdOf(option));
    }
  }, [step, option, loadAvailability]);

  function toggleSlot(iso: string) {
    if (!option || option.kind !== 'package') return;
    setSelected((prev) => {
      if (prev.includes(iso)) return prev.filter((s) => s !== iso);
      if (prev.length >= option.remaining) return prev; // at the cap
      return [...prev, iso];
    });
  }

  async function submitBatch() {
    if (!option || option.kind !== 'package' || selected.length === 0) return;
    setBusy(true);
    setStep('booking');
    setError(null);
    try {
      const result = await postJson<{ results: BatchResult[]; remaining: number }>(
        `${base}/client/${encodeURIComponent(token)}/bookings`,
        { entitlementId: option.id, startTimes: selected },
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

  async function submitSingle() {
    if (!option || option.kind !== 'single' || !singleSlot) return;
    setBusy(true);
    setStep('booking-single');
    setError(null);
    try {
      const result = await postJson<{ booking: SingleBooking }>(
        `${base}/client/${encodeURIComponent(token)}/single-session`,
        { eventTypeId: option.id, startsAt: singleSlot },
      );
      setConfirmed(result.booking);
      setStep('done-single');
    } catch (cause) {
      setError((cause as Error).message);
      setSingleSlot(null);
      setStep('pick-time-single');
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
  const multipleOptions = entitlements.length + singleTypes.length > 1;

  function backToOptions() {
    setOption(null);
    setSelected([]);
    setSingleSlot(null);
    setDays([]);
    setStep('pick-option');
  }

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

  if (step === 'nothing-to-book') {
    return (
      <main className="widget">
        <h2>Hi {clientName.split(' ')[0]}</h2>
        <p className="notice notice-muted">
          There's nothing to book on this link right now — every package session may already be
          used, or nothing has been set up yet. Reach out if that doesn't sound right.
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

      {step === 'pick-option' && (
        <>
          <h2>Hi {clientName.split(' ')[0]}, what would you like to book?</h2>
          <div className="type-list">
            {entitlements.map((e) => (
              <button
                key={`package-${e.id}`}
                type="button"
                className="type"
                onClick={() => chooseOption({ kind: 'package', ...e })}
              >
                <strong>{e.eventTypeName}</strong>
                <span>{e.remaining} of {e.totalSessions} sessions left</span>
              </button>
            ))}
            {singleTypes.map((t) => (
              <button
                key={`single-${t.id}`}
                type="button"
                className="type"
                onClick={() => chooseOption({ kind: 'single', ...t })}
              >
                <strong>{t.name}</strong>
                <span>{t.durationMinutes} min</span>
              </button>
            ))}
          </div>
        </>
      )}

      {step === 'pick-times' && option?.kind === 'package' && (
        <>
          <h2>{option.eventTypeName}</h2>

          <div className="session-dots" aria-hidden="true">
            {Array.from({ length: option.totalSessions }).map((_, i) => {
              const isUsed = i < option.usedSessions;
              const isPicking = !isUsed && i < option.usedSessions + selected.length;
              return (
                <span key={i} className={`session-dot${isUsed ? ' used' : ''}${isPicking ? ' picking' : ''}`} />
              );
            })}
          </div>

          <p className="lede">
            {selected.length > 0 ? (
              <>
                <strong>{selected.length}</strong> selected — {option.remaining - selected.length} left
                after this.
              </>
            ) : (
              <>
                You have <strong>{option.remaining}</strong> of {option.totalSessions} sessions left.
                Select as many times as you like, across as many days as you like.
              </>
            )}
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
                  <div className="slots multi">
                    {activeDay.slots.map((iso) => {
                      const isSelected = selected.includes(iso);
                      const atCap = !isSelected && selected.length >= option.remaining;
                      return (
                        <button
                          key={iso}
                          type="button"
                          className={`slot${isSelected ? ' selected' : ''}`}
                          disabled={atCap}
                          style={atCap ? { opacity: 0.4 } : undefined}
                          onClick={() => toggleSlot(iso)}
                        >
                          {formatTimeRange(iso, option.durationMinutes)}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}

          <p className="tz">Times shown in your timezone ({viewerZone}).</p>

          {multipleOptions && (
            <div className="actions" style={{ justifyContent: 'center' }}>
              <button type="button" className="btn-link" onClick={backToOptions}>
                Choose something else
              </button>
            </div>
          )}

          <button
            type="button"
            className="btn-primary btn-full"
            disabled={selected.length === 0 || busy}
            onClick={submitBatch}
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

      {step === 'pick-time-single' && option?.kind === 'single' && (
        <>
          <h2>{option.name}</h2>

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
                    {activeDay.slots.map((iso) => (
                      <button
                        key={iso}
                        type="button"
                        className={`slot${singleSlot === iso ? ' selected' : ''}`}
                        onClick={() => setSingleSlot(iso)}
                      >
                        {formatTimeRange(iso, option.durationMinutes)}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          <p className="tz">Times shown in your timezone ({viewerZone}).</p>

          {multipleOptions && (
            <div className="actions" style={{ justifyContent: 'center' }}>
              <button type="button" className="btn-link" onClick={backToOptions}>
                Choose something else
              </button>
            </div>
          )}

          <button
            type="button"
            className="btn-primary btn-full"
            disabled={!singleSlot || busy}
            onClick={submitSingle}
            style={{ marginTop: 14 }}
          >
            {singleSlot ? 'Confirm booking' : 'Pick a time'}
          </button>
        </>
      )}

      {step === 'booking-single' && <p className="status">Booking…</p>}

      {step === 'done-single' && confirmed && (
        <>
          <h2>You&apos;re booked</h2>
          <div className="hero">
            <div className="eyebrow">{dayFormat.format(new Date(confirmed.startsAt))}</div>
            <div className="when">{timeFormat.format(new Date(confirmed.startsAt))}</div>
            {option?.kind === 'single' && <div className="what">{option.name}</div>}
          </div>

          {confirmed.meetingUrl && (
            <a className="hero-link" href={confirmed.meetingUrl}>
              Join the video call
            </a>
          )}

          <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginTop: 16 }}>
            Keep this link to reschedule or cancel:{' '}
            <a className="btn-link" href={`/manage/${confirmed.manageToken}`}>
              manage your booking
            </a>
            .
          </p>
        </>
      )}

      <p className="footer-credit">Powered by intro</p>
    </main>
  );
}
