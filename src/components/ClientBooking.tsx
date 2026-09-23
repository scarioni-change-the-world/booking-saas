'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAutoResize } from './useAutoResize';
import { DEFAULT_CURRENCY, formatMoney } from '@/lib/money';
import { DateNavigator } from './booking/DateNavigator';
import {
  downloadCalendar,
  downloadIcs,
  googleCalendarUrl,
  type CalendarEvent,
} from './booking/calendar-actions';
import { groupSlots } from './booking/slots';
import type { DaySlots } from './types';

/* How many times a period shows before "Show N more". Matches the public
   booking flow: this screen and that one are the same product, and a
   client who books through both should not be able to tell which is
   which. */
const SLOTS_BEFORE_MORE = 8;

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

/** A programme this client can buy — not one they already hold. */
interface PackType {
  id: string;
  name: string;
  durationMinutes: number;
  packSize: number;
  priceMinor: number | null;
}

/** One thing this client can pick from — either a package to redeem from or
 * a one-off session to book outright. Distinguished by `kind` rather than
 * two parallel lists everywhere downstream needs to branch on. */
type Option =
  | ({ kind: 'package' } & Entitlement)
  | ({ kind: 'single' } & SingleType)
  | ({ kind: 'programme' } & PackType);

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

/**
 * How many times this option lets you pick, and whether you must pick them
 * all.
 *
 * A package you hold is spent at your own pace — one session today, three
 * next month — so anything from one up to the balance is a valid choice. A
 * programme you are buying is sold as a whole: ten appointments booked
 * together is what a pack IS here (one INSERT, one exclusion constraint,
 * all or none), so the button stays shut until all of them are chosen.
 */
export function pickRule(option: Option): { cap: number; exact: boolean } {
  if (option.kind === 'package') return { cap: option.remaining, exact: false };
  if (option.kind === 'programme') return { cap: option.packSize, exact: true };
  return { cap: 1, exact: true };
}

interface BatchResult {
  startsAt: string;
  status: 'booked' | 'unavailable' | 'no_sessions_left';
  booking: {
    startsAt: string;
    endsAt: string;
    manageToken: string;
    meetingUrl: string | null;
    confirmationEmailSent: boolean;
  } | null;
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
  /** Programmes offered to existing clients — ones to buy, not ones held. */
  const [packTypes, setPackTypes] = useState<PackType[]>([]);
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
  const [option, setOption] = useState<Option | null>(null);

  const [days, setDays] = useState<DaySlots[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Package redemption — several slots at once.
  const [selected, setSelected] = useState<string[]>([]);
  /** Which "Show N more" links have been opened, keyed by day and period. */
  const [expandedPeriods, setExpandedPeriods] = useState<Record<string, boolean>>({});
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
          packEventTypes: PackType[];
          currency: string;
        }>(`${base}/client/${encodeURIComponent(token)}`);
        if (cancelled) return;

        setClientName(result.client.name);
        const withBalance = result.entitlements.filter((e) => e.remaining > 0);
        setEntitlements(withBalance);
        setSingleTypes(result.singleEventTypes);
        setPackTypes(result.packEventTypes ?? []);
        setCurrency(result.currency ?? DEFAULT_CURRENCY);

