'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { adminFetchJson } from '@/lib/admin-fetch';
import BlockTimeGrid from '@/components/admin/BlockTimeGrid';

interface Rule {
  id: string;
  weekday: number;
  startTime: string;
  endTime: string;
}

interface Override {
  id: string;
  date: string;
  isClosed: boolean;
  startTime: string | null;
  endTime: string | null;
  note: string | null;
}

/** Luxon's convention, and the one the slot engine itself uses: 1 = Monday .. 7 = Sunday. */
const WEEKDAYS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 7, label: 'Sunday' },
];

function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const date = new Date(2000, 0, 1, h, m);
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${iso}T12:00:00`));
}

export default function AvailabilityPage() {
  const { slug } = useParams<{ slug: string }>();
  const rulesBase = `/api/admin/${slug}/availability-rules`;
  const overridesBase = `/api/admin/${slug}/date-overrides`;

  const [rules, setRules] = useState<Rule[]>([]);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [addingForDay, setAddingForDay] = useState<number | null>(null);
  const [newStart, setNewStart] = useState('09:00');
  const [newEnd, setNewEnd] = useState('17:00');
  const [savingRule, setSavingRule] = useState(false);

  const [addingOverride, setAddingOverride] = useState(false);
  const [overrideDate, setOverrideDate] = useState('');
  const [overrideClosed, setOverrideClosed] = useState(true);
  const [overrideStart, setOverrideStart] = useState('09:00');
  const [overrideEnd, setOverrideEnd] = useState('17:00');
  const [overrideNote, setOverrideNote] = useState('');
  const [savingOverride, setSavingOverride] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [r, o] = await Promise.all([
        adminFetchJson<{ rules: Rule[] }>(rulesBase),
        adminFetchJson<{ overrides: Override[] }>(overridesBase),
      ]);
      setRules(r.rules);
      setOverrides(o.overrides);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- slug is stable for the life of this page
  }, [slug]);

  async function addRule(weekday: number) {
    if (newStart >= newEnd) {
      setError('End time must be after the start time');
      return;
    }
    setSavingRule(true);
    setError(null);
    try {
      await adminFetchJson(rulesBase, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ weekday, startTime: newStart, endTime: newEnd }),
      });
      setAddingForDay(null);
      setNewStart('09:00');
      setNewEnd('17:00');
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSavingRule(false);
    }
  }

  async function removeRule(id: string) {
    setError(null);
    setRules((prev) => prev.filter((r) => r.id !== id));
    try {
      await adminFetchJson(`${rulesBase}/${id}`, { method: 'DELETE' });
    } catch (cause) {
      setError((cause as Error).message);
      await load();
    }
  }

  async function addOverride(event: React.FormEvent) {
    event.preventDefault();
    if (!overrideDate) {
      setError('Pick a date');
      return;
    }
    if (!overrideClosed && overrideStart >= overrideEnd) {
      setError('End time must be after the start time');
      return;
    }
    setSavingOverride(true);
    setError(null);
    try {
      await adminFetchJson(overridesBase, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          date: overrideDate,
          isClosed: overrideClosed,
          startTime: overrideClosed ? undefined : overrideStart,
          endTime: overrideClosed ? undefined : overrideEnd,
          note: overrideNote || undefined,
        }),
      });
      setAddingOverride(false);
      setOverrideDate('');
      setOverrideClosed(true);
      setOverrideNote('');
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSavingOverride(false);
    }
  }

  async function removeOverride(id: string) {
    setError(null);
    setOverrides((prev) => prev.filter((o) => o.id !== id));
    try {
      await adminFetchJson(`${overridesBase}/${id}`, { method: 'DELETE' });
    } catch (cause) {
      setError((cause as Error).message);
      await load();
    }
  }

  return (
    <>
      <div className="admin-page-head">
        <div>
          <div className="admin-eyebrow">Availability</div>
          <h1>When you are free</h1>
        </div>
      </div>

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}

      {loading && <p className="status">Loading…</p>}

      {!loading && (
        <div style={{ display: 'grid', gap: 20, gridTemplateColumns: 'minmax(0, 1fr)' }}>
          <div className="card">
            <div className="admin-card-title">Weekly hours</div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {WEEKDAYS.map((day) => {
                const dayRules = rules.filter((r) => r.weekday === day.value);
                return (
                  <div
                    key={day.value}
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: 10,
                      padding: '6px 0',
                      borderBottom: '1px solid var(--rule)',
                    }}
                  >
                    <span style={{ width: 92, flex: '0 0 auto', fontSize: '0.85rem' }}>
                      {day.label}
                    </span>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, flex: 1 }}>
                      {dayRules.length === 0 && addingForDay !== day.value && (
                        <span style={{ fontSize: '0.82rem', color: 'var(--ghost)' }}>Closed</span>
                      )}
                      {dayRules.map((r) => (
                        <span
                          key={r.id}
                          style={{
                            background: 'var(--side)',
                            borderRadius: 100,
                            padding: '2px 10px',
                            fontSize: '0.8rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {formatTime(r.startTime)} – {formatTime(r.endTime)}
                          <button
                            type="button"
                            className="btn-link"
                            style={{ fontSize: '0.78rem' }}
                            onClick={() => removeRule(r.id)}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>

                    {addingForDay === day.value ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input
                          type="time"
                          value={newStart}
                          onChange={(e) => setNewStart(e.target.value)}
                          style={{ width: 110 }}
                        />
                        <span style={{ color: 'var(--faint)' }}>–</span>
                        <input
                          type="time"
                          value={newEnd}
                          onChange={(e) => setNewEnd(e.target.value)}
                          style={{ width: 110 }}
                        />
                        <button
                          type="button"
                          className="btn-primary"
                          disabled={savingRule}
                          onClick={() => addRule(day.value)}
                        >
                          Add
                        </button>
                        <button type="button" className="btn-link" onClick={() => setAddingForDay(null)}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="btn-link"
                        onClick={() => {
                          setAddingForDay(day.value);
                          setNewStart('09:00');
                          setNewEnd('17:00');
                        }}
                      >
                        Add hours
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--faint)', margin: '14px 0 0' }}>
              A day can have more than one window — add a second one for a lunch break split.
            </p>
          </div>

          <div className="card">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                marginBottom: 14,
              }}
            >
              <div className="admin-card-title" style={{ margin: 0 }}>
                Exceptions
              </div>
              {!addingOverride && (
                <button type="button" className="btn-secondary" onClick={() => setAddingOverride(true)}>
                  Add an exception
                </button>
              )}
            </div>

            {addingOverride && (
              <form
                onSubmit={addOverride}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  padding: 16,
                  marginBottom: 16,
                }}
              >
                <div className="field">
                  <label htmlFor="override-date">Date</label>
                  <input
                    id="override-date"
                    type="date"
                    required
                    value={overrideDate}
                    onChange={(e) => setOverrideDate(e.target.value)}
                  />
                </div>

                <div style={{ display: 'flex', gap: 8, margin: '4px 0 16px' }}>
                  <button
                    type="button"
                    className={overrideClosed ? 'btn-primary' : 'btn-secondary'}
                    onClick={() => setOverrideClosed(true)}
                  >
                    Closed all day
                  </button>
                  <button
                    type="button"
                    className={!overrideClosed ? 'btn-primary' : 'btn-secondary'}
                    onClick={() => setOverrideClosed(false)}
                  >
                    Special hours
                  </button>
                </div>

                {!overrideClosed && (
                  <div className="admin-field-row" style={{ maxWidth: 300 }}>
                    <div className="field">
                      <label htmlFor="override-start">From</label>
                      <input
                        id="override-start"
                        type="time"
                        value={overrideStart}
                        onChange={(e) => setOverrideStart(e.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="override-end">To</label>
                      <input
                        id="override-end"
                        type="time"
                        value={overrideEnd}
                        onChange={(e) => setOverrideEnd(e.target.value)}
                      />
                    </div>
                  </div>
                )}

                <div className="field">
                  <label htmlFor="override-note">Note (optional)</label>
                  <input
                    id="override-note"
                    type="text"
                    placeholder="Public holiday"
                    value={overrideNote}
                    onChange={(e) => setOverrideNote(e.target.value)}
                  />
                </div>

                <div className="actions">
                  <button type="submit" className="btn-primary" disabled={savingOverride}>
                    {savingOverride ? 'Saving…' : 'Add exception'}
                  </button>
                  <button type="button" className="btn-link" onClick={() => setAddingOverride(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {overrides.length === 0 && !addingOverride && (
              <p className="notice notice-muted" style={{ margin: 0 }}>
                No exceptions yet — every week follows the hours above.
              </p>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {overrides.map((o) => (
                <div
                  key={o.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <div>
                    <div style={{ fontSize: '0.9rem' }}>{formatDate(o.date)}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--faint)' }}>
                      {o.isClosed
                        ? 'Closed'
                        : `${formatTime(o.startTime!)} – ${formatTime(o.endTime!)} only`}
                      {o.note ? ` · ${o.note}` : ''}
                    </div>
                  </div>
                  <button type="button" className="btn-link" onClick={() => removeOverride(o.id)}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>

          <BlockTimeGrid slug={slug} rules={rules} overrides={overrides} />
        </div>
      )}

      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'flex-start',
          padding: '16px 20px',
          background: 'var(--side)',
          borderRadius: 'var(--radius)',
          border: '1px solid var(--border)',
          marginTop: 20,
        }}
      >
        <p style={{ fontSize: '0.85rem', color: 'var(--muted)', margin: 0, lineHeight: 1.6 }}>
          An exception replaces the day&apos;s usual hours entirely rather than adding to them — a
          holiday closes it outright, and special hours mean only those hours.
        </p>
      </div>
    </>
  );
}
