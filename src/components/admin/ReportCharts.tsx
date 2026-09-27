'use client';

import { useState } from 'react';
import type { DemandCell, FunnelStep } from '@/lib/reports';
import { weekdayName } from '@/lib/reports';

/**
 * The few charts Reports draws. One series each, so one colour: Mineral for
 * every mark, the way the rest of the app uses it for "where you are". Ochre
 * appears only beside the one place that needs the professional — never as
 * a second series. Values and labels are always text in ink, never the
 * mark's colour; a readout above each chart says what is under the pointer
 * or the keyboard focus, so nothing is hover-only.
 */

/** "Tuesday 18:00 — 2 of 2 open hours booked" — the line that answers the pointer. */
function Readout({ text, idle }: { text: string | null; idle: string }) {
  return (
    <p className="rep-readout" aria-live="polite">
      {text ?? idle}
    </p>
  );
}

/**
 * From visit to booking: one bar per step, all measured against the first,
 * so the drop between steps is the gap you see. The step people leave most
 * at carries an Ochre lamp and says how many.
 */
export function JourneyBars({
  steps,
  worst,
}: {
  steps: FunnelStep[];
  worst: { to: FunnelStep['id']; lost: number; share: number } | null;
}) {
  const top = Math.max(1, ...steps.map((s) => s.count));
  return (
    <ol className="rep-journey">
      {steps.map((s, i) => {
        const prev = steps[i - 1];
        const share = prev && prev.count > 0 ? s.count / prev.count : null;
        const isWorst = worst?.to === s.id;
        return (
          <li key={s.id} className={isWorst ? 'is-need' : undefined}>
            <span className="rep-journey-label">{s.label}</span>
            <span className="rep-track" aria-hidden="true">
              <span
                className="rep-bar"
                style={{ width: `${Math.max(s.count > 0 ? 1.5 : 0, (s.count / top) * 100)}%` }}
              />
            </span>
            <span className="rep-journey-value">
              <b>{s.count.toLocaleString()}</b>
              {share !== null && <small> · {Math.round(share * 100)}% of the step before</small>}
            </span>
            {isWorst && (
              <span className="rep-journey-note">
                <span className="lamp is-need" aria-hidden="true" />
                {worst.lost.toLocaleString()} left here — the biggest drop
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Open hours against booked hours, weekday by hour, over the whole period.
 * A cell is filled in proportion to how much of its open time was taken —
 * one hue, light to dark. Closed hours stay the page colour. Fully booked
 * cells are the darkest step.
 */
export function WeekHeat({ cells, hours }: { cells: DemandCell[]; hours: number[] }) {
  const [tip, setTip] = useState<string | null>(null);
  const byKey = new Map(cells.map((c) => [`${c.weekday}:${c.hour}`, c]));
  const step = (c: DemandCell | undefined) => {
    if (!c || c.openMinutes === 0) return c && c.bookedMinutes > 0 ? 4 : -1;
    const fill = c.bookedMinutes / c.openMinutes;
    if (fill === 0) return 0;
    if (fill < 0.25) return 1;
    if (fill < 0.5) return 2;
    if (fill < 0.75) return 3;
    return 4;
  };
  const say = (weekday: number, hour: number, c: DemandCell | undefined) => {
    const when = `${weekdayName(weekday)} ${String(hour).padStart(2, '0')}:00`;
    if (!c || (c.openMinutes === 0 && c.bookedMinutes === 0)) return `${when} — closed`;
    const open = Math.round((c.openMinutes / 60) * 10) / 10;
    const booked = Math.round((c.bookedMinutes / 60) * 10) / 10;
    if (c.openMinutes === 0) return `${when} — ${booked} h booked outside your usual hours`;
    return `${when} — ${booked} of ${open} open hours booked (${Math.round((c.bookedMinutes / c.openMinutes) * 100)}%)`;
  };

  if (hours.length === 0) return <p className="wk-side-hint">No open hours in this period.</p>;

  return (
    <div className="rep-heat-wrap">
      <Readout text={tip} idle="Point at an hour to see how full it was." />
      <div
        className="rep-heat"
        style={{ gridTemplateColumns: `44px repeat(${hours.length}, minmax(18px, 1fr))` }}
      >
        <span />
        {hours.map((h) => (
          <span key={h} className="rep-heat-hour" aria-hidden="true">
            {h % 2 === 0 || hours.length <= 12 ? String(h).padStart(2, '0') : ''}
          </span>
        ))}
        {[1, 2, 3, 4, 5, 6, 7].map((wd) => (
          <div key={wd} className="rep-heat-row" style={{ display: 'contents' }}>
            <span className="rep-heat-day">{weekdayName(wd).slice(0, 3)}</span>
            {hours.map((h) => {
              const c = byKey.get(`${wd}:${h}`);
              const text = say(wd, h, c);
              return (
                <span
                  key={h}
                  className={`rep-heat-cell s${step(c)}`}
                  tabIndex={0}
                  aria-label={text}
                  onMouseEnter={() => setTip(text)}
                  onFocus={() => setTip(text)}
                  onMouseLeave={() => setTip(null)}
                  onBlur={() => setTip(null)}
                />
              );
            })}
          </div>
        ))}
      </div>
      <p className="rep-scale" aria-hidden="true">
        <span className="rep-heat-cell s-1" /> Closed <span className="rep-heat-cell s0" /> Open, none booked
        <span className="rep-heat-cell s2" /> Partly <span className="rep-heat-cell s4" /> Full
      </p>
      {/* The same figures as a table, for a screen reader and for anyone who wants the numbers. */}
      <table className="sr-only">
        <caption>Booked and open hours by day and hour</caption>
        <thead>
          <tr>
            <th>When</th>
            <th>Open hours</th>
            <th>Booked hours</th>
          </tr>
        </thead>
        <tbody>
          {cells.map((c) => (
            <tr key={`${c.weekday}:${c.hour}`}>
              <td>
                {weekdayName(c.weekday)} {String(c.hour).padStart(2, '0')}:00
              </td>
              <td>{Math.round(c.openMinutes / 6) / 10}</td>
              <td>{Math.round(c.bookedMinutes / 6) / 10}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Horizontal bars for a short list of named amounts — how far ahead people
 * book, ratings one to five, earnings by service. One colour; the value at
 * the tip in ink.
 */
export function Bars({
  rows,
  format = (n) => n.toLocaleString(),
  label,
}: {
  rows: Array<{ key: string; label: string; value: number }>;
  format?: (n: number) => string;
  label: string;
}) {
  const top = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="rep-bars" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key}>
          <span className="rep-bars-label">{r.label}</span>
          <span className="rep-track" aria-hidden="true">
            <span
              className="rep-bar"
              style={{ width: `${r.value > 0 ? Math.max(1.5, (r.value / top) * 100) : 0}%` }}
            />
          </span>
          <span className="rep-bars-value">{format(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}
