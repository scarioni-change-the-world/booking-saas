'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminFetchJson } from '@/lib/admin-fetch';
import { SignupFunnel } from '@/components/console/SignupFunnel';
import type { ConsoleOverview, OverviewUnit } from '@/lib/console-overview';

const UNITS: Array<{ id: OverviewUnit; label: string }> = [
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'quarter', label: 'Quarter' },
  { id: 'year', label: 'Year' },
];

const AI_LABEL: Record<string, string> = {
  intake_draft: 'Questions drafted',
  report_summary: 'Report summaries',
  site_draft: 'Websites read',
  assistant: 'Ask khloe questions',
};

const euros = (minor: number) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR', maximumFractionDigits: minor % 100 ? 2 : 0 }).format(
    minor / 100,
  );
const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' });
const monthName = (ym: string) => monthFormat.format(new Date(`${ym}-01T00:00:00Z`));

/** "+4", "−2", "same": the change against the period before, or nothing when unknown. */
function change(now: number | null, before: number | null, format: (n: number) => string = String): string | null {
  if (now === null || before === null) return null;
  const d = now - before;
  if (d === 0) return 'same as before';
  return `${d > 0 ? '+' : '−'}${format(Math.abs(d))} on the period before`;
}

/**
 * The owner console's first screen: how the khloe business is doing.
 *
 * Account and billing facts, and totals over every business. The owner's
 * privacy rule: nothing from inside a business shows here, not even per
 * business; see src/lib/console-overview.ts.
 */
