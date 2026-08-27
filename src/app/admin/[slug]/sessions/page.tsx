'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { adminFetchJson } from '@/lib/admin-fetch';
import Toggle from '@/components/admin/Toggle';
import type { SerializedEventType } from '@/lib/admin-serializers';

/** intro currently offers up to this many active session types per tenant —
 * a soft, UI-only guide while pricing tiers are still undecided, not a
 * database limit. See the note on the POST route. */
const SOFT_CAP = 3;

interface FormState {
  name: string;
  description: string;
  durationMinutes: string;
  bufferBeforeMinutes: string;
  bufferAfterMinutes: string;
  availableToProspects: boolean;
  availableToExistingClients: boolean;
}

const EMPTY_FORM: FormState = {
  name: '',
  description: '',
  durationMinutes: '30',
  bufferBeforeMinutes: '0',
  bufferAfterMinutes: '0',
  availableToProspects: false,
  availableToExistingClients: false,
};

export default function SessionsPage() {
  const { slug } = useParams<{ slug: string }>();

  const [types, setTypes] = useState<SerializedEventType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM);

  const base = `/api/admin/${slug}/event-types`;

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await adminFetchJson<{ eventTypes: SerializedEventType[] }>(base);
      setTypes(result.eventTypes);
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

  const activeCount = types.filter((t) => t.active).length;
  const atCap = activeCount >= SOFT_CAP;

  async function submitCreate(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await adminFetchJson(base, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          description: form.description || undefined,
          durationMinutes: Number(form.durationMinutes),
          bufferBeforeMinutes: Number(form.bufferBeforeMinutes),
          bufferAfterMinutes: Number(form.bufferAfterMinutes),
          availableToProspects: form.availableToProspects,
          availableToExistingClients: form.availableToExistingClients,
        }),
      });
      setForm(EMPTY_FORM);
      setCreating(false);
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function startEdit(type: SerializedEventType) {
    setEditingId(type.id);
    setEditForm({
      name: type.name,
      description: type.description ?? '',
      durationMinutes: String(type.durationMinutes),
      bufferBeforeMinutes: String(type.bufferBeforeMinutes),
      bufferAfterMinutes: String(type.bufferAfterMinutes),
      availableToProspects: type.availableToProspects,
      availableToExistingClients: type.availableToExistingClients,
    });
  }

  async function submitEdit(event: React.FormEvent, id: string) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await adminFetchJson(`${base}/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: editForm.name,
          description: editForm.description || null,
          durationMinutes: Number(editForm.durationMinutes),
          bufferBeforeMinutes: Number(editForm.bufferBeforeMinutes),
          bufferAfterMinutes: Number(editForm.bufferAfterMinutes),
        }),
      });
      setEditingId(null);
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  /** Flip one flag immediately — no need to enter edit mode for a toggle. */
  async function flip(type: SerializedEventType, field: keyof SerializedEventType) {
    setError(null);
    // Reflect the change at once; a failed request rolls it back below.
    setTypes((prev) =>
      prev.map((t) => (t.id === type.id ? { ...t, [field]: !t[field] } : t)),
    );
    try {
      await adminFetchJson(`${base}/${type.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [field]: !type[field] }),
      });
    } catch (cause) {
      setError((cause as Error).message);
      await load();
    }
  }

  return (
    <>
      <div className="admin-page-head">
        <div>
          <div className="admin-eyebrow">Sessions</div>
          <h1>What people can book</h1>
        </div>
        {!creating && (
          <button
            type="button"
            className="btn-primary"
            disabled={atCap}
            title={atCap ? `Up to ${SOFT_CAP} active session types for now` : undefined}
            onClick={() => setCreating(true)}
          >
            New session type
          </button>
        )}
      </div>

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}

      {atCap && !creating && (
        <p className="notice notice-muted">
          You&apos;re using all {SOFT_CAP} session types available right now. Archive one to
          make room for another.
        </p>
      )}

      {creating && (
        <form className="card" onSubmit={submitCreate} style={{ marginBottom: 14 }}>
          <div className="admin-card-title">New session type</div>

          <div className="field">
            <label htmlFor="new-name">Name</label>
            <input
              id="new-name"
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div className="field">
            <label htmlFor="new-description">Description (optional)</label>
            <textarea
              id="new-description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>

          <div className="admin-field-row">
            <div className="field">
              <label htmlFor="new-duration">Duration (minutes)</label>
              <input
                id="new-duration"
                type="text"
                inputMode="numeric"
                required
                value={form.durationMinutes}
                onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="new-buffer-before">Buffer before</label>
              <input
                id="new-buffer-before"
                type="text"
                inputMode="numeric"
                value={form.bufferBeforeMinutes}
                onChange={(e) => setForm({ ...form, bufferBeforeMinutes: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="new-buffer-after">Buffer after</label>
              <input
                id="new-buffer-after"
                type="text"
                inputMode="numeric"
                value={form.bufferAfterMinutes}
                onChange={(e) => setForm({ ...form, bufferAfterMinutes: e.target.value })}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 28, margin: '4px 0 18px' }}>
            <Toggle
              on={form.availableToProspects}
              label="Offered to new enquiries"
              onClick={() =>
                setForm({ ...form, availableToProspects: !form.availableToProspects })
              }
            />
            <Toggle
              on={form.availableToExistingClients}
              label="Offered to existing clients"
              onClick={() =>
                setForm({
                  ...form,
                  availableToExistingClients: !form.availableToExistingClients,
                })
              }
            />
          </div>

          <div className="actions">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Create'}
            </button>
            <button
              type="button"
              className="btn-link"
              onClick={() => {
                setCreating(false);
                setForm(EMPTY_FORM);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading && <p className="status">Loading…</p>}

      {!loading && types.length === 0 && !creating && (
        <p className="notice notice-muted">You haven&apos;t added any session types yet.</p>
      )}

      <div className="admin-list">
        {types.map((type) =>
          editingId === type.id ? (
            <form key={type.id} className="card" onSubmit={(e) => submitEdit(e, type.id)}>
              <div className="field">
                <label htmlFor={`edit-name-${type.id}`}>Name</label>
                <input
                  id={`edit-name-${type.id}`}
                  type="text"
                  required
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor={`edit-description-${type.id}`}>Description</label>
                <textarea
                  id={`edit-description-${type.id}`}
                  value={editForm.description}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                />
              </div>
              <div className="admin-field-row">
                <div className="field">
                  <label htmlFor={`edit-duration-${type.id}`}>Duration (minutes)</label>
                  <input
                    id={`edit-duration-${type.id}`}
                    type="text"
                    inputMode="numeric"
                    required
                    value={editForm.durationMinutes}
                    onChange={(e) =>
                      setEditForm({ ...editForm, durationMinutes: e.target.value })
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor={`edit-buffer-before-${type.id}`}>Buffer before</label>
                  <input
                    id={`edit-buffer-before-${type.id}`}
                    type="text"
                    inputMode="numeric"
                    value={editForm.bufferBeforeMinutes}
                    onChange={(e) =>
                      setEditForm({ ...editForm, bufferBeforeMinutes: e.target.value })
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor={`edit-buffer-after-${type.id}`}>Buffer after</label>
                  <input
                    id={`edit-buffer-after-${type.id}`}
                    type="text"
                    inputMode="numeric"
                    value={editForm.bufferAfterMinutes}
                    onChange={(e) =>
                      setEditForm({ ...editForm, bufferAfterMinutes: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="actions">
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button type="button" className="btn-link" onClick={() => setEditingId(null)}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div key={type.id} className={`card admin-row${type.active ? '' : ' archived'}`}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 11, flexWrap: 'wrap' }}>
                  <h2 style={{ fontSize: '1.1rem' }}>{type.name}</h2>
                  <span style={{ fontSize: '0.8rem', color: 'var(--faint)' }}>
                    {type.durationMinutes} min
                    {type.bufferBeforeMinutes || type.bufferAfterMinutes
                      ? ` · ${type.bufferBeforeMinutes}/${type.bufferAfterMinutes} min buffer`
                      : ''}
                  </span>
                  {!type.active && (
                    <span className="notice notice-muted" style={{ padding: '2px 9px', margin: 0 }}>
                      Archived
                    </span>
                  )}
                </div>
                {type.description && (
                  <p style={{ fontSize: '0.85rem', color: 'var(--muted)', margin: '6px 0 0' }}>
                    {type.description}
                  </p>
                )}

                <div style={{ display: 'flex', gap: 28, marginTop: 16, flexWrap: 'wrap' }}>
                  <Toggle
                    on={type.availableToProspects}
                    label="Offered to new enquiries"
                    onClick={() => flip(type, 'availableToProspects')}
                  />
                  <Toggle
                    on={type.availableToExistingClients}
                    label="Offered to existing clients"
                    onClick={() => flip(type, 'availableToExistingClients')}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button type="button" className="btn-secondary" onClick={() => startEdit(type)}>
                  Edit
                </button>
                <button type="button" className="btn-link" onClick={() => flip(type, 'active')}>
                  {type.active ? 'Archive' : 'Restore'}
                </button>
              </div>
            </div>
          ),
        )}
      </div>

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
          The two toggles are independent. A session can be offered to both new enquiries and
          existing clients, either one, or neither — new enquiries answer your screening
          questions first; existing clients book straight from their own private link.
        </p>
      </div>
    </>
  );
}
