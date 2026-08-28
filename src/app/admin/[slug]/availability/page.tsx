'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { adminFetchJson } from '@/lib/admin-fetch';
import DaySchedule from '@/components/admin/DaySchedule';

interface Rule {
  id: string;
  weekday: number;
  startTime: string;
  endTime: string;
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

export default function AvailabilityPage() {
  const { slug } = useParams<{ slug: string }>();
  const rulesBase = `/api/admin/${slug}/availability-rules`;

  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [addingForDay, setAddingForDay] = useState<number | null>(null);
  const [newStart, setNewStart] = useState('09:00');
  const [newEnd, setNewEnd] = useState('17:00');
  const [savingRule, setSavingRule] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await adminFetchJson<{ rules: Rule[] }>(rulesBase);
      setRules(r.rules);
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

          <DaySchedule slug={slug} rules={rules} />
        </div>
      )}
    </>
  );
}
