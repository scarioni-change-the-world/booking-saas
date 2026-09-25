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
 *
 * A business that has never set either keeps them off until it does — the
 * summary below only ever says what is actually saved, never more. But
 * opening "Change" should not hand back two empty boxes for something the
 * system already knows: every business gets both set to the address it
 * signed up with the moment it is created (src/lib/db/console.ts,
 * backfilled for ones that already existed by migration 0030), so a blank
 * field here is normally the exception, not the start. When one is still
 * blank — the business cleared it on purpose, or the migration could not
 * resolve an owner — it opens pre-filled with the address the caller is
 * signed in as: a suggestion to keep, change, or clear, never claimed as
 * already on until it is actually saved.
 */
export function EmailAddresses({ slug, onSaved }: { slug: string; onSaved?: (a: Addresses) => void }) {
  const url = `/api/admin/${slug}/settings`;
  const [saved, setSaved] = useState<Addresses | null>(null);
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
  const [form, setForm] = useState({ notificationEmail: '', replyToEmail: '' });
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminFetchJson<{ settings: Addresses | null; signedInEmail: string | null }>(url)
      .then((r) => {
        setSignedInEmail(r.signedInEmail);
        if (!r.settings) return;
        setSaved(r.settings);
        setForm({
          notificationEmail: r.settings.notificationEmail ?? r.signedInEmail ?? '',
          replyToEmail: r.settings.replyToEmail ?? r.signedInEmail ?? '',
        });
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

  // Whether the box on screen is still just the suggestion (nothing saved
  // of the tenant's own yet) — the hint under it disappears the moment
  // somebody changes or clears it, so it never claims a value is already
  // saved when it isn't, and never nags once they've made a real choice.
  const suggestedNotify = !saved.notificationEmail && !!signedInEmail && form.notificationEmail === signedInEmail;
  const suggestedReply = !saved.replyToEmail && !!signedInEmail && form.replyToEmail === signedInEmail;

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
          {suggestedNotify && (
            <p className="field-note">Your own sign-in address — change it, or clear it to turn alerts off.</p>
          )}
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
          {suggestedReply && (
            <p className="field-note">Your own sign-in address — change it, or clear it to use the sending address.</p>
          )}
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
