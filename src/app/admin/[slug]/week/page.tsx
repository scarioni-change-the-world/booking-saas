'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { DateTime } from 'luxon';
import { PageHeader } from '@/components/ui';
import { adminFetchJson } from '@/lib/admin-fetch';
import DaySchedule from '@/components/admin/DaySchedule';
import { BookingList } from '@/components/admin/BookingList';
import { ReconsideredMark } from '@/components/admin/ReconsideredMark';
import { ServiceBadge } from '@/components/admin/ServiceBadge';
import { BookingRules } from '@/components/admin/BookingRules';
import { CalendarConnection } from '@/components/admin/CalendarConnection';
import { TimeOffPanel, TimeOffPlate } from '@/components/admin/TimeOff';
import { useServiceMark } from '@/components/admin/ServiceMarks';
import { formatMoney } from '@/lib/money';
import {
  emailBadge,
  formatRange,
  paymentLabel,
  syncBadge,
  toneStyle,
  useBookingActions,
  type Booking,
} from '@/components/admin/bookings-shared';
import { minutesToTimeLabel } from '@/lib/blocked-slots';
import {
  coveredMinutes,
  mondayOf,
  placeBooking,
  shiftWeek,
  visibleRange,
  weekDates,
  type Window,
} from '@/lib/week';

/**
 * The Week: a business's hours and its bookings in one picture.
 *
 * It replaces two screens that were about the same seven days. Availability
 * said when you were open; Bookings said what was in it; neither could show
 * that Thursday afternoon is full and Friday is empty, which is the thing a
 * business actually wants to know when it looks at its week.
 *
 * Layers, bottom to top: closed time, open hours, blocked stretches, and the
 * bookings themselves. Choosing a booking or a day opens it beside the grid
 * rather than on another screen.
 *
 * The usual week is the business's opening hours, set in Your business.
 * This page holds only the exceptions: a single date (closing it, special
 * hours, blocking an hour) in the day's own panel, and time off.
 */

interface DayData {
  date: string;
  weekday: number;
  windows: Window[];
  override: {
    id: string;
    date: string;
    isClosed: boolean;
    startTime: string | null;
    endTime: string | null;
    note: string | null;
  } | null;
  blocks: Array<{ id: string; startMinutes: number; endMinutes: number; reason: string | null }>;
}

interface WeekPayload {
  timezone: string;
  monday: string;
  rules: Array<{ id: string; weekday: number; startTime: string; endTime: string }>;
  days: DayData[];
}

interface Owed {
  clientName: string;
  email: string;
  serviceName: string;
  remaining: number;
}

type Selection = { kind: 'booking'; id: string } | { kind: 'day'; date: string } | { kind: 'time-off' } | null;

