'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { Gauge } from '@/components/admin/Instruments';
import { monogram } from '@/lib/service-identity';
import {
  emailBadge,
  formatRange,
  syncBadge,
  toneStyle,
  useBookingActions,
  type Booking,
} from '@/components/admin/bookings-shared';
import { minutesToTimeLabel } from '@/lib/blocked-slots';
import {
  CELL_MINUTES,
  cellsToWindows,
  coveredMinutes,
  mondayOf,
  placeBooking,
  rulesToCells,
  shiftWeek,
  visibleRange,
  weekDates,
  wouldShift,
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
 * Painting changes the USUAL week — the hours that repeat. One-off changes
 * to a single date (closing it, special hours, blocking an hour) stay where
 * they were, in the day's own panel, because "every Tuesday" and "this
 * Tuesday" are different decisions and one gesture should not make both.
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

type Selection = { kind: 'booking'; id: string } | { kind: 'day'; date: string } | null;

const HOUR_PX = 46;
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export default function WeekPage() {
  const { slug } = useParams<{ slug: string }>();
  const search = useSearchParams();

  /* Seeded once from the address, like the other screens: an old link to
     Bookings arrives here with ?view=list and lands on the list. */
  const [view, setView] = useState<'week' | 'list'>(search.get('view') === 'list' ? 'list' : 'week');
  /* Google sends people back here after connecting. Success needs no note —
     the connection's own badge says so, and a note could contradict it —
     but a failure would otherwise leave no trace. */
  const [calendarNotice] = useState<{ ok: boolean; text: string } | null>(() =>
    search.get('calendar') === 'error'
      ? { ok: false, text: 'Google Calendar could not be connected. Try again.' }
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

  const [painting, setPainting] = useState(false);
  const [draft, setDraft] = useState<Record<number, boolean[]> | null>(null);
  const [saving, setSaving] = useState(false);

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

  /* What the grid shows. Wider while painting, so hours outside the usual
     working day — a 07:00 start, a Thursday evening — can be painted at all. */
  const lookRange = useMemo(() => {
    const everything: Window[] = [
      ...(week?.days.flatMap((d) => [...d.windows, ...d.blocks]) ?? []),
      ...placements.map((p) => ({ startMinutes: p.startMinutes, endMinutes: p.endMinutes })),
    ];
    return visibleRange(everything);
  }, [week, placements]);

  const paintRange = useMemo(
    () => ({
      startMinutes: Math.min(6 * 60, lookRange.startMinutes),
      endMinutes: Math.max(22 * 60, lookRange.endMinutes),
    }),
    [lookRange],
  );

  const range = painting ? paintRange : lookRange;

  const original = useMemo(() => {
    if (!week) return null;
    const cells: Record<number, boolean[]> = {};
    for (let wd = 1; wd <= 7; wd++) cells[wd] = rulesToCells(week.rules, wd, paintRange);
    return cells;
  }, [week, paintRange]);

  const changedWeekdays = useMemo(() => {
    if (!draft || !original) return [];
    return [1, 2, 3, 4, 5, 6, 7].filter(
      (wd) => draft[wd]!.some((on, i) => on !== original[wd]![i]),
    );
  }, [draft, original]);

  function startPainting() {
    if (!original) return;
    setDraft(Object.fromEntries(Object.entries(original).map(([k, v]) => [k, [...v]])));
    setPainting(true);
    setSelection(null);
  }

  function stopPainting() {
    setPainting(false);
    setDraft(null);
  }

  async function saveHours() {
    if (!draft || changedWeekdays.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      await adminFetchJson(`/api/admin/${slug}/availability-rules`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          days: changedWeekdays.map((wd) => ({
            weekday: wd,
            windows: cellsToWindows(draft[wd]!, paintRange),
          })),
        }),
      });
      stopPainting();
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const selectedBooking =
    selection?.kind === 'booking' ? bookings.find((b) => b.id === selection.id) ?? null : null;

  const weekLabel = `${DateTime.fromISO(dates[0]!).toFormat('d LLLL')} – ${DateTime.fromISO(
    dates[6]!,
  ).toFormat('d LLLL')}`;

  return (
    <>
      <PageHeader
        eyebrow="Week"
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
              onClick={() => {
                stopPainting();
                setView('list');
              }}
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

          {/* Somebody owed a session has no time on the grid — that is
              the whole problem — so they are said above it instead. */}
          {owed.length > 0 && !painting && (
            <div className="wk-owed">
              <span className="wk-owed-label">Still to book</span>
              {owed.map((o, i) => (
                <span key={i} className="wk-owed-item">
                  <a href={`/admin/${slug}/people?person=${encodeURIComponent(o.email)}`}>{o.clientName}</a> ·{' '}
                  {o.serviceName} · {o.remaining}
                </span>
              ))}
            </div>
          )}

          <div className="wk-toolbar">
            <div className="wk-nav">
              <button
                type="button"
                className="btn-secondary"
                aria-label="Previous week"
                disabled={painting}
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
                disabled={painting}
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
                  disabled={painting}
                  onClick={() => setMonday(mondayOf(today))}
                >
                  This week
                </button>
              )}
            </div>

            <div className="wk-mode" role="group" aria-label="What dragging does">
              <button
                type="button"
                className="filter-chip"
                aria-pressed={!painting}
                onClick={stopPainting}
              >
                Look
              </button>
              <button
                type="button"
                className="filter-chip"
                aria-pressed={painting}
                disabled={!week}
                onClick={startPainting}
              >
                Paint usual hours
              </button>
            </div>

            <div className="wk-legend" aria-hidden="true">
              <span><i className="wk-lg-open" />Open</span>
              <span><i className="wk-lg-blocked" />Blocked</span>
              {/* Each service in its own colour, so a week of bookings says
                  what each one is before any of them is opened. Only the
                  services with something booked this week. */}
              {[...new Map(bookings.map((b) => [b.eventTypeName, b.eventTypeColor])).entries()].map(([name, color]) => (
                <span key={name} className="wk-lg-service">
                  <ServiceBadge name={name} color={color} size="sm" />
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
                  painting={painting}
                  draft={draft}
                  onDraft={setDraft}
                  selection={selection}
                  onSelect={setSelection}
                />
              </div>

              <aside
                className={`wk-side${!painting && !selectedBooking && selection?.kind !== 'day' ? ' is-plates' : ''}`}
                aria-live="polite"
              >
                {painting && draft && original ? (
                  <PaintPanel
                    changed={changedWeekdays}
                    shifting={changedWeekdays.filter((wd) => wouldShift(week.rules, wd, paintRange))}
                    before={Object.values(original).flat().filter(Boolean).length}
                    after={Object.values(draft).flat().filter(Boolean).length}
                    saving={saving}
                    onSave={saveHours}
                    onDiscard={stopPainting}
                  />
                ) : selectedBooking ? (
                  <BookingPanel
                    slug={slug}
                    booking={selectedBooking}
                    onClose={() => setSelection(null)}
                    onChanged={load}
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
                        week={week}
                        bookings={bookings.length}
                        bookedMinutes={placements.reduce((sum, p) => sum + (p.endMinutes - p.startMinutes), 0)}
                        owed={owed}
                      />
                    </section>
                    {/* The rules and the calendar that narrow these hours,
                        beside them — they lived in Settings, a page away. */}
                    <section className="wk-plate wk-rules">
                      <p className="wk-side-eyebrow">Notice people must give</p>
                      <BookingRules slug={slug} />
                    </section>
                    <section className="wk-plate wk-rules" id="calendar">
                      <p className="wk-side-eyebrow">Google Calendar</p>
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
  painting,
  draft,
  onDraft,
  selection,
  onSelect,
}: {
  week: WeekPayload;
  dates: string[];
  today: string;
  tz: string;
  range: Window;
  placements: Array<{ booking: Booking; date: string; startMinutes: number; endMinutes: number }>;
  painting: boolean;
  draft: Record<number, boolean[]> | null;
  onDraft: (next: Record<number, boolean[]>) => void;
  selection: Selection;
  onSelect: (s: Selection) => void;
}) {
  const height = ((range.endMinutes - range.startMinutes) / 60) * HOUR_PX;
  const y = (m: number) => ((m - range.startMinutes) / 60) * HOUR_PX;

  const hours: number[] = [];
  for (let m = range.startMinutes; m <= range.endMinutes; m += 60) hours.push(m);

  const now = DateTime.now().setZone(tz);
  const nowMinutes = now.hour * 60 + now.minute;

  /* Painting: a drag sets every cell it crosses to the state of the first
     one flipped, so sweeping over a mix of open and closed hours does one
     thing rather than toggling each cell it passes. */
  const dragging = useRef<{ to: boolean } | null>(null);

  function setCell(weekday: number, index: number, to: boolean) {
    if (!draft) return;
    if (draft[weekday]![index] === to) return;
    const next = { ...draft, [weekday]: [...draft[weekday]!] };
    next[weekday]![index] = to;
    onDraft(next);
  }

  function cellFrom(el: Element | null): { wd: number; i: number } | null {
    const cell = el?.closest<HTMLElement>('[data-cell]');
    if (!cell) return null;
    return { wd: Number(cell.dataset.wd), i: Number(cell.dataset.i) };
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!painting || !draft) return;
    const hit = cellFrom(e.target as Element);
    if (!hit) return;
    e.preventDefault();
    const to = !draft[hit.wd]![hit.i];
    dragging.current = { to };
    setCell(hit.wd, hit.i, to);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragging.current) return;
    const hit = cellFrom(document.elementFromPoint(e.clientX, e.clientY));
    if (hit) setCell(hit.wd, hit.i, dragging.current.to);
  }

  useEffect(() => {
    const stop = () => {
      dragging.current = null;
    };
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, []);

  const cellsPerDay = (range.endMinutes - range.startMinutes) / CELL_MINUTES;

  return (
    <div
      className={`wk-grid${painting ? ' is-painting' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
    >
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
            disabled={painting}
            aria-label={`${WEEKDAY_NAMES[i]} ${DateTime.fromISO(date).toFormat('d LLLL')}, open this day`}
          >
            <span className="wk-dow">{WEEKDAY_NAMES[i]!.slice(0, 3)}</span>
            <span className="wk-dnum">{DateTime.fromISO(date).day}</span>
            {day.override && !painting && (
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
        const weekday = i + 1;
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

            {!painting &&
              day.windows.map((w, k) => (
                <span
                  key={k}
                  className="wk-open"
                  style={{ top: y(w.startMinutes), height: y(w.endMinutes) - y(w.startMinutes) }}
                  aria-hidden="true"
                />
              ))}

            {!painting &&
              day.blocks.map((b) => (
                <span
                  key={b.id}
                  className="wk-blocked"
                  style={{ top: y(b.startMinutes), height: Math.max(8, y(b.endMinutes) - y(b.startMinutes)) }}
                  title={b.reason ? `Blocked: ${b.reason}` : 'Blocked'}
                />
              ))}

            {painting &&
              draft &&
              Array.from({ length: cellsPerDay }, (_, k) => {
                const start = range.startMinutes + k * CELL_MINUTES;
                const on = draft[weekday]![k]!;
                return (
                  <button
                    key={k}
                    type="button"
                    data-cell=""
                    data-wd={weekday}
                    data-i={k}
                    className={`wk-cell${on ? ' is-on' : ''}`}
                    style={{ top: y(start), height: (CELL_MINUTES / 60) * HOUR_PX }}
                    aria-pressed={on}
                    aria-label={`${WEEKDAY_NAMES[i]}s ${minutesToTimeLabel(start)}`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setCell(weekday, k, !on);
                      }
                    }}
                  />
                );
              })}

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
                    }${painting ? ' is-ghost' : ''}`}
                    style={{ top, height: h, ['--svc' as string]: b.eventTypeColor }}
                    disabled={painting}
                    onClick={() => onSelect({ kind: 'booking', id: b.id })}
                    aria-label={`${b.name}, ${b.eventTypeName}, ${minutesToTimeLabel(p.startMinutes)}`}
                  >
                    <span className="wk-b-name">
                      <span className="wk-b-mark" aria-hidden="true">
                        {monogram(b.eventTypeName)}
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
  week,
  bookings,
  bookedMinutes,
  owed,
}: {
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
      {/* A needle across the open hours: how full the week is, at a glance.
          Bookings outside the usual hours can carry it past the end. */}
      {openMinutes > 0 && (
        <Gauge
          value={tenth(Math.min(bookedMinutes, openMinutes))}
          max={hours}
          unit="h"
          label={`${booked} of ${hours} open hours booked`}
        />
      )}
      <p className="wk-reading">
        {booked} h <span>booked of {hours} h open</span>
      </p>
      <p className="wk-reading-sub">{also.join(' · ')}</p>
      {openMinutes === 0 && (
        <p className="wk-warning">
          No hours are open this week, so your booking page offers nothing. Choose Paint usual hours
          to set some.
        </p>
      )}
      {owed.length > 0 && (
        <p className="wk-side-lead">
          {owed.length === 1 ? '1 client is' : `${owed.length} clients are`} owed a session with no
          time booked yet.
        </p>
      )}
      <p className="wk-side-hint">Choose a booking to see it, or a day to close it, give it its own hours, or block time.</p>
    </div>
  );
}

function PaintPanel({
  changed,
  shifting,
  before,
  after,
  saving,
  onSave,
  onDiscard,
}: {
  changed: number[];
  shifting: number[];
  before: number;
  after: number;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const names = (wds: number[]) => wds.map((wd) => WEEKDAY_NAMES[wd - 1]).join(', ');
  const hours = (cells: number) => (cells * CELL_MINUTES) / 60;

  return (
    <div>
      <p className="wk-side-eyebrow">Painting your usual week</p>
      <p className="wk-side-lead">
        Drag across the grid to open or close hours. This is the week that repeats; dates with
        their own hours keep them, and anything already booked stays where it is.
      </p>

      {/* The effect, before saving. */}
      <dl className="wk-facts">
        <div>
          <dt>Open each week</dt>
          <dd>
            {hours(before)} h{after !== before && <> → {hours(after)} h</>}
          </dd>
        </div>
      </dl>

      {changed.length === 0 ? (
        <p className="wk-side-hint">Nothing changed yet.</p>
      ) : (
        <p className="wk-side-lead">
          <strong>Changing:</strong> {names(changed)}.
        </p>
      )}

      {shifting.length > 0 && (
        <p className="wk-warning">
          {names(shifting)} had times that are not on the half hour. Saving moves them to the
          half hour inside the hours you had, never outside them.
        </p>
      )}

      <div className="wk-actions">
        <button
          type="button"
          className="btn-primary"
          disabled={saving || changed.length === 0}
          onClick={onSave}
        >
          {saving ? 'Saving…' : 'Save usual hours'}
        </button>
        <button type="button" className="btn-link" disabled={saving} onClick={onDiscard}>
          Discard
        </button>
      </div>
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
          <ServiceBadge name={b.eventTypeName} color={b.eventTypeColor} size="sm" />
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
