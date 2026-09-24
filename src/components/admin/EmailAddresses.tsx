'use client';

import { useEffect, useState } from 'react';
import { adminFetchJson } from '@/lib/admin-fetch';

interface Addresses {
  notificationEmail: string | null;
  replyToEmail: string | null;
}

/**
 * Where the business hears about bookings, and where clients' replies go —
 * on Messages, beside the emails they apply to. Blank means "don't": no
 * alert, or replies to the address the mail was sent from.
 */
export function EmailAddresses({ slug, onSaved }: { slug: string; onSaved?: (a: Addresses) => void }) {
  const url = `/api/admin/${slug}/settings`;
  const [saved, setSaved] = useState<Addresses | null>(null);
  const [form, setForm] = useState({ notificationEmail: '', replyToEmail: '' });
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminFetchJson<{ settings: Addresses | null }>(url)
      .then((r) => {
        if (!r.settings) return;
        setSaved(r.settings);
        setForm({ notificationEmail: r.settings.notificationEmail ?? '', replyToEmail: r.settings.replyToEmail ?? '' });
      })
      .catch((cause) => setError((cause as Error).message));
  }, [url]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await adminFetchJson<{ settings: Addresses }>(url, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          notificationEmail: form.notificationEmail || null,
          replyToEmail: form.replyToEmail || null,
        }),
      });
      setSaved(result.settings);
      setEditing(false);
      onSaved?.(result.settings);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!saved) return error ? <p className="notice notice-error">{error}</p> : null;

  if (!editing) {
    return (
      <p className="ms-addresses">
        New-booking alerts go to <b>{saved.notificationEmail ?? 'nobody'}</b>. Clients’ replies go to{' '}
        <b>{saved.replyToEmail ?? 'the address the email came from'}</b>.{' '}
        <button type="button" className="btn-link" onClick={() => setEditing(true)}>
          Change
        </button>
      </p>
    );
  }

  return (
    <form className="ms-addresses-form" onSubmit={save}>
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      <div className="admin-field-row">
        <div className="field">
          <label htmlFor="addr-notify">Send new-booking alerts to</label>
          <input
            id="addr-notify"
            type="email"
            placeholder="Leave blank for none"
            value={form.notificationEmail}
            onChange={(e) => setForm({ ...form, notificationEmail: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="addr-reply">Clients’ replies go to</label>
          <input
            id="addr-reply"
            type="email"
            placeholder="Leave blank to use the sending address"
            value={form.replyToEmail}
            onChange={(e) => setForm({ ...form, replyToEmail: e.target.value })}
          />
        </div>
      </div>
      <div className="wk-actions" style={{ marginTop: 0 }}>
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn-link" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
