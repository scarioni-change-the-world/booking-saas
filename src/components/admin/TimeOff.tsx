'use client';

import { useCallback, useEffect, useState } from 'react';
import { DateTime } from 'luxon';
import { adminFetchJson } from '@/lib/admin-fetch';
import { runLabel, timeOffProblem, type ClosedRun } from '@/lib/time-off';

interface Preview {
  days: number;
  alreadyClosed: number;
  replacingOwnHours: number;
  bookings: Array<{ id: string; name: string; startsAt: string; serviceName: string }>;
}

function useTimeOff(slug: string) {
  const [runs, setRuns] = useState<ClosedRun[] | null>(null);
  const [today, setToday] = useState(DateTime.now().toISODate()!);
  const load = useCallback(async () => {
    const result = await adminFetchJson<{ runs: ClosedRun[]; today: string }>(`/api/admin/${slug}/time-off`);
    setRuns(result.runs);
    setToday(result.today);
  }, [slug]);
  useEffect(() => {
    void load().catch(() => setRuns([]));
  }, [load]);
  return { runs, today, load };
}

/**
 * The plate in the Week's side column: the next time off, and the way to add
 * some. Where somebody looks when a holiday is coming, without having to
 * know that a closed day is "an exception on a date".
 */
export function TimeOffPlate({
  slug,
  onOpen,
  version,
}: {
  slug: string;
  onOpen: () => void;
  version: number;
}) {
  const { runs, load } = useTimeOff(slug);
  useEffect(() => {
    if (version > 0) void load();
  }, [version, load]);
  const next = (runs ?? []).slice(0, 3);
  return (
    <>
      <p className="wk-side-eyebrow">Time off</p>
      {runs === null ? (
        <p className="wk-side-hint">Loading…</p>
      ) : next.length === 0 ? (
        <p className="wk-side-hint">
          Holidays, bank holidays, a day off — close them here and your page stops offering them.
        </p>
      ) : (
        <ul className="to-list">
          {next.map((r) => (
            <li key={r.from}>
              <span>{runLabel(r)}</span>
              {r.note && <span className="wk-muted"> · {r.note}</span>}
            </li>
          ))}
          {runs.length > 3 && <li className="wk-muted">and {runs.length - 3} more</li>}
        </ul>
      )}
      <div className="wk-actions" style={{ marginTop: 8 }}>
        <button type="button" className="btn-secondary" onClick={onOpen}>
          {next.length === 0 ? 'Add time off' : 'Manage time off'}
        </button>
      </div>
    </>
  );
}

/**
 * Close a run of dates, see first what it does, and open closed runs again.
 */
export function TimeOffPanel({
  slug,
  timezone,
  onClose,
  onChanged,
}: {
  slug: string;
  timezone: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { runs, today, load } = useTimeOff(slug);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const lastDay = to || from;
  const problem = from ? timeOffProblem(from, lastDay, today) : null;

  /* What closing would do, as soon as there is a valid run to ask about. */
  useEffect(() => {
    setPreview(null);
    if (!from || problem) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      adminFetchJson<Preview>(`/api/admin/${slug}/time-off`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from, to: lastDay, dryRun: true }),
      })
        .then((p) => !cancelled && setPreview(p))
        .catch(() => undefined);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [slug, from, lastDay, problem]);

  async function close(event: React.FormEvent) {
    event.preventDefault();
    if (!from || problem) return;
    setBusy(true);
    setError(null);
    try {
      await adminFetchJson(`/api/admin/${slug}/time-off`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from, to: lastDay, note: note.trim() || undefined }),
      });
      setDone(
        `Closed ${runLabel({ from, to: lastDay })}. Your booking page no longer offers ${from === lastDay ? 'it' : 'those days'}.`,
      );
      setFrom('');
      setTo('');
      setNote('');
      await load();
      onChanged();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function reopen(run: ClosedRun) {
    setBusy(true);
    setError(null);
    try {
      await adminFetchJson(`/api/admin/${slug}/time-off`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from: run.from, to: run.to }),
      });
      setDone(`Open again: ${runLabel(run)}.`);
      await load();
      onChanged();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const when = (iso: string) => DateTime.fromISO(iso).setZone(timezone).toFormat('ccc d LLL, HH:mm');

  return (
    <div>
      <div className="wk-side-head">
        <h3>Time off</h3>
        <button type="button" className="btn-link" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="wk-side-lead">
        Close one day or a run of them. Your usual hours stay as they are and come back on their own
        afterwards.
      </p>

      {done && (
        <p className="notice notice-muted" role="status">
          {done}
        </p>
      )}

      <form className="to-form" onSubmit={close}>
        <div className="to-dates">
          <div className="field">
            <label htmlFor="to-from">First day</label>
            <input
              id="to-from"
              type="date"
              min={today}
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setDone(null);
                if (to && e.target.value > to) setTo('');
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="to-to">Last day</label>
            <input
              id="to-to"
              type="date"
              min={from || today}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </div>
        <p className="wk-side-hint" style={{ marginTop: 0 }}>
          For a single day, leave the last day empty.
        </p>
        <div className="field">
          <label htmlFor="to-note">What it is (only you see this)</label>
          <input
            id="to-note"
            type="text"
            maxLength={200}
            placeholder="Holiday, bank holiday, training…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {from && problem && <p className="field-error">{problem}</p>}
        {preview && (
          <div className={`to-preview${preview.bookings.length > 0 ? ' is-need' : ''}`}>
            <p>
              Closes {preview.days === 1 ? '1 day' : `${preview.days} days`}
              {preview.alreadyClosed > 0 ? ` (${preview.alreadyClosed} already closed)` : ''}.
              {preview.replacingOwnHours > 0
                ? ` ${preview.replacingOwnHours === 1 ? 'A day' : `${preview.replacingOwnHours} days`} with their own hours will be closed instead.`
                : ''}
            </p>
            {preview.bookings.length > 0 ? (
              <>
                <p>
                  {preview.bookings.length === 1
                    ? '1 booking falls on these days. It stays booked'
                    : `${preview.bookings.length} bookings fall on these days. They stay booked`}{' '}
                  — open each one on the Week to move or cancel it.
                </p>
                <ul>
                  {preview.bookings.slice(0, 6).map((b) => (
                    <li key={b.id}>
                      {when(b.startsAt)} · {b.name} · {b.serviceName}
                    </li>
                  ))}
                  {preview.bookings.length > 6 && <li>and {preview.bookings.length - 6} more</li>}
                </ul>
              </>
            ) : (
              <p>Nothing is booked on these days.</p>
            )}
          </div>
        )}

        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}
        <div className="wk-actions">
          <button type="submit" className="btn-primary" disabled={!from || !!problem || busy}>
            {busy ? 'Closing…' : from && from !== lastDay ? 'Close these days' : 'Close this day'}
          </button>
        </div>
      </form>

      <p className="wk-side-eyebrow" style={{ marginTop: 22 }}>
        Coming up
      </p>
      {runs === null ? (
        <p className="wk-side-hint">Loading…</p>
      ) : runs.length === 0 ? (
        <p className="wk-side-hint">No time off planned.</p>
      ) : (
        <ul className="to-runs">
          {runs.map((r) => (
            <li key={r.from}>
              <span>
                <b>{runLabel(r)}</b>
                <span className="wk-muted">
                  {' '}
                  · {r.days === 1 ? '1 day' : `${r.days} days`}
                  {r.note ? ` · ${r.note}` : ''}
                </span>
              </span>
              <button type="button" className="btn-link" disabled={busy} onClick={() => void reopen(r)}>
                Open again
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
