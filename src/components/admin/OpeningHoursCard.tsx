'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminFetchJson } from '@/lib/admin-fetch';

interface Rule {
  id: string;
  weekday: number;
  startTime: string;
  endTime: string;
}

interface Window {
  startTime: string;
  endTime: string;
}

type Week = Record<number, Window[]>;

const DAYS: Array<{ weekday: number; name: string }> = [
  { weekday: 1, name: 'Monday' },
  { weekday: 2, name: 'Tuesday' },
  { weekday: 3, name: 'Wednesday' },
  { weekday: 4, name: 'Thursday' },
  { weekday: 5, name: 'Friday' },
  { weekday: 6, name: 'Saturday' },
  { weekday: 7, name: 'Sunday' },
];

const DEFAULT_WINDOW: Window = { startTime: '09:00', endTime: '17:00' };

function fromRules(rules: Rule[]): Week {
  const week: Week = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };
  for (const r of rules) week[r.weekday]!.push({ startTime: r.startTime, endTime: r.endTime });
  for (const d of DAYS) week[d.weekday]!.sort((a, b) => a.startTime.localeCompare(b.startTime));
  return week;
}

const same = (a: Week, b: Week) => JSON.stringify(a) === JSON.stringify(b);

/** Why a day's hours cannot be saved, or null. */
function problem(windows: Window[]): string | null {
  const sorted = [...windows].sort((a, b) => a.startTime.localeCompare(b.startTime));
  for (const w of sorted) if (!w.startTime || !w.endTime || w.startTime >= w.endTime) return 'Closing time must be after opening time.';
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i]!.startTime < sorted[i - 1]!.endTime) return 'These hours overlap.';
  }
  return null;
}

/**
 * The usual weekly opening hours, as a plain form: each day open or closed,
 * with its hours, and more than one range for a day with a break. The same
 * hours the Week's "Paint usual hours" edits; this is the place people look
 * for them first. One-off changes (a closed day, a late evening) stay on the
 * Week, on that date.
 */
export function OpeningHoursCard({ slug, timezone, weekHref }: { slug: string; timezone: string; weekHref: string }) {
  const [saved, setSaved] = useState<Week | null>(null);
  const [draft, setDraft] = useState<Week | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    try {
      const { rules } = await adminFetchJson<{ rules: Rule[] }>(`/api/admin/${slug}/availability-rules`);
      const week = fromRules(rules);
      setSaved(week);
      setDraft(week);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  function change(weekday: number, windows: Window[]) {
    setDone(false);
    setDraft((d) => (d ? { ...d, [weekday]: windows } : d));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft || !saved) return;
    setSaving(true);
    setError(null);
    try {
      const { rules } = await adminFetchJson<{ rules: Rule[] }>(`/api/admin/${slug}/availability-rules`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ days: DAYS.map((d) => ({ weekday: d.weekday, windows: draft[d.weekday] })) }),
      });
      const week = fromRules(rules);
      setSaved(week);
      setDraft(week);
      setDone(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const problems = draft ? DAYS.map((d) => problem(draft[d.weekday]!)) : [];
  const invalid = problems.some(Boolean);
  const dirty = !!draft && !!saved && !same(draft, saved);
  const allClosed = !!draft && DAYS.every((d) => draft[d.weekday]!.length === 0);

  return (
    <form className="card acct-card" id="opening-hours" onSubmit={save}>
      <div className="admin-card-title">Opening hours</div>
      <p className="wk-side-hint" style={{ marginTop: 0 }}>
        When people can book you, every week, in your time zone ({timezone.replace(/_/g, ' ')}). Your services fit
        inside these hours, and busy times in your connected calendar are left out.
      </p>

      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      {!draft && !error && <p className="status">Loading…</p>}

      {draft && (
        <div className="oh">
          {DAYS.map((d, i) => {
            const windows = draft[d.weekday]!;
            const open = windows.length > 0;
            return (
              <div className={`oh-day${open ? '' : ' is-closed'}`} key={d.weekday}>
                <label className="oh-toggle">
                  <input
                    type="checkbox"
                    checked={open}
                    onChange={(e) => {
                      const last = DAYS.slice(0, i)
                        .reverse()
                        .map((p) => draft[p.weekday]!)
                        .find((w) => w.length > 0);
                      change(d.weekday, e.target.checked ? (last ? last.map((w) => ({ ...w })) : [{ ...DEFAULT_WINDOW }]) : []);
                    }}
                  />
                  <span>{d.name}</span>
                </label>
                <div className="oh-windows">
                  {!open && <span className="oh-closed">Closed</span>}
                  {windows.map((w, j) => (
                    <div className="oh-window" key={j}>
                      <input
                        type="time"
                        aria-label={`${d.name} opens at`}
                        value={w.startTime}
                        step={900}
                        onChange={(e) =>
                          change(
                            d.weekday,
                            windows.map((x, k) => (k === j ? { ...x, startTime: e.target.value } : x)),
                          )
                        }
                      />
                      <span aria-hidden="true">–</span>
                      <input
                        type="time"
                        aria-label={`${d.name} closes at`}
                        value={w.endTime}
                        step={900}
                        onChange={(e) =>
                          change(
                            d.weekday,
                            windows.map((x, k) => (k === j ? { ...x, endTime: e.target.value } : x)),
                          )
                        }
                      />
                      {windows.length > 1 && (
                        <button
                          type="button"
                          className="btn-link"
                          aria-label={`Remove ${d.name} ${w.startTime}–${w.endTime}`}
                          onClick={() => change(d.weekday, windows.filter((_, k) => k !== j))}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                  {open && (
                    <button
                      type="button"
                      className="btn-link oh-add"
                      onClick={() => {
                        const lastEnd = windows[windows.length - 1]!.endTime;
                        const [h, m] = lastEnd.split(':').map(Number) as [number, number];
                        const start = `${String(Math.min(h + 1, 22)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                        const end = `${String(Math.min(h + 3, 23)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                        change(d.weekday, [...windows, { startTime: start, endTime: end }]);
                      }}
                    >
                      Add hours (for a break)
                    </button>
                  )}
                  {problems[i] && (
                    <p className="oh-problem" role="alert">
                      {problems[i]}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {allClosed && (
        <p className="notice notice-error" role="status">
          Every day is closed, so your booking page offers no times.
        </p>
      )}

      <div className="wk-actions">
        <button type="submit" className="btn-primary" disabled={!dirty || invalid || saving}>
          {saving ? 'Saving…' : 'Save opening hours'}
        </button>
        {dirty && (
          <button type="button" className="btn-link" onClick={() => setDraft(saved)}>
            Undo changes
          </button>
        )}
        {done && !dirty && <span className="ms-saved">Saved.</span>}
      </div>
      <p className="field-note">
        A day off, a holiday or different hours on one date: set it on the <a href={weekHref}>Week</a>, on that day.
      </p>
    </form>
  );
}