export default function ConsoleOverviewPage() {
  const [unit, setUnit] = useState<OverviewUnit>('month');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<ConsoleOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await adminFetchJson<{ overview: ConsoleOverview }>(`/api/console/overview?unit=${unit}&offset=${offset}`);
      setData(r.overview);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, [unit, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  const o = data;
  const needs = o ? o.needs.trialsEnding.length + o.needs.paymentFailed.length : 0;

  return (
    <>
      <div className="admin-page-head">
        <div>
          <div className="admin-eyebrow">Overview</div>
          <h1>How khloe is doing</h1>
        </div>
      </div>

      {/* The same period switch as Reports: a length, and arrows through it. */}
      <div className="co-period">
        <div className="wk-mode" role="group" aria-label="Period">
          {UNITS.map((u) => (
            <button
              key={u.id}
              type="button"
              className="filter-chip"
              aria-pressed={unit === u.id}
              onClick={() => {
                setUnit(u.id);
                setOffset(0);
              }}
            >
              {u.label}
            </button>
          ))}
        </div>
        <div className="co-step">
          <button type="button" className="co-arrow" aria-label="Previous period" onClick={() => setOffset((n) => n + 1)}>
            ←
          </button>
          <span className="co-label">
            {o?.period.label ?? '…'}
            {o?.period.current ? ' · so far' : ''}
          </span>
          <button
            type="button"
            className="co-arrow"
            aria-label="Next period"
            disabled={offset === 0}
            onClick={() => setOffset((n) => Math.max(0, n - 1))}
          >
            →
          </button>
        </div>
      </div>

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}
      {!o && !error && <p className="status">Loading…</p>}

      {o && (
        <div className="co">
          {/* 1. The business, in five lines. */}
          <section className="co-card" aria-labelledby="co-business">
            <h2 id="co-business" className="co-title">
              The business
            </h2>
            <ul className="co-lines">
              <Line
                label="Paying businesses"
                value={o.lines.paying.now === null ? 'Not recorded' : String(o.lines.paying.now)}
                note={change(o.lines.paying.now, o.lines.paying.before)}
              />
              <Line
                label="Monthly revenue"
                value={o.lines.revenue.now === null ? 'Not recorded' : euros(o.lines.revenue.now)}
                note={
                  [
                    o.lines.revenue.founding !== null && o.lines.paying.now
                      ? `${o.lines.paying.now - o.lines.revenue.founding} × €15 · ${o.lines.revenue.founding} × €9 · VAT included`
                      : 'VAT included',
                    change(o.lines.revenue.now, o.lines.revenue.before, euros),
                  ]
                    .filter(Boolean)
                    .join(' · ')
                }
              />
              <Line label="New sign-ups" value={String(o.lines.signups.now)} note={change(o.lines.signups.now, o.lines.signups.before)} />
              <Line
                label="Trials that became paying"
                value={o.lines.trials.ended === 0 ? '—' : `${o.lines.trials.converted} of ${o.lines.trials.ended}`}
                note={
                  o.lines.trials.ended === 0
                    ? 'No trial ended in this period.'
                    : `${Math.round((o.lines.trials.converted / o.lines.trials.ended) * 100)}% of the trials that ended in this period`
                }
              />
              <Line
                label="Lost"
                value={o.lines.lost ? `${o.lines.lost.cancelled + o.lines.lost.deleted}` : 'Not recorded'}
                note={
                  o.lines.lost
                    ? `${o.lines.lost.cancelled} cancelled · ${o.lines.lost.deleted} deleted${o.lines.lost.complete ? '' : ' · counted since billing history started'}`
                    : 'Starts once billing history is on (migration 0040).'
                }
              />
            </ul>
          </section>

          {/* 2. Needs you: only when there is something. Account facts only. */}
          <section className={`co-card${needs ? ' is-need' : ''}`} aria-labelledby="co-needs">
            <h2 id="co-needs" className="co-title">
              Needs you
            </h2>
            {needs === 0 ? (
              <p className="co-calm">Nothing right now.</p>
            ) : (
              <ul className="co-lines">
                {o.needs.paymentFailed.map((t) => (
                  <li key={t.id} className="co-line">
                    <a href={`/console/${t.id}`}>{t.name}</a>
                    <span className="co-need">Payment failed</span>
                  </li>
                ))}
                {o.needs.trialsEnding.map((t) => (
                  <li key={t.id} className="co-line">
                    <a href={`/console/${t.id}`}>{t.name}</a>
                    <span className="co-need">Trial ends {dateFormat.format(new Date(t.endsAt))}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 3. Monthly revenue over time, from billing history. */}
          <section className="co-card co-wide" aria-labelledby="co-revenue">
            <h2 id="co-revenue" className="co-title">
              Monthly revenue
            </h2>
            {o.history.revenue.length === 0 ? (
              <p className="co-calm">
                Recorded from the day billing history is switched on (migration 0040); the trend builds month by month.
              </p>
            ) : (
              <RevenueBars months={o.history.revenue} />
            )}
          </section>

          {/* 4. Of each month's sign-ups, how many pay later. */}
          <section className="co-card co-wide" aria-labelledby="co-cohorts">
            <h2 id="co-cohorts" className="co-title">
              Do they stay?
            </h2>
            <p className="co-sub">Of the businesses that signed up each month, how many are paying 1, 2 and 3 months later.</p>
            <div className="co-table-wrap">
              <table className="co-table">
                <thead>
                  <tr>
                    <th scope="col">Signed up</th>
                    <th scope="col">Businesses</th>
                    <th scope="col">After 1 month</th>
                    <th scope="col">After 2 months</th>
                    <th scope="col">After 3 months</th>
                  </tr>
                </thead>
                <tbody>
                  {o.history.cohorts.map((c) => (
                    <tr key={c.month}>
                      <th scope="row">{monthName(c.month)}</th>
                      <td>{c.signedUp}</td>
                      {c.paying.map((p, i) => (
                        <td key={i} className={p === null || p === 'unknown' ? 'is-empty' : ''}>
                          {p === null ? 'not yet' : p === 'unknown' ? 'not recorded' : `${p} of ${c.signedUp}`}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* 5. How new businesses get started: counts only. */}
          <div className="co-wide co-funnel">
            <SignupFunnel />
          </div>

          {/* 6. Their clients booking: summed over every business. */}
          <section className="co-card" aria-labelledby="co-activity">
            <h2 id="co-activity" className="co-title">
              Bookings on khloe
            </h2>
            <ul className="co-lines">
              <Line
                label="Bookings made"
                value={String(o.activity.bookings)}
                note={change(o.activity.bookings, o.activity.prevBookings)}
              />
              <Line
                label="Businesses with a booking"
                value={`${o.activity.businessesBooked} of ${o.activity.activeBusinesses}`}
                note={change(o.activity.businessesBooked, o.activity.prevBusinessesBooked)}
              />
            </ul>
            <p className="co-sub">Totals over every business. No business is shown on its own.</p>
          </section>

          {/* 7. The founding offer running out. */}
          <section className="co-card" aria-labelledby="co-founding">
            <h2 id="co-founding" className="co-title">
              Founding offer
            </h2>
            <p className="co-big">
              {o.founding.taken} <span>of {o.founding.seats} places taken</span>
            </p>
            <div className="co-meter" aria-hidden="true">
              <i style={{ width: `${Math.min(100, (o.founding.taken / Math.max(1, o.founding.seats)) * 100)}%` }} />
            </div>
          </section>

          {/* 8. What running khloe uses: AI this month, failures. */}
          <section className="co-card co-wide" aria-labelledby="co-costs">
            <h2 id="co-costs" className="co-title">
              Running costs
            </h2>
            <ul className="co-lines co-two">
              {o.costs.ai.map((a) => (
                <Line
                  key={a.kind}
                  label={AI_LABEL[a.kind] ?? a.kind}
                  value={String(a.used)}
                  note={`this month${a.businessesAtLimit ? ` · ${a.businessesAtLimit} at the monthly limit` : ''}`}
                />
              ))}
              <Line label="Emails that failed" value={String(o.costs.failures.emails)} note="in this period" />
              <Line label="Not added to a calendar" value={String(o.costs.failures.calendar)} note="bookings, right now" />
            </ul>
          </section>
        </div>
      )}
    </>
  );
}

function Line({ label, value, note }: { label: string; value: string; note?: string | null }) {
  return (
    <li className="co-line">
      <span className="co-line-label">{label}</span>
      <span className="co-line-value">{value}</span>
      {note && <span className="co-line-note">{note}</span>}
    </li>
  );
}

/** One bar per month, one hue; the latest labelled, every bar has its tooltip. */
function RevenueBars({ months }: { months: Array<{ month: string; minor: number; paying: number }> }) {
  const max = Math.max(...months.map((m) => m.minor), 1);
  const last = months[months.length - 1]!;
  return (
    <div className="co-bars" role="list" aria-label="Monthly revenue by month">
      {months.map((m) => (
        <div key={m.month} className="co-bar" role="listitem" tabIndex={0} aria-label={`${monthName(m.month)}: ${euros(m.minor)}, ${m.paying} paying`}>
          <span className="co-bar-tip" aria-hidden="true">
            {monthName(m.month)} · {euros(m.minor)} · {m.paying} paying
          </span>
          {m === last && <span className="co-bar-value">{euros(m.minor)}</span>}
          <i style={{ height: `${Math.max(2, (m.minor / max) * 100)}%` }} />
          <span className="co-bar-month">{monthName(m.month)}</span>
        </div>
      ))}
    </div>
  );
}