const HOUR_PX = 46;
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export default function WeekPage() {
  const { slug } = useParams<{ slug: string }>();
  const search = useSearchParams();

  /* Seeded once from the address, like the other screens: an old link to
     Bookings arrives here with ?view=list and lands on the list. */
  const [view, setView] = useState<'week' | 'list'>(search.get('view') === 'list' ? 'list' : 'week');
  /* On a phone the grid shows three days of seven and scrolls sideways,
     while the list answers "what's next?" at once — so a phone opens on
     the list, unless a link asked for a particular view or week. Once, on
     arrival: switching back to Week afterwards stays switched. */
  useEffect(() => {
    if (search.get('view') || search.get('from')) return;
    if (window.matchMedia('(max-width: 760px)').matches) setView('list');
  }, []);
  /* Google and Microsoft send people back here after connecting. Success needs no note —
     the connection's own badge says so, and a note could contradict it —
     but a failure would otherwise leave no trace. */
  const [calendarNotice] = useState<{ ok: boolean; text: string } | null>(() =>
    search.get('calendar') === 'error'
      ? { ok: false, text: 'Your calendar could not be connected. Try again.' }
      : null,
  );
  /* ?from= opens a given week — People links each appointment to its own. */
  const [monday, setMonday] = useState(() => {
    const from = search.get('from');
    const asked = from && /^\d{4}-\d{2}-\d{2}$/.test(from) && DateTime.fromISO(from).isValid ? from : null;
    return mondayOf(asked ?? DateTime.now().toFormat('yyyy-MM-dd'));
  });

  const [week, setWeek] = useState<WeekPayload | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [owed, setOwed] = useState<Owed[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);

  const [timeOffVersion, setTimeOffVersion] = useState(0);

  const load = useCallback(async () => {
    setError(null);
    try {
      /* Bookings are asked for with a day's margin either side and then
         kept only if they fall on this week's dates in the business's own
         zone — the zone is not known until the week arrives, and asking in
         parallel beats asking twice in a row. */
      const from = DateTime.fromISO(monday).minus({ days: 1 }).toISO()!;
      const to = DateTime.fromISO(monday).plus({ days: 8 }).toISO()!;
      const [w, b, c] = await Promise.all([
        adminFetchJson<WeekPayload>(`/api/admin/${slug}/week?from=${monday}`),
        adminFetchJson<{ bookings: Booking[] }>(
          `/api/admin/${slug}/bookings?view=range&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        ),
        adminFetchJson<{
          clients: Array<{
            name: string;
            email: string;
            entitlements: Array<{ eventTypeName: string; remaining: number }>;
          }>;
        }>(`/api/admin/${slug}/clients`).catch(() => ({ clients: [] })),
      ]);
      const dates = new Set(w.days.map((d) => d.date));
      setWeek(w);
      setBookings(
        b.bookings.filter((bk) => dates.has(placeBooking(bk.startsAt, bk.endsAt, w.timezone).date)),
      );
      setOwed(
        c.clients.flatMap((client) =>
          client.entitlements
            .filter((e) => e.remaining > 0)
            .map((e) => ({
              clientName: client.name,
              email: client.email,
              serviceName: e.eventTypeName,
              remaining: e.remaining,
            })),
        ),
      );
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }, [slug, monday]);

  useEffect(() => {
    if (view === 'week') void load();
  }, [load, view]);

  const dates = useMemo(() => weekDates(monday), [monday]);
  const tz = week?.timezone ?? 'UTC';
  const today = DateTime.now().setZone(tz).toFormat('yyyy-MM-dd');

  const placements = useMemo(
    () =>
      bookings.map((b) => ({ booking: b, ...placeBooking(b.startsAt, b.endsAt, tz) })),
    [bookings, tz],
  );

  /* What the grid shows: the hours anything happens in this week. */
  const range = useMemo(() => {
    const everything: Window[] = [
      ...(week?.days.flatMap((d) => [...d.windows, ...d.blocks]) ?? []),
      ...placements.map((p) => ({ startMinutes: p.startMinutes, endMinutes: p.endMinutes })),
    ];
    return visibleRange(everything);
  }, [week, placements]);


  const selectedBooking =
    selection?.kind === 'booking' ? bookings.find((b) => b.id === selection.id) ?? null : null;

  const weekLabel = `${DateTime.fromISO(dates[0]!).toFormat('d LLLL')} – ${DateTime.fromISO(
    dates[6]!,
  ).toFormat('d LLLL')}`;

  return (
    <>
      <PageHeader
        title={view === 'week' ? `Week of ${DateTime.fromISO(monday).toFormat('d LLLL')}` : 'Every booking'}
        description={
          view === 'week'
            ? 'Your hours and what is booked in them. Choose a booking or a day to open it here.'
            : 'The same bookings as a list — upcoming, past, or cancelled.'
        }
        actions={
          <div className="wk-view-switch" role="group" aria-label="Show as">
            <button
              type="button"
              className="filter-chip"
              aria-pressed={view === 'week'}
              onClick={() => setView('week')}
            >
              Week
            </button>
            <button
              type="button"
              className="filter-chip"
              aria-pressed={view === 'list'}
              onClick={() => setView('list')}
            >
              List
            </button>
          </div>
        }
      />

      {view === 'list' && <BookingList slug={slug} />}

      {view === 'week' && (
        <>
          {error && (
            <div className="notice notice-error" role="alert">
              {error}
            </div>
          )}

          <div className="wk-toolbar">
            <div className="wk-nav">
              <button
                type="button"
                className="btn-secondary"
                aria-label="Previous week"
                onClick={() => {
                  setSelection(null);
                  setMonday(shiftWeek(monday, -1));
                }}
              >
                ‹
              </button>
              <span className="wk-range">{weekLabel}</span>
              <button
                type="button"
                className="btn-secondary"
                aria-label="Next week"
                onClick={() => {
                  setSelection(null);
                  setMonday(shiftWeek(monday, 1));
                }}
              >
                ›
              </button>
              {!dates.includes(today) && (
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => setMonday(mondayOf(today))}
                >
                  This week
                </button>
              )}
            </div>

            {/* Your usual week is the business's opening hours, set in Your
                business; this calendar holds only the exceptions. */}
            <a className="btn-link wk-hours-link" href={`/admin/${slug}/account#opening-hours`}>
              Opening hours
            </a>

            <button
              type="button"
              className={`btn-secondary${selection?.kind === 'time-off' ? ' is-selected' : ''}`}
              disabled={!week}
              onClick={() => setSelection({ kind: 'time-off' })}
            >
              Time off
            </button>

            <div className="wk-legend" aria-hidden="true">
              <span><i className="wk-lg-open" />Open</span>
              <span><i className="wk-lg-closed" />Closed</span>
              <span><i className="wk-lg-blocked" />Blocked</span>
              {/* Each service in its own colour, so a week of bookings says
                  what each one is before any of them is opened. Only the
                  services with something booked this week. */}
              {[...new Set(bookings.map((b) => b.eventTypeName))].map((name) => (
                <span key={name} className="wk-lg-service">
                  <ServiceBadge name={name} size="sm" />
                  {name}
                </span>
              ))}
              <span className="wk-tz">Times in {tz.replace(/_/g, ' ')}</span>
            </div>
          </div>

          {loading && !week && <p className="status">Loading…</p>}

          {week && (
            <div className="wk-layout">
              <div className="wk-grid-wrap">
                <WeekGrid
                  week={week}
                  dates={dates}
                  today={today}
                  tz={tz}
                  range={range}
                  placements={placements}
                  selection={selection}
                  onSelect={setSelection}
                />
              </div>

              <aside
                className={`wk-side${!selectedBooking && selection?.kind !== 'day' && selection?.kind !== 'time-off' ? ' is-plates' : ''}`}
                aria-live="polite"
              >
                {selectedBooking ? (
                  <BookingPanel
                    slug={slug}
                    booking={selectedBooking}
                    onClose={() => setSelection(null)}
                    onChanged={load}
                  />
                ) : selection?.kind === 'time-off' ? (
                  <TimeOffPanel
                    slug={slug}
                    timezone={week.timezone}
                    onClose={() => setSelection(null)}
                    onChanged={() => {
                      setTimeOffVersion((v) => v + 1);
                      void load();
                    }}
                  />
                ) : selection?.kind === 'day' ? (
                  <div>
                    <div className="wk-side-head">
                      <h3>{DateTime.fromISO(selection.date).toFormat('cccc d LLLL')}</h3>
                      <button type="button" className="btn-link" onClick={() => setSelection(null)}>
                        Close
                      </button>
                    </div>
                    <p className="wk-side-lead">
                      Changes here are for this date only. Your usual hours stay as they are.
                    </p>
                    <DaySchedule
                      slug={slug}
                      rules={week.rules}
                      date={selection.date}
                      compact
                      onChanged={() => void load()}
                    />
                  </div>
                ) : (
                  <>
                    <section className="wk-plate">
                      <WeekSummary
                        slug={slug}
                        week={week}
                        bookings={bookings.length}
                        bookedMinutes={placements.reduce((sum, p) => sum + (p.endMinutes - p.startMinutes), 0)}
                        owed={owed}
                      />
                    </section>
                    <section className="wk-plate wk-rules">
                      <TimeOffPlate
                        slug={slug}
                        version={timeOffVersion}
                        onOpen={() => setSelection({ kind: 'time-off' })}
                      />
                    </section>
                    {/* The rules and the calendar that narrow these hours,
                        beside them — they lived in Settings, a page away. */}
                    <section className="wk-plate wk-rules">
                      <p className="wk-side-eyebrow">Notice people must give</p>
                      <BookingRules slug={slug} />
                    </section>
                    <section className="wk-plate wk-rules" id="calendar">
                      <p className="wk-side-eyebrow">Your calendar</p>
                      {calendarNotice && (
                        <p className={`notice ${calendarNotice.ok ? 'notice-muted' : 'notice-error'}`} role="status">
                          {calendarNotice.text}
                        </p>
                      )}
                      <CalendarConnection slug={slug} />
                    </section>
                  </>
                )}
              </aside>
            </div>
          )}
        </>
      )}
    </>
  );
}

/* ── The grid ─────────────────────────────────────────────────────────── */

function WeekGrid({
  week,
  dates,
  today,
  tz,
  range,
  placements,
  selection,
  onSelect,
}: {
  week: WeekPayload;
  dates: string[];
  today: string;
  tz: string;
  range: Window;
  placements: Array<{ booking: Booking; date: string; startMinutes: number; endMinutes: number }>;
  selection: Selection;
  onSelect: (s: Selection) => void;
}) {
  const height = ((range.endMinutes - range.startMinutes) / 60) * HOUR_PX;
  const y = (m: number) => ((m - range.startMinutes) / 60) * HOUR_PX;

  const hours: number[] = [];
  for (let m = range.startMinutes; m <= range.endMinutes; m += 60) hours.push(m);

  const now = DateTime.now().setZone(tz);
  const nowMinutes = now.hour * 60 + now.minute;

  const mark = useServiceMark();

  return (
    <div className="wk-grid">
      <div className="wk-corner" />
      {dates.map((date, i) => {
        const day = week.days[i]!;
        const isSelected = selection?.kind === 'day' && selection.date === date;
        return (
          <button
            key={date}
            type="button"
            className={`wk-dayhead${date === today ? ' is-today' : ''}${isSelected ? ' is-selected' : ''}`}
            onClick={() => onSelect({ kind: 'day', date })}
            aria-label={`${WEEKDAY_NAMES[i]} ${DateTime.fromISO(date).toFormat('d LLLL')}, open this day`}
          >
            <span className="wk-dow">{WEEKDAY_NAMES[i]!.slice(0, 3)}</span>
            <span className="wk-dnum">{DateTime.fromISO(date).day}</span>
            {day.override && (
              <span className="wk-exception">{day.override.isClosed ? 'Closed' : 'Own hours'}</span>
            )}
          </button>
        );
      })}

      <div className="wk-gutter" style={{ height }}>
        {hours.map((m) => (
          <span key={m} className="wk-hour" style={{ top: y(m) }}>
            {minutesToTimeLabel(m)}
          </span>
        ))}
      </div>

      {dates.map((date, i) => {
        const day = week.days[i]!;
        const past = date < today;
        return (
          <div
            key={date}
            className={`wk-col${past ? ' is-past' : ''}${date === today ? ' is-today' : ''}`}
            style={{ height }}
          >
            {hours.map((m) => (
              <span key={m} className="wk-line" style={{ top: y(m) }} aria-hidden="true" />
            ))}

            {day.windows.map((w, k) => (
                <span
                  key={k}
                  className="wk-open"
                  style={{ top: y(w.startMinutes), height: y(w.endMinutes) - y(w.startMinutes) }}
                  aria-hidden="true"
                />
              ))}

            {day.blocks.map((b) => (
                <span
                  key={b.id}
                  className="wk-blocked"
                  style={{ top: y(b.startMinutes), height: Math.max(8, y(b.endMinutes) - y(b.startMinutes)) }}
                  title={b.reason ? `Blocked: ${b.reason}` : 'Blocked'}
                />
              ))}

            {placements
              .filter((p) => p.date === date)
              .map((p) => {
                const b = p.booking;
                const top = y(Math.max(p.startMinutes, range.startMinutes));
                const h = Math.max(24, y(Math.min(p.endMinutes, range.endMinutes)) - top);
                const selected = selection?.kind === 'booking' && selection.id === b.id;
                const trouble = b.emailStatus === 'failed' || b.syncStatus === 'failed';
                return (
                  <button
                    key={b.id}
                    type="button"
                    className={`wk-booking${b.pack ? ' is-programme' : ''}${selected ? ' is-selected' : ''}${
                      trouble ? ' has-trouble' : ''
                    }`}
                    style={{ top, height: h }}
                    onClick={() => onSelect({ kind: 'booking', id: b.id })}
                    aria-label={`${b.name}, ${b.eventTypeName}, ${minutesToTimeLabel(p.startMinutes)}`}
                  >
                    <span className="wk-b-name">
                      <span className="wk-b-mark" aria-hidden="true">
                        {mark(b.eventTypeName)}
                      </span>
                      {b.name}
                    </span>
                    {h >= 40 && (
                      <span className="wk-b-meta">
                        {minutesToTimeLabel(p.startMinutes)} · {b.eventTypeName}
                        {b.pack ? ` · ${b.pack.booked}/${b.pack.size}` : ''}
                      </span>
                    )}
                  </button>
                );
              })}

            {date === today && nowMinutes >= range.startMinutes && nowMinutes <= range.endMinutes && (
              <span className="wk-now" style={{ top: y(nowMinutes) }} aria-hidden="true" />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Beside the grid ──────────────────────────────────────────────────── */

function WeekSummary({
  slug,
  week,
  bookings,
  bookedMinutes,
  owed,
}: {
  slug: string;
  week: WeekPayload;
  bookings: number;
  bookedMinutes: number;
  owed: Owed[];
}) {
  const openMinutes = week.days.reduce((sum, d) => sum + coveredMinutes(d.windows), 0);
  const blocked = week.days.reduce((sum, d) => sum + d.blocks.length, 0);
  const exceptions = week.days.filter((d) => d.override).length;
  const tenth = (minutes: number) => Math.round((minutes / 60) * 10) / 10;
  const hours = tenth(openMinutes);
  const booked = tenth(bookedMinutes);
  const also = [
    `${bookings} ${bookings === 1 ? 'appointment' : 'appointments'}`,
    blocked > 0 ? `${blocked} blocked` : null,
    exceptions > 0 ? `${exceptions} ${exceptions === 1 ? 'date' : 'dates'} with its own hours` : null,
  ].filter(Boolean);

  return (
    <div>
      <p className="wk-side-eyebrow">This week</p>
      {/* How full the week is: the same thin bar a question's replay uses.
          Bookings outside the usual hours can fill it; it stops at full. */}
      {openMinutes > 0 && (
        <div className="rp-bar wk-bar" role="img" aria-label={`${booked} of ${hours} open hours booked`}>
          <i style={{ width: `${Math.min(100, (bookedMinutes / openMinutes) * 100)}%` }} />
        </div>
      )}
      <p className="wk-reading">
        {booked} h <span>booked of {hours} h open</span>
      </p>
      <p className="wk-reading-sub">{also.join(' · ')}</p>
      {openMinutes === 0 && (
        <p className="wk-warning">
          No hours are open this week, so your booking page offers nothing.{' '}
          <a href={`/admin/${slug}/account#opening-hours`}>Set your opening hours in Your business</a>.
        </p>
      )}
      {/* Somebody owed a session has no time on the grid to point at, so
          they are named here instead — quietly, in the side panel, not as
          a banner across the top of the page. */}
      {owed.length > 0 && (
        <div className="wk-owed-list">
          <p className="wk-side-lead" style={{ marginBottom: 6 }}>
            {owed.length === 1 ? '1 client is' : `${owed.length} clients are`} owed a session with no
            time booked yet.
          </p>
          <ul>
            {owed.map((o, i) => (
              <li key={i}>
                <span>
                  {o.clientName} · {o.serviceName}
                </span>
                <a href={`/admin/${slug}/people?person=${encodeURIComponent(o.email)}`}>
                  {o.remaining === 1 ? '1 left' : `${o.remaining} left`}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="wk-side-hint">Choose a booking to see it, or a day to close it, give it its own hours, or block time.</p>
    </div>
  );
}



function BookingPanel({
  slug,
  booking: b,
  onClose,
  onChanged,
}: {
  slug: string;
  booking: Booking;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const actions = useBookingActions(slug, onChanged);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const sync = syncBadge(b.syncStatus);
  const email = emailBadge(b.emailStatus);
  const busy = actions.busyId === b.id;

  useEffect(() => {
    setCancelling(false);
    setReason('');
  }, [b.id]);

  return (
    <div>
      <div className="wk-side-head">
        <h3>{b.name}</h3>
        <button type="button" className="btn-link" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="wk-side-lead">
        <span className="svc-line">
          <ServiceBadge name={b.eventTypeName} size="sm" />
          <span>
            {b.eventTypeName} · {formatRange(b.startsAt, b.endsAt)}
          </span>
        </span>
        <span className="wk-muted">{b.email}</span>
      </p>

      <div className="wk-marks">
        {b.pack && (
          <span className="programme-mark">
            Programme · {b.pack.booked} of {b.pack.size}
            {b.pack.remaining > 0 && <strong> · {b.pack.remaining} still to book</strong>}
          </span>
        )}
        {b.pack?.priorSessionsOwed ? (
          <span className="owed-mark">
            {b.pack.priorSessionsOwed === 1
              ? 'Booked while 1 session was still owed'
              : `Booked while ${b.pack.priorSessionsOwed} sessions were still owed`}
          </span>
        ) : null}
        {b.payment && (
          <span className="notice" style={{ padding: '3px 10px', margin: 0, ...toneStyle('muted') }}>
            {paymentLabel(b.payment)}
          </span>
        )}
        {sync && (
          <span className="notice" style={{ padding: '3px 10px', margin: 0, ...toneStyle(sync.tone) }}>
            {sync.label}
          </span>
        )}
        {email && (
          <span
            className="notice"
            style={{ padding: '3px 10px', margin: 0, ...toneStyle(email.tone) }}
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
            style={{ padding: '3px 10px', margin: 0, ...toneStyle('live') }}
          >
            Video link
          </a>
        )}
      </div>

      {b.reconsidered && <ReconsideredMark reconsidered={b.reconsidered} />}

      {new Date(b.startsAt).getTime() < Date.now() && (
        <Attendance slug={slug} booking={b} onChanged={onChanged} />
      )}
      {b.rating && (
        <p className="wk-rating">
          <span aria-label={`Rated ${b.rating.rating} out of 5`}>
            {'★'.repeat(b.rating.rating)}
            <span className="wk-rating-off">{'★'.repeat(5 - b.rating.rating)}</span>
          </span>
          {b.rating.comment ? <span className="wk-note"> “{b.rating.comment}”</span> : null}
        </p>
      )}

      {b.notes && <p className="wk-note">“{b.notes}”</p>}

      {b.qualification && b.qualification.answers.length > 0 && (
        <div className="wk-answers">
          <p className="wk-side-eyebrow">What they answered</p>
          {b.qualification.answers.map((a) => (
            <div key={a.questionId} className="answer-pair">
              <p className="answer-pair-question">{a.prompt}</p>
              <p className="answer-pair-answer">{a.answer}</p>
              {a.outcomePathType === 'other' && <p className="answer-pair-path">Led to another next step</p>}
            </div>
          ))}
        </div>
      )}

      {actions.error && (
        <p className="notice notice-error" role="alert">
          {actions.error}
        </p>
      )}
      {actions.notice && (
        <p className="notice notice-muted" role="status">
          {actions.notice}
        </p>
      )}

      {cancelling ? (
        /* Asked here rather than in a browser dialog: the question belongs
           beside the booking it is about. */
        <div className="wk-cancel">
          <label htmlFor="wk-cancel-reason">A note for your own records (optional)</label>
          <textarea
            id="wk-cancel-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <p className="wk-side-hint">
            {b.name} is emailed that it is cancelled
            {b.pack ? ', with a way to book the session again' : ''}.
            {b.payment && b.payment.status === 'paid' && b.payment.refundedMinor < b.payment.amountMinor
              ? b.pack
                ? ' The programme’s payment is not refunded — the session goes back to them to book.'
                : ` Their ${formatMoney(b.payment.amountMinor - b.payment.refundedMinor, b.payment.currency)} is refunded through your Stripe account.`
              : ''}
          </p>
          <div className="wk-actions">
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => void actions.cancel(b, reason)}
            >
              {busy ? 'Cancelling…' : 'Cancel this booking'}
            </button>
            <button type="button" className="btn-link" disabled={busy} onClick={() => setCancelling(false)}>
              Keep it
            </button>
          </div>
        </div>
      ) : (
        <div className="wk-actions">
          {b.emailStatus === 'failed' && (
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => void actions.retryEmail(b)}
            >
              {busy ? 'Sending…' : 'Send the email again'}
            </button>
          )}
          {/* Everyone who books gets their own link, so this only shows
              where that did not happen: a booking from before, or a record
              that could not be made at the time. A repair, not a step. */}
          {!b.isClient && (
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => void actions.addAsClient(b)}
            >
              Give them their own link
            </button>
          )}
          <a className="btn-link" href={`/admin/${slug}/people?person=${encodeURIComponent(b.email)}`}>
            See {b.name} in People
          </a>
          <button type="button" className="btn-link" onClick={() => setCancelling(true)}>
            Cancel booking
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Did they come? Asked on every appointment once it has started, answered
 * with one tap. It feeds Reports (no-shows by service and by time), and a
 * no-show is not asked to rate a session they did not have.
 */
function Attendance({
  slug,
  booking,
  onChanged,
}: {
  slug: string;
  booking: Booking;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = booking.attendance ?? null;

  async function mark(value: 'attended' | 'no_show') {
    setBusy(true);
    setError(null);
    try {
      await adminFetchJson(`/api/admin/${slug}/bookings/${booking.id}/attendance`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ attendance: current === value ? null : value }),
      });
      await onChanged();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wk-attend">
      <p className="wk-side-eyebrow">Did they come?</p>
      <div className="wk-mode wk-attend-keys" role="group" aria-label="Did they come?">
        <button
          type="button"
          className="filter-chip"
          aria-pressed={current === 'attended'}
          disabled={busy}
          onClick={() => void mark('attended')}
        >
          Came
        </button>
        <button
          type="button"
          className="filter-chip"
          aria-pressed={current === 'no_show'}
          disabled={busy}
          onClick={() => void mark('no_show')}
        >
          Didn’t come
        </button>
      </div>
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
