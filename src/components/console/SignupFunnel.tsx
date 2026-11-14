'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminFetchJson } from '@/lib/admin-fetch';
import type { SignupFunnel as Funnel } from '@/lib/signup-funnel';

const WINDOWS = [
  { id: '30', label: '30 days' },
  { id: '90', label: '90 days' },
  { id: 'all', label: 'All time' },
];

const pct = (share: number) => `${Math.round(share * 100)}%`;
/** Median days after joining, as words: "the same day", "after 1 day", "after 6 days". */
const after = (days: number) => (days < 1 ? 'the same day' : `after ${Math.round(days)} day${Math.round(days) === 1 ? '' : 's'}`);

/**
 * Sign-ups on the console: how many businesses reach each step towards
 * their first booking, the share that carries on from the step before,
 * and the step that loses the most. Where setup needs work, in one look.
 */
export function SignupFunnel() {
  const [span, setSpan] = useState('90');
  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (w: string) => {
    setError(null);
    try {
      const result = await adminFetchJson<{ funnel: Funnel }>(`/api/console/funnel?window=${w}`);
      setFunnel(result.funnel);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, []);

  useEffect(() => {
    void load(span);
  }, [load, span]);

  const top = funnel?.steps[0]?.count ?? 0;
  const label = (id: string) => funnel?.steps.find((s) => s.id === id)?.label.toLowerCase() ?? id;

  return (
    <section className="card su" aria-labelledby="su-title">
      <div className="su-head">
        <div>
          <div className="admin-eyebrow" id="su-title">
            Sign-ups
          </div>
          <p className="su-lede">From signing up to a first booking: where new businesses stop.</p>
        </div>
        <div className="wk-mode" role="group" aria-label="Businesses that joined in">
          {WINDOWS.map((w) => (
            <button
              key={w.id}
              type="button"
              className="filter-chip"
              aria-pressed={span === w.id}
              onClick={() => setSpan(w.id)}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      {!funnel && !error && <p className="status">Loading…</p>}

      {funnel && (
        <>
          <ol className="su-steps">
            {funnel.steps.map((s) => (
              <li key={s.id} className={funnel.worst?.to === s.id ? 'is-worst' : ''}>
                <span className="su-label">{s.label}</span>
                <span className="su-bar" aria-hidden="true">
                  <i style={{ width: `${top ? Math.max(2, (s.count / top) * 100) : 0}%` }} />
                </span>
                <span className="su-count">{s.count}</span>
                <span className="su-of">{s.ofPrevious === null ? '' : pct(s.ofPrevious)}</span>
              </li>
            ))}
          </ol>
          <p className="su-foot">
            {funnel.worst
              ? `Most are lost between “${label(funnel.worst.from)}” and “${label(funnel.worst.to)}”: ${pct(funnel.worst.lost)} stop there.`
              : top === 0
                ? 'Nobody signed up in this period.'
                : 'Too few sign-ups yet to say where people stop.'}
            {funnel.medianDaysToService !== null && ` Typically, the first service comes ${after(funnel.medianDaysToService)}`}
            {funnel.medianDaysToBooking !== null && `, the first booking ${after(funnel.medianDaysToBooking)}`}
            {(funnel.medianDaysToService !== null || funnel.medianDaysToBooking !== null) && '.'}
          </p>
        </>
      )}
    </section>
  );
}
