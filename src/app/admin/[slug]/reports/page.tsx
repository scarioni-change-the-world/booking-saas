'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { DateTime } from 'luxon';
import { PageHeader } from '@/components/ui';
import { adminFetchJson } from '@/lib/admin-fetch';
import { Bars, JourneyBars, WeekHeat } from '@/components/admin/ReportCharts';
import { PRESETS, type Period, type PeriodPreset } from '@/lib/report-period';
import { bandName, formatMinor, weekdayName, type Figure, type Report } from '@/lib/reports';
import type { ReportSummary, SummaryPlace } from '@/lib/ai/provider';
import { MONTHLY_LIMITS } from '@/lib/ai/limits';

interface Payload {
  today: string;
  period: Period;
  previous: { from: string; to: string; label: string };
  currency: string;
  timezone: string;
  visitsSince: string | null;
  report: Report;
  summary: { summary: ReportSummary; created_at: string } | null;
  /** The latest summaries for any period, newest first. */
  pastSummaries: PastSummary[];
}

interface PastSummary {
  from: string;
  to: string;
  createdAt: string;
  headline: string;
}

const PLACE: Record<SummaryPlace, { label: string; href: string } | null> = {
  services: { label: 'Services', href: 'flow' },
  week: { label: 'Week', href: 'week' },
  people: { label: 'People', href: 'people' },
  questions: { label: 'Questions', href: 'screening' },
  messages: { label: 'Messages', href: 'messages' },
  account: { label: 'Account', href: 'account' },
  none: null,
};

/**
 * Reports: how the practice is going, and what to change.
 *
 * Built to be used, not admired. It opens on the few things worth acting on
 * (the notes, and a written summary on request), then the figures that
 * support them, section by section, each with a way to the place where the
 * change is made. Any period — the usual ones, or any two dates — and always
 * compared with the stretch of the same length before it.
 */