        /* Order is the argument. What they already paid for comes first,
           then a single session, then a new programme — cheapest
           commitment to largest, and a balance they are owed above
           anything that asks them to buy again. */
        const options: Option[] = [
          ...withBalance.map((e): Option => ({ kind: 'package', ...e })),
          ...result.singleEventTypes.map((t): Option => ({ kind: 'single', ...t })),
          ...(result.packEventTypes ?? []).map((t): Option => ({ kind: 'programme', ...t })),
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

  /**
   * "Book another one" from the confirmation.
   *
   * Re-reads the balance from the server rather than subtracting locally:
   * the number on screen came back with the last batch, but a business can
   * grant or spend sessions elsewhere, and a second visit built on a stale
   * count is how somebody gets offered a session they no longer have.
   */
  async function bookMore() {
    setError(null);
    setResults(null);
    setSelected([]);
    setDays([]);
    setExpandedPeriods({});
    setStep('loading');
    try {
      const result = await getJson<{
        client: { name: string };
        entitlements: Entitlement[];
        singleEventTypes: SingleType[];
        packEventTypes: PackType[];
        currency: string;
      }>(`${base}/client/${encodeURIComponent(token)}`);

      const withBalance = result.entitlements.filter((e) => e.remaining > 0);
      setEntitlements(withBalance);
      setSingleTypes(result.singleEventTypes);
      setPackTypes(result.packEventTypes ?? []);

      // Straight back into the package they were already spending, when it
      // still has something on it. Anything else is a step for its own sake.
      const same =
        option?.kind === 'package'
          ? withBalance.find((e) => e.id === option.id)
          : undefined;

      if (same) {
        chooseOption({ kind: 'package', ...same });
      } else if (
        withBalance.length + result.singleEventTypes.length + (result.packEventTypes?.length ?? 0) ===
        0
      ) {
        setStep('nothing-to-book');
      } else {
        setOption(null);
        setStep('pick-option');
      }
    } catch {
      setStep('not-found');
    }
  }

  function chooseOption(chosen: Option) {
    setOption(chosen);
    setStep(chosen.kind === 'single' ? 'pick-time-single' : 'pick-times');
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
    if (!option || option.kind === 'single') return;
    const { cap } = pickRule(option);
    setSelected((prev) => {
      if (prev.includes(iso)) return prev.filter((s) => s !== iso);
      if (prev.length >= cap) return prev; // at the cap
      return [...prev, iso];
    });
  }

  /** Buying a programme: every appointment at once, or none. */
  async function submitProgramme() {
    if (!option || option.kind !== 'programme') return;
    if (selected.length !== option.packSize) return;
    setBusy(true);
    setStep('booking');
    setError(null);
    try {
      const result = await postJson<{ bookings: BatchResult['booking'][] }>(
        `${base}/client/${encodeURIComponent(token)}/programmes`,
        { eventTypeId: option.id, slots: selected },
      );
      /* Shaped into the same results the redemption path produces, so the
         confirmation screen has one thing to render rather than two. The
         server books all of them or none, so every one of these is
         'booked'. */
      setResults(
        (result.bookings ?? []).map((booking) => ({
          startsAt: booking!.startsAt,
          status: 'booked' as const,
          booking,
        })),
      );
      setRemaining(0);
      setStep('done');
    } catch (cause) {
      setError((cause as Error).message);
      setStep('pick-times');
    } finally {
      setBusy(false);
    }
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
  const multipleOptions = entitlements.length + singleTypes.length + packTypes.length > 1;

  function backToOptions() {
    setOption(null);
    setSelected([]);
    setSingleSlot(null);
    setDays([]);
    setStep('pick-option');
  }

  /* The same frame the public booking flow stands in — panel, page,
     credit. This screen used to carry a layout of its own, which meant a
     client who booked once through the questionnaire and again through
     their own link saw two different products. */
  const shell = (children: ReactNode) => (
    <div className="bk bk-standalone">
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

  if (step === 'loading') {
    return shell(
      <p className="bk-status" role="status">
        Loading…
      </p>,
    );
  }

  if (step === 'not-found') {
    return shell(
      <p className="bk-error" role="alert">
        This link isn&apos;t valid. Check it against the one you were sent, or ask for a new
        one.
      </p>,
    );
  }

  if (step === 'nothing-to-book') {
    return shell(
      <section>
        <h1 className="bk-heading">Hi {clientName.split(' ')[0]}</h1>
        <p className="bk-empty">
          There&apos;s nothing to book on this link right now — every package session may
          already be used, or nothing has been set up yet. Reach out if that doesn&apos;t sound
          right.
        </p>
      </section>,
    );
  }

  return shell(
    <>
      {error && (
        <p className="bk-error" role="alert">
          {error}
        </p>
      )}

      {step === 'pick-option' && (
        <section>
          <h1 className="bk-heading">
            Hi {clientName.split(' ')[0]}, what would you like to book?
          </h1>
          <ul className="bk-service-list">
            {entitlements.map((e) => (
              <li key={`package-${e.id}`}>
                <button
                  type="button"
                  className="bk-service-option"
                  onClick={() => chooseOption({ kind: 'package', ...e })}
                >
                  <span className="bk-service-option-main">
                    <span className="bk-service-option-name">{e.eventTypeName}</span>
                    <span className="bk-service-option-facts">
                      {e.remaining} of {e.totalSessions} sessions left · {e.durationMinutes}{' '}
                      minutes
                    </span>
                  </span>
                  <span className="bk-service-option-go" aria-hidden="true">
                    →
                  </span>
                </button>
              </li>
            ))}
            {singleTypes.map((t) => (
              <li key={`single-${t.id}`}>
                <button
                  type="button"
                  className="bk-service-option"
                  onClick={() => chooseOption({ kind: 'single', ...t })}
                >
                  <span className="bk-service-option-main">
                    <span className="bk-service-option-name">{t.name}</span>
                    <span className="bk-service-option-facts">{t.durationMinutes} minutes</span>
                  </span>
                  <span className="bk-service-option-go" aria-hidden="true">
                    →
                  </span>
                </button>
              </li>
            ))}
            {/* Buying again. Last in the list on purpose: a balance they
                already hold, and a single session, both ask less of them
                than committing to another programme. */}
            {packTypes.map((t) => (
              <li key={`programme-${t.id}`}>
                <button
                  type="button"
                  className="bk-service-option"
                  onClick={() => chooseOption({ kind: 'programme', ...t })}
                >
                  <span className="bk-service-option-main">
                    <span className="bk-service-option-name">{t.name}</span>
                    <span className="bk-service-option-facts">
                      {t.packSize} appointments · {t.durationMinutes} minutes each
                    </span>
                  </span>
                  {t.priceMinor !== null && (
                    <span className="bk-service-option-price">
                      {formatMoney(t.priceMinor, currency)}
                      <span className="bk-service-option-per">per session</span>
                    </span>
                  )}
                  <span className="bk-service-option-go" aria-hidden="true">
                    →
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {step === 'pick-times' && option?.kind === 'programme' && (
        <section>
          <h1 className="bk-heading">Choose your {option.packSize} times</h1>
          <p className="bk-lede">
            Pick every appointment now and they are all booked together. You can change any one
            of them afterwards without affecting the rest.
          </p>

          {busy && days.length === 0 && (
            <p className="bk-status" role="status">
              Finding available times…
            </p>
          )}

          {!busy && days.length === 0 && (
            <p className="bk-empty">No times are available in the next few weeks.</p>
          )}

          {days.length > 0 && (
            <TimesPicker
              days={days}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
              activeDay={activeDay}
              dowFormat={dowFormat}
              formatDay={formatDay}
              formatTimeRange={formatTimeRange}
              durationMinutes={option.durationMinutes}
              isPicked={(iso) => selected.includes(iso)}
              isFull={(iso) => !selected.includes(iso) && selected.length >= option.packSize}
              onPick={toggleSlot}
              expandedPeriods={expandedPeriods}
              onExpand={(key) => setExpandedPeriods((prev) => ({ ...prev, [key]: true }))}
            />
          )}

          <p className="bk-zone">Times are shown in your timezone: {viewerZone}.</p>

          <div className="bk-pack-bar">
            <div>
              <p className="bk-pack-count" aria-live="polite">
                {selected.length} of {option.packSize} chosen
              </p>
              {selected.length > 0 && (
                <ol className="bk-pack-list">
                  {selected.map((iso) => (
                    <li key={iso}>
                      <span>
                        {formatDay(iso.slice(0, 10))}, {timeFormat.format(new Date(iso))}
                      </span>
                      <button
                        type="button"
                        className="bk-pack-remove"
                        onClick={() => toggleSlot(iso)}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </div>
            <button
              type="button"
              className="btn-primary btn-full"
              disabled={selected.length !== option.packSize || busy}
              onClick={submitProgramme}
            >
              {selected.length === option.packSize
                ? `Book all ${option.packSize}`
                : `Choose ${option.packSize - selected.length} more`}
            </button>
          </div>

          {multipleOptions && (
            <p className="bk-after">
              <button type="button" className="bk-textlink" onClick={backToOptions}>
                Choose something else
              </button>
            </p>
          )}
        </section>
      )}

      {step === 'pick-times' && option?.kind === 'package' && (
        <section>
          <h1 className="bk-heading">{option.eventTypeName}</h1>

          <div className="bk-session-dots" aria-hidden="true">
            {Array.from({ length: option.totalSessions }).map((_, i) => {
              const isUsed = i < option.usedSessions;
              const isPicking = !isUsed && i < option.usedSessions + selected.length;
              return (
                <span
                  key={i}
                  className={`bk-session-dot${isUsed ? ' is-used' : ''}${
                    isPicking ? ' is-picking' : ''
                  }`}
                />
              );
            })}
          </div>

          <p className="bk-lede">
            {selected.length > 0 ? (
              <>
                <strong>{selected.length}</strong> selected — {option.remaining - selected.length}{' '}
                left after this.
              </>
            ) : (
              <>
                You have <strong>{option.remaining}</strong> of {option.totalSessions} sessions
                left. Select as many times as you like, across as many days as you like.
              </>
            )}
          </p>

          {busy && days.length === 0 && (
            <p className="bk-status" role="status">
              Finding available times…
            </p>
          )}

          {!busy && days.length === 0 && (
            <p className="bk-empty">No times are available in the next few weeks.</p>
          )}

          {days.length > 0 && (
            <TimesPicker
              days={days}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
              activeDay={activeDay}
              dowFormat={dowFormat}
              formatDay={formatDay}
              formatTimeRange={formatTimeRange}
              durationMinutes={option.durationMinutes}
              isPicked={(iso) => selected.includes(iso)}
              isFull={(iso) => !selected.includes(iso) && selected.length >= option.remaining}
              onPick={toggleSlot}
              expandedPeriods={expandedPeriods}
              onExpand={(key) => setExpandedPeriods((prev) => ({ ...prev, [key]: true }))}
            />
          )}

          <p className="bk-zone">Times are shown in your timezone: {viewerZone}.</p>

          {/* Sticky at the foot, for the same reason the public pack step
              has one: picking several sessions means scrolling, and a count
              that scrolls away stops being a count. */}
          <div className="bk-pack-bar">
            <div>
              <p className="bk-pack-count" aria-live="polite">
                {selected.length} selected
              </p>
              {selected.length > 0 && (
                <ol className="bk-pack-list">
                  {selected.map((iso) => (
                    <li key={iso}>
                      <span>
                        {formatDay(iso.slice(0, 10))}, {timeFormat.format(new Date(iso))}
                      </span>
                      <button
                        type="button"
                        className="bk-pack-remove"
                        onClick={() => toggleSlot(iso)}
                      >
                        Remove
                        <span className="sr-only">
                          {' '}
                          {formatDay(iso.slice(0, 10))} at {timeFormat.format(new Date(iso))}
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </div>
            <button
              type="button"
              className="btn-primary btn-full"
              disabled={selected.length === 0 || busy}
              onClick={submitBatch}
            >
              {selected.length === 0
                ? 'Pick at least one time'
                : `Book ${selected.length} session${selected.length === 1 ? '' : 's'}`}
            </button>
          </div>

          {multipleOptions && (
            <p className="bk-after">
              <button type="button" className="bk-textlink" onClick={backToOptions}>
                Choose something else
              </button>
            </p>
          )}
        </section>
      )}

      {step === 'booking' && (
        <p className="bk-status" role="status">
          Booking…
        </p>
      )}

      {step === 'done' && results && (
        <section>
          {(() => {
            const booked = results.filter((r) => r.status === 'booked');
            const missed = results.filter((r) => r.status !== 'booked');
            const serviceName = option?.kind === 'package' ? option.eventTypeName : 'Session';
            const minutes = option?.durationMinutes ?? 30;
            const events: CalendarEvent[] = booked
              .filter((r) => r.booking)
              .map((r) => ({
                title: `${serviceName} — ${clientName}`,
                startsAt: r.booking!.startsAt,
                durationMinutes: minutes,
                location: r.booking!.meetingUrl ?? undefined,
                uid: r.booking!.manageToken,
              }));
            const anyEmailSent = booked.some((r) => r.booking?.confirmationEmailSent);

            return (
              <>
                <h1 className="bk-heading">
                  {missed.length === 0
                    ? booked.length === 1
                      ? "You're booked."
                      : "You're all booked in."
                    : `${booked.length} of ${results.length} booked`}
                </h1>

                {missed.length > 0 && (
                  <p className="bk-lede">
                    A couple of times went while you were choosing. Nothing was charged
                    against your package for those.
                  </p>
                )}

                <ol className="bk-pack-confirmed">
                  {results.map((r, index) => (
                    <li key={r.startsAt}>
                      <span className="bk-pack-n">{index + 1}</span>
                      <span className="bk-pack-when">
                        {dayFormat.format(new Date(r.startsAt))} at{' '}
                        {timeFormat.format(new Date(r.startsAt))}
                      </span>
                      {r.booking ? (
                        /* Every booking gets its own way back. Without these
                           the screen was a receipt with no handle on it: the
                           appointments existed and nothing on the page could
                           reach them. */
                        <a className="bk-textlink" href={`/manage/${r.booking.manageToken}`}>
                          Change
                        </a>
                      ) : (
                        <span className="bk-result is-missed">Not available</span>
                      )}
                    </li>
                  ))}
                </ol>

                {booked.some((r) => r.booking?.meetingUrl) && booked.length === 1 && (
                  <a className="bk-join" href={booked[0]!.booking!.meetingUrl!}>
                    Join the video call
                  </a>
                )}

                {events.length > 0 && (
                  <div className="bk-add">
                    <p className="bk-add-label">
                      {events.length > 1
                        ? 'Add them to your calendar'
                        : 'Add it to your calendar'}
                    </p>
                    <div className="bk-add-actions">
                      {events.length > 1 ? (
                        <button
                          type="button"
                          className="bk-textlink"
                          onClick={() => downloadCalendar(events)}
                        >
                          Download all {events.length} appointments
                        </button>
                      ) : (
                        <>
                          <a
                            className="bk-textlink"
                            href={googleCalendarUrl(events[0]!)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Google Calendar
                          </a>
                          <button
                            type="button"
                            className="bk-textlink"
                            onClick={() => downloadIcs(events[0]!)}
                          >
                            Apple, Outlook or other
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* Said only when an email really went. Promising a
                    confirmation that never left is the worst version of this
                    screen — it is the person who believes it who turns up to
                    nothing, because they trusted the inbox over the time. */}
                {anyEmailSent && (
                  <p className="bk-after">
                    We&apos;ve sent {booked.length === 1 ? 'a confirmation' : 'confirmations'} to
                    your inbox with everything you need. Nothing arrived? Check your spam
                    folder.
                  </p>
                )}

                <p className="bk-after">
                  {remaining > 0 ? (
                    <>
                      You have {remaining} session{remaining === 1 ? '' : 's'} left on this
                      package.{' '}
                      <button type="button" className="bk-textlink" onClick={bookMore}>
                        Book {remaining === 1 ? 'it' : 'another'} now
                      </button>{' '}
                      — or come back to this same link any time.
                    </>
                  ) : (
                    <>
                      That was the last session on this package. Keep this link — anything your
                      business adds to it later shows up here.
                    </>
                  )}
                </p>
              </>
            );
          })()}
        </section>
      )}

      {step === 'pick-time-single' && option?.kind === 'single' && (
        <section>
          <h1 className="bk-heading">{option.name}</h1>

          {busy && days.length === 0 && (
            <p className="bk-status" role="status">
              Finding available times…
            </p>
          )}

          {!busy && days.length === 0 && (
            <p className="bk-empty">No times are available in the next few weeks.</p>
          )}

          {days.length > 0 && (
            <TimesPicker
              days={days}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
              activeDay={activeDay}
              dowFormat={dowFormat}
              formatDay={formatDay}
              formatTimeRange={formatTimeRange}
              durationMinutes={option.durationMinutes}
              isPicked={(iso) => singleSlot === iso}
              isFull={() => false}
              onPick={setSingleSlot}
              expandedPeriods={expandedPeriods}
              onExpand={(key) => setExpandedPeriods((prev) => ({ ...prev, [key]: true }))}
            />
          )}

          <p className="bk-zone">Times are shown in your timezone: {viewerZone}.</p>

          <button
            type="button"
            className="btn-primary btn-full"
            disabled={!singleSlot || busy}
            onClick={submitSingle}
          >
            {singleSlot ? 'Confirm booking' : 'Pick a time'}
          </button>

          {multipleOptions && (
            <p className="bk-after">
              <button type="button" className="bk-textlink" onClick={backToOptions}>
                Choose something else
              </button>
            </p>
          )}
        </section>
      )}

      {step === 'booking-single' && (
        <p className="bk-status" role="status">
          Booking…
        </p>
      )}

      {step === 'done-single' && confirmed && (
        <section>
          <h1 className="bk-heading">You&apos;re booked.</h1>

          <div className="bk-confirmed">
            <p className="bk-confirmed-when">{dayFormat.format(new Date(confirmed.startsAt))}</p>
            <p className="bk-confirmed-time">
              {timeFormat.format(new Date(confirmed.startsAt))}
            </p>
            {option?.kind === 'single' && (
              <p className="bk-confirmed-what">{option.name}</p>
            )}
            <p className="bk-confirmed-zone">{viewerZone}</p>
          </div>

          {confirmed.meetingUrl && (
            <a className="bk-join" href={confirmed.meetingUrl}>
              Join the video call
            </a>
          )}

          <p className="bk-after">
            Keep this link to reschedule or cancel:{' '}
            <a className="bk-textlink" href={`/manage/${confirmed.manageToken}`}>
              manage your booking
            </a>
            .
          </p>
        </section>
      )}
    </>,
  );
}

/**
 * Choosing a day and a time.
 *
 * One component for both jobs this page does — redeeming several sessions
 * from a package, and booking a single one — because they differ only in
 * how many times may be lit at once. It is also the same arrangement the
 * public booking flow uses (DateNavigator, then times grouped by period),
 * for the plain reason that a client who books through both should not be
 * able to tell they are different screens.
 */
function TimesPicker({
  days,
  selectedDate,
  onSelectDate,
  activeDay,
  dowFormat,
  formatDay,
  formatTimeRange,
  durationMinutes,
  isPicked,
  isFull,
  onPick,
  expandedPeriods,
  onExpand,
}: {
  days: DaySlots[];
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
  activeDay: DaySlots | null;
  dowFormat: Intl.DateTimeFormat;
  formatDay: (date: string) => string;
  formatTimeRange: (iso: string, minutes: number) => string;
  durationMinutes: number;
  isPicked: (iso: string) => boolean;
  /** True when pressing this would silently do nothing — the package has no
   *  sessions left to put against it. Said with a disabled state. */
  isFull: (iso: string) => boolean;
  onPick: (iso: string) => void;
  expandedPeriods: Record<string, boolean>;
  onExpand: (key: string) => void;
}) {
  return (
    <>
      <DateNavigator
        days={days}
        selectedDate={selectedDate}
        onSelect={onSelectDate}
        dowFormat={dowFormat}
      />

      {activeDay && (
        <div className="bk-times">
          <h2 className="bk-day">{formatDay(activeDay.date)}</h2>

          {groupSlots(activeDay.slots).map((group) => {
            const key = `${activeDay.date}:${group.period}`;
            const expanded = expandedPeriods[key] ?? false;
            const shown = expanded ? group.slots : group.slots.slice(0, SLOTS_BEFORE_MORE);
            const hidden = group.slots.length - shown.length;

            return (
              <div className="bk-period" key={group.period}>
                <h3 className="bk-period-label">{group.label}</h3>
                <div className="bk-slots">
                  {shown.map((iso) => {
                    const picked = isPicked(iso);
                    return (
                      <button
                        key={iso}
                        type="button"
                        className={`bk-slot${picked ? ' is-selected' : ''}`}
                        disabled={isFull(iso)}
                        aria-pressed={picked}
                        onClick={() => onPick(iso)}
                      >
                        {formatTimeRange(iso, durationMinutes)}
                      </button>
                    );
                  })}
                </div>
                {hidden > 0 && (
                  <button
                    type="button"
                    className="bk-textlink bk-more"
                    onClick={() => onExpand(key)}
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
  );
}
