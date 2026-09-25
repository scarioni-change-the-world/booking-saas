'use client';

import { useEffect, useState } from 'react';
import { adminFetchJson } from '@/lib/admin-fetch';
import { SlideScale } from '@/components/admin/Instruments';

interface Rules {
  bookingNoticeHours: number;
  bookingWindowDays: number;
}

/** The usual amounts of notice, as stops on the scale; any other amount gets its own. */
function noticeStops(current: number) {
  const values = [0, 12, 24, 48, 168];
  if (!values.includes(current)) values.push(current);
  return values.sort((a, b) => a - b).map((value) => ({ value, label: noticeLabel(value) }));
}

function noticeLabel(hours: number): string {
  if (hours === 0) return 'None';
  if (hours === 168) return '1 week';
  if (hours % 24 === 0) return hours === 24 ? '1 day' : `${hours / 24} days`;
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

function noticeWords(hours: number): string {
  if (hours === 0) return 'no notice';
  if (hours % 24 === 0) return hours === 24 ? '1 day’s notice' : `${hours / 24} days’ notice`;
  return hours === 1 ? '1 hour’s notice' : `${hours} hours’ notice`;
}

/**
 * How close to now, and how far ahead, people can book — on the Week,
 * beside the hours they narrow. Said as a sentence first and opened in
 * place to change, because they are set once and read often.
 */
export function BookingRules({ slug, onSaved }: { slug: string; onSaved?: () => void }) {
  const url = `/api/admin/${slug}/settings`;
  const [rules, setRules] = useState<Rules | null>(null);
  const [form, setForm] = useState<Rules>({ bookingNoticeHours: 24, bookingWindowDays: 60 });
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminFetchJson<{ settings: Rules | null }>(url)
      .then((r) => {
        if (r.settings) {
          setRules(r.settings);
          setForm({ bookingNoticeHours: r.settings.bookingNoticeHours, bookingWindowDays: r.settings.bookingWindowDays });
        }
      })
      .catch((cause) => setError((cause as Error).message));
  }, [url]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await adminFetchJson<{ settings: Rules }>(url, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      });
      setRules(result.settings);
      setEditing(false);
      onSaved?.();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!rules) return error ? <p className="notice notice-error">{error}</p> : null;

  return (
    <div className="bk-rules">
      {!editing ? (
        <>
          <SlideScale stops={noticeStops(rules.bookingNoticeHours)} current={rules.bookingNoticeHours} />
          <p className="wk-side-lead" style={{ margin: 0 }}>
            People can book with at least {noticeWords(rules.bookingNoticeHours)}, up to{' '}
            {rules.bookingWindowDays} days ahead.{' '}
            <button type="button" className="btn-link" onClick={() => setEditing(true)}>
              Change
            </button>
          </p>
        </>
      ) : (
        <form onSubmit={save}>
          {error && (
            <p className="notice notice-error" role="alert">
              {error}
            </p>
          )}
          <div className="field">
            <label htmlFor="rules-notice">Minimum notice (hours)</label>
            <input
              id="rules-notice"
              type="number"
              min={0}
              max={8760}
              required
              value={form.bookingNoticeHours}
              onChange={(e) => setForm({ ...form, bookingNoticeHours: Number(e.target.value) })}
            />
          </div>
          <div className="field">
            <label htmlFor="rules-window">How far ahead people can book (days)</label>
            <input
              id="rules-window"
              type="number"
              min={0}
              max={3650}
              required
              value={form.bookingWindowDays}
              onChange={(e) => setForm({ ...form, bookingWindowDays: Number(e.target.value) })}
            />
          </div>
          <p className="wk-side-hint" style={{ marginTop: 0 }}>
            With these, people could book from {noticeWords(form.bookingNoticeHours)} from now to{' '}
            {form.bookingWindowDays} days ahead.
          </p>
          <div className="wk-actions">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="btn-link" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