export default function ReportsPage() {
  const { slug } = useParams<{ slug: string }>();
  const [preset, setPreset] = useState<PeriodPreset>('30d');
  const [custom, setCustom] = useState<{ from: string; to: string }>({ from: '', to: '' });
  const [editingCustom, setEditingCustom] = useState(false);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useCallback(
    (p: PeriodPreset, c: { from: string; to: string }) =>
      p === 'custom' ? `preset=custom&from=${c.from}&to=${c.to}` : `preset=${p}`,
    [],
  );

  const load = useCallback(
    async (p: PeriodPreset, c: { from: string; to: string }) => {
      setLoading(true);
      setError(null);
      try {
        setData(await adminFetchJson<Payload>(`/api/admin/${slug}/reports?${query(p, c)}`));
      } catch (cause) {
        setError((cause as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [slug, query],
  );

  useEffect(() => {
    void load('30d', { from: '', to: '' });
  }, [load]);

  function choose(p: PeriodPreset) {
    setPreset(p);
    if (p === 'custom') {
      setEditingCustom(true);
      if (!custom.from && data) setCustom({ from: data.period.from, to: data.period.to });
      return;
    }
    setEditingCustom(false);
    void load(p, custom);
  }

  /** Open a past summary: its exact dates, as a chosen period, where it is saved. */
  function openPast(from: string, to: string) {
    setPreset('custom');
    setCustom({ from, to });
    setEditingCustom(false);
    void load('custom', { from, to });
  }

  const r = data?.report;
  const money = (minor: number) => formatMinor(minor, data?.currency ?? 'EUR');

  return (
    <>
      <PageHeader
        title="Reports"
        description="How your practice is going, and what to change. Every figure is for the period you choose, next to the one before it."
      />

      <div className="rep-period" role="group" aria-label="Period">
        <div className="rep-presets">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="filter-chip"
              aria-pressed={preset === p.id}
              onClick={() => choose(p.id)}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            className="filter-chip"
            aria-pressed={preset === 'custom'}
            onClick={() => choose('custom')}
          >
            Choose dates
          </button>
        </div>
        {editingCustom && (
          <form
            className="rep-custom"
            onSubmit={(e) => {
              e.preventDefault();
              setEditingCustom(false);
              void load('custom', custom);
            }}
          >
            <label>
              From
              <input
                type="date"
                max={data?.today}
                value={custom.from}
                onChange={(e) => setCustom({ ...custom, from: e.target.value })}
                required
              />
            </label>
            <label>
              To
              <input
                type="date"
                min={custom.from || undefined}
                max={data?.today}
                value={custom.to}
                onChange={(e) => setCustom({ ...custom, to: e.target.value })}
                required
              />
            </label>
            <button type="submit" className="btn-primary" disabled={!custom.from || !custom.to}>
              Show
            </button>
          </form>
        )}
        {data && !editingCustom && (
          <p className="rep-compare">
            <b>
              {data.period.preset === 'custom'
                ? data.period.label
                : rangeText(data.period.from, data.period.to)}
            </b>
            <span className="wk-muted"> · compared with {data.previous.label}</span>
          </p>
        )}
      </div>

      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      {loading && !data && <p className="status">Reading your period…</p>}

      {data && r && (
        <div className={`rep${loading ? ' is-loading' : ''}`} aria-busy={loading}>
          <div className="rep-top">
            <section className="wk-plate rep-notes" aria-labelledby="rep-notes-h">
              <p className="wk-side-eyebrow" id="rep-notes-h">
                What to look at
              </p>
              {r.findings.length === 0 ? (
                <p className="wk-side-hint">
                  Nothing stands out yet. Notes appear here once there is enough in a period to go on — a few
                  weeks of bookings usually.
                </p>
              ) : (
                <ul className="rep-findings">
                  {r.findings.map((f, i) => (
                    <li key={f.id} className={f.tone === 'need' ? 'is-need' : undefined}>
                      <span className={`lamp is-${f.tone === 'need' ? 'need' : 'here'}`} aria-hidden="true" />
                      <div>
                        <p className="rep-finding-title">{f.title}</p>
                        <p className="rep-finding-detail">{f.detail}</p>
                        {f.action && (
                          /* One solid Ochre key — the first thing to do. The
                             rest keep their Ochre lamp, not a second shout. */
                          <a
                            className={`btn-secondary${f.tone === 'need' && i === 0 ? ' is-need' : ''}`}
                            href={`/admin/${slug}/${f.action.href}`}
                          >
                            {f.action.label}
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <SummaryPlate
              slug={slug}
              data={data}
              preset={preset}
              onDone={(s) =>
                setData({
                  ...data,
                  summary: s,
                  pastSummaries: s
                    ? [
                        {
                          from: data.period.from,
                          to: data.period.to,
                          createdAt: s.created_at,
                          headline: s.summary.headline,
                        },
                        ...data.pastSummaries.filter(
                          (p) => p.from !== data.period.from || p.to !== data.period.to,
                        ),
                      ]
                    : data.pastSummaries,
                })
              }
              onOpen={openPast}
            />
          </div>

          <Headline data={data} />

          <Section
            id="journey"
            title="From visit to booking"
            lede="Where people who find your page stop. The biggest drop is the place to work on first."
          >
            <JourneyBars steps={r.funnel.steps} worst={r.funnel.worstDrop} />
            {!r.tracking.visits && (
              <p className="wk-side-hint">
                {data.visitsSince
                  ? `Visits are counted from ${DateTime.fromISO(data.visitsSince).toFormat('d LLLL')}, after this period.`
                  : 'Visits to your page are counted from now on, so the journey starts at your questions for now.'}
              </p>
            )}
          </Section>

          <Section
            id="services"
            title="Your services"
            lede="What each one brings in for an hour of your time, how often it is cancelled, and whether people come back."
          >
            {r.services.length === 0 ? (
              <p className="wk-side-hint">Nothing booked in this period.</p>
            ) : (
              <div className="rep-table-wrap">
                <table className="rep-table">
                  <thead>
                    <tr>
                      <th scope="col">Service</th>
                      <th scope="col">Booked</th>
                      <th scope="col">Held</th>
                      <th scope="col">Earned</th>
                      <th scope="col">Per hour</th>
                      <th scope="col">Cancelled</th>
                      <th scope="col">No-shows</th>
                      <th scope="col">Came back</th>
                      <th scope="col">Rating</th>
                      <th scope="col">Booked ahead</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.services.map((s) => (
                      <tr key={s.id}>
                        <th scope="row">
                          <a href={`/admin/${slug}/sessions/${s.id}`}>{s.name}</a>
                        </th>
                        <td>{s.booked}</td>
                        <td>
                          {s.held}
                          {s.upcoming > 0 && <small className="wk-muted"> +{s.upcoming} to come</small>}
                        </td>
                        <td>{s.valueMinor ? money(s.valueMinor) : '—'}</td>
                        <td>{s.valuePerHourMinor !== null ? money(s.valuePerHourMinor) : '—'}</td>
                        <td>{s.cancelRate !== null ? pct(s.cancelRate) : '—'}</td>
                        <td>{s.noShows || '—'}</td>
                        <td>{s.cameBackRate !== null ? pct(s.cameBackRate) : '—'}</td>
                        <td>{s.rating !== null ? `${s.rating} (${s.ratingCount})` : '—'}</td>
                        <td>{s.medianLeadDays !== null ? `${s.medianLeadDays} d` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section
            id="when"
            title="When people want you"
            lede="Your open hours over the whole period, darker where more of them were booked."
          >
            <WeekHeat cells={r.demand.cells} hours={r.demand.hours} />
            <div className="rep-cols">
              <div>
                <p className="wk-side-eyebrow">Fills up</p>
                {r.demand.full.length === 0 ? (
                  <p className="wk-side-hint">No part of the week was three-quarters booked.</p>
                ) : (
                  <ul className="rep-list">
                    {r.demand.full.slice(0, 4).map((b) => (
                      <li key={`${b.weekday}${b.part}`}>
                        <b>{bandName(b.weekday, b.part)}</b> · {pct(b.fill)} of {b.openHours} h
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="wk-side-eyebrow">Nobody chose</p>
                {r.demand.quiet.length === 0 ? (
                  <p className="wk-side-hint">Every part of your week had bookings.</p>
                ) : (
                  <ul className="rep-list is-need">
                    {r.demand.quiet.slice(0, 4).map((b) => (
                      <li key={`${b.weekday}${b.part}`}>
                        <span className="lamp is-need" aria-hidden="true" />
                        <b>{bandName(b.weekday, b.part)}</b> · {b.openHours} open hours
                      </li>
                    ))}
                  </ul>
                )}
                <a className="btn-link" href={`/admin/${slug}/week`}>
                  Change your hours
                </a>
              </div>
              <div>
                <p className="wk-side-eyebrow">How far ahead people book</p>
                <Bars
                  label="How far ahead people book"
                  rows={r.demand.lead.map((l) => ({ key: l.label, label: l.label, value: l.count }))}
                />
                {r.demand.bookedWhen && (
                  <p className="wk-side-hint">
                    Most bookings are made on {weekdayName(r.demand.bookedWhen.weekday)}{' '}
                    {r.demand.bookedWhen.part}s — a good time to post.
                  </p>
                )}
              </div>
            </div>
          </Section>

          <Section id="clients" title="Clients" lede="Who is new, who comes back, and who has gone quiet.">
            <div className="rep-stats">
              <Stat label="Saw you this period" value={String(r.clients.active)} />
              <Stat label="Booked for the first time" value={String(r.clients.newClients)} />
              <Stat label="Booked again" value={String(r.clients.returning)} />
              <Stat
                label="Have booked again since"
                value={r.clients.cameBackRate !== null ? pct(r.clients.cameBackRate) : '—'}
              />
              <Stat
                label="Usual gap between sessions"
                value={r.clients.medianDaysBetween !== null ? `${r.clients.medianDaysBetween} days` : '—'}
              />
              <Stat
                label="Programmes"
                value={`${r.clients.programmes.running} running`}
                sub={`${r.clients.programmes.completed} finished · ${r.clients.programmes.stalled.length} stalled`}
              />
            </div>
            <div className="rep-cols">
              <div>
                <p className="wk-side-eyebrow">Gone quiet</p>
                {r.clients.quiet.length === 0 ? (
                  <p className="wk-side-hint">
                    Nobody who has worked with you has been away for more than six weeks.
                  </p>
                ) : (
                  <ul className="rep-list">
                    {r.clients.quiet.map((c) => (
                      <li key={c.email}>
                        <b>{c.name}</b> · {c.sessions} {c.sessions === 1 ? 'session' : 'sessions'}, last{' '}
                        {DateTime.fromISO(c.lastSession).toFormat('d LLL')}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="wk-side-eyebrow">Programmes stalled</p>
                {r.clients.programmes.stalled.length === 0 ? (
                  <p className="wk-side-hint">
                    Every programme with sessions still owed has one booked recently.
                  </p>
                ) : (
                  <ul className="rep-list is-need">
                    {r.clients.programmes.stalled.map((p) => (
                      <li key={`${p.email}${p.serviceName}`}>
                        <span className="lamp is-need" aria-hidden="true" />
                        <b>{p.name}</b> · {p.serviceName}, {p.owed} still to book
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <a className="btn-secondary" href={`/admin/${slug}/people`}>
              Open People
            </a>
          </Section>

          <Section
            id="money"
            title="Money"
            lede="What the sessions you held are worth at your prices, and what was paid online."
          >
            <div className="rep-stats">
              <Stat label="Earned at your prices" value={money(r.money.valueEarnedMinor)} />
              <Stat
                label="Paid online"
                value={money(r.money.collectedOnlineMinor)}
                sub={r.money.refundedMinor ? `${money(r.money.refundedMinor)} refunded` : undefined}
              />
              <Stat label="Still to collect after deposits" value={money(r.money.depositsToCollectMinor)} />
              <Stat
                label="Kept on late cancellations"
                value={money(r.money.lateKept.amountMinor)}
                sub={r.money.lateKept.count ? `${r.money.lateKept.count} bookings` : undefined}
              />
              <Stat label="Already booked, next 30 days" value={money(r.money.bookedAheadMinor)} />
            </div>
            {r.money.byService.length > 1 && (
              <>
                <p className="wk-side-eyebrow">By service</p>
                <Bars
                  label="Earned by service"
                  rows={r.money.byService.map((s) => ({ key: s.id, label: s.name, value: s.valueMinor }))}
                  format={money}
                />
              </>
            )}
            <p className="wk-side-hint">
              “Earned at your prices” counts each session held at the service’s price — including what clients
              paid you directly.
            </p>
          </Section>

          <Section
            id="cancellations"
            title="Cancellations and no-shows"
            lede="How many, how late, who, and why."
          >
            <div className="rep-stats">
              <Stat
                label="Cancelled"
                value={String(r.cancellations.count)}
                sub={`${r.cancellations.byClient} by clients · ${r.cancellations.byBusiness} by you`}
              />
              <Stat
                label="Of everything due"
                value={r.cancellations.rate !== null ? pct(r.cancellations.rate) : '—'}
              />
              <Stat
                label="Inside your notice"
                value={String(r.cancellations.late)}
                need={r.cancellations.count >= 3 && r.cancellations.late / r.cancellations.count >= 0.3}
              />
              <Stat
                label="Usually cancelled"
                value={
                  r.cancellations.medianHoursAhead !== null
                    ? aheadText(r.cancellations.medianHoursAhead)
                    : '—'
                }
              />
              <Stat
                label="Didn’t come"
                value={String(r.cancellations.noShows)}
                sub={
                  r.cancellations.noShowRate !== null
                    ? `${pct(r.cancellations.noShowRate)} of those marked`
                    : undefined
                }
              />
              <Stat label="Moved at least once" value={String(r.cancellations.moved)} />
            </div>
            {r.cancellations.past > 0 && r.cancellations.marked < r.cancellations.past && (
              <p className="wk-side-hint">
                Came or didn’t come is marked for {r.cancellations.marked} of {r.cancellations.past} sessions.
                Mark them on the <a href={`/admin/${slug}/week`}>Week</a> — open a past booking — to see
                no-shows clearly.
              </p>
            )}
            {r.cancellations.reasons.length > 0 && (
              <>
                <p className="wk-side-eyebrow">Reasons given</p>
                <ul className="rep-quotes">
                  {r.cancellations.reasons.map((q, i) => (
                    <li key={i}>
                      “{q.reason}”
                      <small>
                        {q.serviceName} · {q.by === 'business' ? 'you' : q.by === 'client' ? 'client' : ''}{' '}
                        {DateTime.fromISO(q.at).toFormat('d LLL')}
                      </small>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Section>

          <Section
            id="sources"
            title="Where people come from"
            lede="The sites and links that bring visitors, and the ones that bring bookings."
          >
            {r.sources.length === 0 ? (
              <p className="wk-side-hint">Nothing yet.</p>
            ) : (
              <div className="rep-table-wrap">
                <table className="rep-table">
                  <thead>
                    <tr>
                      <th scope="col">From</th>
                      <th scope="col">Visits</th>
                      <th scope="col">Bookings</th>
                      <th scope="col">Booked per visit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.sources.map((s) => (
                      <tr key={s.source}>
                        <th scope="row">{s.label}</th>
                        <td>{r.tracking.visits ? s.visits : '—'}</td>
                        <td>{s.bookings}</td>
                        <td>{s.conversion !== null ? pct(s.conversion) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="wk-side-hint">
              Tag your own links to tell them apart: add <code>?ref=newsletter</code> (or any word) to your
              booking link, e.g. <code>/t/{slug}?ref=instagram-bio</code>.
            </p>
          </Section>

          <Section id="ratings" title="Ratings" lede="What clients said after their sessions.">
            {r.ratings.count === 0 ? (
              <p className="wk-side-hint">
                {r.tracking.ratings === 0
                  ? 'Clients are asked the morning after each session. Their answers appear here.'
                  : 'No ratings in this period.'}{' '}
                <a href={`/admin/${slug}/messages`}>The email is in Messages</a>.
              </p>
            ) : (
              <div className="rep-cols">
                <div>
                  <p className="rep-big">
                    {r.ratings.average}
                    <small> out of 5 · {r.ratings.count} ratings</small>
                  </p>
                  <Bars
                    label="Ratings"
                    rows={r.ratings.distribution.map((d) => ({
                      key: String(d.rating),
                      label: `${d.rating} ★`,
                      value: d.count,
                    }))}
                  />
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <p className="wk-side-eyebrow">In their words</p>
                  {r.ratings.comments.length === 0 ? (
                    <p className="wk-side-hint">No comments this period.</p>
                  ) : (
                    <ul className="rep-quotes">
                      {r.ratings.comments.map((c, i) => (
                        <li key={i}>
                          “{c.comment}”
                          <small>
                            {'★'.repeat(c.rating)} · {c.serviceName} ·{' '}
                            {DateTime.fromISO(c.at).toFormat('d LLL')}
                          </small>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </Section>

          {r.questions.length > 0 && (
            <Section
              id="questions"
              title="Your questions"
              lede="Which questions send people somewhere other than your calendar, and with which answer."
            >
              <ul className="rep-questions">
                {r.questions.slice(0, 6).map((q) => (
                  <li key={q.questionId}>
                    <p className="rep-finding-title">{q.prompt}</p>
                    <p className="rep-finding-detail">
                      {q.sentElsewhere > 0
                        ? `${q.sentElsewhere} of ${q.answered} sent elsewhere${
                            q.routingAnswers[0] ? `, mostly “${q.routingAnswers[0].answer}”` : ''
                          }.`
                        : `${q.answered} answered. Nobody sent elsewhere.`}
                    </p>
                  </li>
                ))}
              </ul>
              <a className="btn-secondary" href={`/admin/${slug}/screening`}>
                Review your questions
              </a>
            </Section>
          )}
        </div>
      )}
    </>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────── */

const pct = (share: number) => `${Math.round(share * 100)}%`;

function rangeText(from: string, to: string): string {
  const a = DateTime.fromISO(from);
  const b = DateTime.fromISO(to);
  return a.month === b.month && a.year === b.year
    ? `${a.day}–${b.toFormat('d LLLL')}`
    : `${a.toFormat('d LLLL')} – ${b.toFormat('d LLLL')}`;
}

function aheadText(hours: number): string {
  if (hours < 48) return `${hours} h ahead`;
  return `${Math.round(hours / 24)} days ahead`;
}

function Section({
  id,
  title,
  lede,
  children,
}: {
  id: string;
  title: string;
  lede: string;
  children: React.ReactNode;
}) {
  return (
    <section className="wk-plate rep-section" id={id} aria-labelledby={`${id}-h`}>
      <h2 className="rep-h" id={`${id}-h`}>
        {title}
      </h2>
      <p className="rep-lede">{lede}</p>
      {children}
    </section>
  );
}

function Stat({ label, value, sub, need }: { label: string; value: string; sub?: string; need?: boolean }) {
  return (
    <div className={`rep-stat${need ? ' is-need' : ''}`}>
      <p className="rep-stat-label">
        {need && <span className="lamp is-need" aria-hidden="true" />}
        {label}
      </p>
      <p className="rep-stat-value">{value}</p>
      {sub && <p className="rep-stat-sub">{sub}</p>}
    </div>
  );
}

/** "+3 on 1–31 Aug", "same as before", or nothing when there is no before. */
function delta(f: Figure, format: (n: number) => string, label: string): string | undefined {
  if (f.previous === null) return undefined;
  const d = Math.round((f.value - f.previous) * 10) / 10;
  if (d === 0) return `Same as ${label}`;
  return `${d > 0 ? '▲' : '▼'} ${format(Math.abs(d))} on ${label}`;
}

function Headline({ data }: { data: Payload }) {
  const h = data.report.headline;
  const money = (minor: number) => formatMinor(minor, data.currency);
  const n = (x: number) => x.toLocaleString();
  const before = 'the period before';
  const util = h.utilisation.value;
  return (
    <section className="rep-headline" aria-label="The period in figures">
      <Stat label="Bookings made" value={n(h.bookingsMade.value)} sub={delta(h.bookingsMade, n, before)} />
      <Stat label="Sessions held" value={n(h.sessionsHeld.value)} sub={delta(h.sessionsHeld, n, before)} />
      <div className="rep-stat">
        <p className="rep-stat-label">How full you were</p>
        <p className="rep-stat-value">{util !== null ? pct(util) : '—'}</p>
        {util !== null && (
          <span className="rep-meter" aria-hidden="true">
            <span style={{ width: `${Math.round(util * 100)}%` }} />
          </span>
        )}
        <p className="rep-stat-sub">
          {h.hoursBooked.value} of {h.hoursOpen.value} open hours
          {h.utilisation.previous !== null ? ` · ${pct(h.utilisation.previous)} before` : ''}
        </p>
      </div>
      <Stat
        label="Earned at your prices"
        value={money(h.valueEarnedMinor.value)}
        sub={delta(h.valueEarnedMinor, money, before)}
      />
      <Stat
        label="New clients"
        value={n(h.newClients.value)}
        sub={`${n(h.returningClients.value)} returning${h.newClients.previous !== null ? ` · ${n(h.newClients.previous)} new before` : ''}`}
      />
      <Stat
        label="Visits to your page"
        value={data.report.tracking.visits ? n(h.visits.value) : '—'}
        sub={data.report.tracking.visits ? delta(h.visits, n, before) : 'Counted from now on'}
      />
      <Stat
        label="Rating"
        value={h.rating.average !== null ? `${Math.round(h.rating.average * 10) / 10} ★` : '—'}
        sub={h.rating.count ? `${h.rating.count} ratings` : 'None yet'}
      />
    </section>
  );
}

function SummaryPlate({
  slug,
  data,
  preset,
  onDone,
  onOpen,
}: {
  slug: string;
  data: Payload;
  preset: PeriodPreset;
  onDone: (s: Payload['summary']) => void;
  onOpen: (from: string, to: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saved = data.summary;

  async function write() {
    setBusy(true);
    setError(null);
    try {
      const result = await adminFetchJson<{ summary: Payload['summary'] }>(
        `/api/admin/${slug}/reports/summary`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(
            preset === 'custom' ? { preset, from: data.period.from, to: data.period.to } : { preset },
          ),
        },
      );
      onDone(result.summary);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="wk-plate rep-summary" aria-labelledby="rep-summary-h">
      <p className="wk-side-eyebrow" id="rep-summary-h">
        Summary
      </p>
      {saved ? (
        <>
          <p className="rep-summary-headline">{saved.summary.headline}</p>
          <ol className="rep-summary-points">
            {saved.summary.points.map((p, i) => {
              const place = PLACE[p.where];
              return (
                <li key={i}>
                  <p className="rep-finding-title">{p.title}</p>
                  <p className="rep-finding-detail">
                    {p.detail}
                    {place && (
                      <>
                        {' '}
                        <a href={`/admin/${slug}/${place.href}`}>Open {place.label}</a>
                      </>
                    )}
                  </p>
                </li>
              );
            })}
          </ol>
          <p className="wk-side-hint">
            Generated {DateTime.fromISO(saved.created_at).toFormat('d LLLL')} from the figures below.{' '}
            <button type="button" className="btn-link" disabled={busy} onClick={() => void write()}>
              {busy ? 'Generating…' : 'Generate again'}
            </button>
          </p>
        </>
      ) : (
        <>
          <p className="wk-side-hint">
            A short reading of this period — how it went and the three to five things most worth changing —
            generated for you by the AI assistant from the figures below. Your clients’ names and addresses
            are never sent.
          </p>
          <div className="wk-actions">
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void write()}>
              {busy ? 'Generating… (up to a minute)' : 'Generate a summary'}
            </button>
          </div>
        </>
      )}
      <p className="wk-side-hint">
        You can generate up to {MONTHLY_LIMITS.report_summary} summaries a month. Every one is kept under
        Past summaries, and opening one again doesn’t count.
      </p>
      {(data.pastSummaries ?? []).length > 0 && (
        <details className="rep-past">
          <summary>Past summaries ({data.pastSummaries.length})</summary>
          <ul>
            {data.pastSummaries.map((p) => {
              const here = p.from === data.period.from && p.to === data.period.to;
              return (
                <li key={`${p.from}:${p.to}`}>
                  <button
                    type="button"
                    className="rep-past-open"
                    aria-current={here ? 'true' : undefined}
                    disabled={here}
                    onClick={() => onOpen(p.from, p.to)}
                  >
                    <span className="rep-past-when">
                      {rangeText(p.from, p.to)}
                      {DateTime.fromISO(p.to).year !== DateTime.fromISO(data.today).year &&
                        ` ${DateTime.fromISO(p.to).year}`}
                      {here && <small> · showing</small>}
                    </span>
                    {p.headline && <span className="rep-past-headline">{p.headline}</span>}
                    <small className="wk-muted">
                      Generated{' '}
                      {DateTime.fromISO(p.createdAt).toFormat(
                        DateTime.fromISO(p.createdAt).year === DateTime.fromISO(data.today).year
                          ? 'd LLLL'
                          : 'd LLLL yyyy',
                      )}
                    </small>
                  </button>
                </li>
              );
            })}
          </ul>
        </details>
      )}
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
