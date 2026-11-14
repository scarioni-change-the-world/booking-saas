'use client';

import { useState } from 'react';
import { adminFetchJson } from '@/lib/admin-fetch';
import { slugConfirmed } from '@/lib/business-deletion';

interface DeletionCheck {
  slug: string;
  blockers: string[];
  steps: string[];
}

interface Result {
  cancelled: number;
  refunded: number;
  loginsDeleted: number;
  ownersEmailed: number;
}

/**
 * Deleting a business for good, asked the way deleting a service is: what
 * stops it, or what will happen, line by line; then its web address typed
 * back. The route checks every one of these again before it deletes.
 */
export function DeleteBusiness({ id, name, onDeleted }: { id: string; name: string; onDeleted: (note: string) => void }) {
  const [open, setOpen] = useState(false);
  const [check, setCheck] = useState<DeletionCheck | null>(null);
  const [stage, setStage] = useState<'explain' | 'type'>('explain');
  const [typed, setTyped] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setOpen(true);
    setStage('explain');
    setTyped('');
    setError(null);
    setCheck(null);
    try {
      setCheck(await adminFetchJson<DeletionCheck>(`/api/console/tenants/${id}/deletion`));
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  function close() {
    setOpen(false);
    setError(null);
  }

  async function remove() {
    if (!check) return;
    setSaving(true);
    setError(null);
    try {
      const result = await adminFetchJson<Result>(`/api/console/tenants/${id}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmSlug: typed }),
      });
      const parts = [
        `${name} was deleted, and /${check.slug} is free.`,
        result.cancelled > 0 &&
          `${result.cancelled} ${result.cancelled === 1 ? 'appointment was' : 'appointments were'} cancelled and the clients emailed.`,
        result.refunded > 0 && `${result.refunded} paid online ${result.refunded === 1 ? "was" : "were"} refunded.`,
        result.loginsDeleted > 0 && `${result.loginsDeleted} ${result.loginsDeleted === 1 ? 'login' : 'logins'} deleted.`,
        result.ownersEmailed > 0 && 'The owner was emailed a confirmation.',
      ].filter(Boolean);
      onDeleted(parts.join(' '));
    } catch (cause) {
      setError((cause as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className="card con-danger">
      <div className="admin-card-title">Delete this business</div>
      {!open ? (
        <>
          <p className="con-danger-lede">
            Removes the business and all its data for good: clients, appointments, services and settings. Its web
            address becomes free again. It cannot be undone.
          </p>
          <button type="button" className="btn-secondary" onClick={() => void start()}>
            Delete this business…
          </button>
        </>
      ) : (
        <div className="fc-delete" role="region" aria-label={`Delete ${name}`}>
          {!check && !error && <p className="fc-hint">Checking what it still has…</p>}

          {check && check.blockers.length > 0 && (
            <>
              <p>
                <b>{name} can’t be deleted yet.</b>
              </p>
              <ul className="fc-delete-reasons">
                {check.blockers.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              <div className="fl-actions">
                <button type="button" className="btn-link" onClick={close}>
                  Close
                </button>
              </div>
            </>
          )}

          {check && check.blockers.length === 0 && stage === 'explain' && (
            <>
              <p>
                <b>Delete {name} for good?</b> It can’t be undone. This is what happens:
              </p>
              <ol className="con-danger-steps">
                {check.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <div className="fl-actions">
                <button type="button" className="btn-secondary" onClick={() => setStage('type')}>
                  Continue
                </button>
                <button type="button" className="btn-link" onClick={close}>
                  Keep it
                </button>
              </div>
            </>
          )}

          {check && check.blockers.length === 0 && stage === 'type' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (slugConfirmed(typed, check.slug)) void remove();
              }}
            >
              <div className="field">
                <label htmlFor="con-delete-slug">
                  To confirm, type its web address: <b>{check.slug}</b>
                </label>
                <input
                  id="con-delete-slug"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                />
              </div>
              <div className="fl-actions">
                <button type="submit" className="btn-danger" disabled={saving || !slugConfirmed(typed, check.slug)}>
                  {saving ? 'Deleting…' : 'Delete for good'}
                </button>
                <button type="button" className="btn-link" onClick={close} disabled={saving}>
                  Keep it
                </button>
              </div>
            </form>
          )}

          {error && (
            <p className="notice notice-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
