'use client';

import { useEffect, useState } from 'react';
import { adminFetchJson } from '@/lib/admin-fetch';
import { nameConfirmed } from '@/lib/service-deletion';

interface DeletionCheck {
  upcoming: number;
  owedSessions: number;
  past: number;
  blockers: string[];
  keeps: string;
}

/**
 * Deleting for good, asked twice: first what it means — or why it cannot
 * happen yet — then the service's name, typed back. The route checks every
 * one of these again before it deletes anything.
 */
export function DeleteService({
  slug,
  id,
  name,
  onCancel,
  onDeleted,
}: {
  slug: string;
  id: string;
  name: string;
  onCancel: () => void;
  onDeleted: (note: string) => void;
}) {
  const [check, setCheck] = useState<DeletionCheck | null>(null);
  const [stage, setStage] = useState<'explain' | 'type'>('explain');
  const [typed, setTyped] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminFetchJson<DeletionCheck>(`/api/admin/${slug}/event-types/${id}/deletion`)
      .then(setCheck)
      .catch((cause) => setError((cause as Error).message));
  }, [slug, id]);

  async function remove() {
    setSaving(true);
    setError(null);
    try {
      const result = await adminFetchJson<{ emailedTo: string | null; email: string }>(
        `/api/admin/${slug}/event-types/${id}`,
        {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ confirmName: typed }),
        },
      );
      onDeleted(
        result.email === 'sent' && result.emailedTo
          ? `${name} was deleted. A confirmation is on its way to ${result.emailedTo}.`
          : `${name} was deleted.`,
      );
    } catch (cause) {
      setError((cause as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className="fc-delete" role="region" aria-label={`Delete ${name}`}>
      {!check && !error && <p className="fc-hint">Checking what is still booked…</p>}

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
            {check.upcoming > 0 && (
              <a className="btn-secondary" href={`/admin/${slug}/week?view=list`}>
                See them on the Week
              </a>
            )}
            {check.owedSessions > 0 && (
              <a className="btn-secondary" href={`/admin/${slug}/people?show=owed`}>
                See who in People
              </a>
            )}
            <button type="button" className="btn-link" onClick={onCancel}>
              Close
            </button>
          </div>
        </>
      )}

      {check && check.blockers.length === 0 && stage === 'explain' && (
        <>
          <p>
            <b>Delete {name} for good?</b> It can’t be undone: it can never be resumed, and its settings and its
            own questions are removed. {check.keeps} Nobody is cancelled or emailed. You’ll get an email confirming
            it.
          </p>
          <div className="fl-actions">
            <button type="button" className="btn-secondary" onClick={() => setStage('type')}>
              Continue
            </button>
            <button type="button" className="btn-link" onClick={onCancel}>
              Keep it
            </button>
          </div>
        </>
      )}

      {check && check.blockers.length === 0 && stage === 'type' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (nameConfirmed(typed, name)) void remove();
          }}
        >
          <div className="field">
            <label htmlFor={`fc-delete-${id}`}>
              To confirm, type the service’s name: <b>{name}</b>
            </label>
            <input
              id={`fc-delete-${id}`}
              type="text"
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </div>
          <div className="fl-actions">
            <button type="submit" className="btn-danger" disabled={saving || !nameConfirmed(typed, name)}>
              {saving ? 'Deleting…' : 'Delete for good'}
            </button>
            <button type="button" className="btn-link" onClick={onCancel} disabled={saving}>
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
  );
}
