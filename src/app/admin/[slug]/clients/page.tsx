'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { adminFetchJson } from '@/lib/admin-fetch';

interface Entitlement {
  id: string;
  eventTypeId: string;
  eventTypeName: string;
  totalSessions: number;
  usedSessions: number;
  remaining: number;
}

interface Client {
  id: string;
  name: string;
  email: string;
  accessToken: string;
  notes: string | null;
  createdAt: string;
  entitlements: Entitlement[];
}

interface EventType {
  id: string;
  name: string;
  active: boolean;
  bookingMode: 'single' | 'pack';
  packSize: number | null;
}

const EMPTY_CLIENT_FORM = { name: '', email: '' };
const EMPTY_GRANT_FORM = { eventTypeId: '', sessions: '10' };

export default function ClientsPage() {
  const { slug } = useParams<{ slug: string }>();
  const base = `/api/admin/${slug}/clients`;

  const [clients, setClients] = useState<Client[]>([]);
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_CLIENT_FORM);
  const [saving, setSaving] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [grantForm, setGrantForm] = useState(EMPTY_GRANT_FORM);
  const [granting, setGranting] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [clientsResult, typesResult] = await Promise.all([
        adminFetchJson<{ clients: Client[] }>(base),
        adminFetchJson<{ eventTypes: EventType[] }>(`/api/admin/${slug}/event-types`),
      ]);
      setClients(clientsResult.clients);
      setEventTypes(typesResult.eventTypes.filter((t) => t.active));
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

  async function submitCreate(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await adminFetchJson(base, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      });
      setForm(EMPTY_CLIENT_FORM);
      setCreating(false);
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function removeClient(client: Client) {
    if (!window.confirm(`Remove ${client.name} as a client? Their past bookings are kept.`)) return;
    setError(null);
    try {
      await adminFetchJson(`${base}/${client.id}`, { method: 'DELETE' });
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function submitGrant(event: React.FormEvent, clientId: string) {
    event.preventDefault();
    if (!grantForm.eventTypeId) return;
    setGranting(true);
    setError(null);
    try {
      await adminFetchJson(`${base}/${clientId}/entitlements`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          eventTypeId: grantForm.eventTypeId,
          sessions: Number(grantForm.sessions),
        }),
      });
      setGrantForm(EMPTY_GRANT_FORM);
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setGranting(false);
    }
  }

  async function removeEntitlement(clientId: string, entitlementId: string) {
    if (!window.confirm('Remove this package? This cannot be undone.')) return;
    setError(null);
    try {
      await adminFetchJson(`${base}/${clientId}/entitlements/${entitlementId}`, { method: 'DELETE' });
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  function bookingLink(client: Client): string {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/t/${slug}/client/${client.accessToken}`;
  }

  async function copyLink(client: Client) {
    try {
      await navigator.clipboard.writeText(bookingLink(client));
      setCopiedId(client.id);
      setTimeout(() => setCopiedId((id) => (id === client.id ? null : id)), 2000);
    } catch {
      window.prompt('Copy this link:', bookingLink(client));
    }
  }

  return (
    <>
      <div className="admin-page-head">
        <div>
          <div className="admin-eyebrow">Clients</div>
          <h1>People who keep coming back</h1>
        </div>
        {!creating && (
          <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
            Add client
          </button>
        )}
      </div>

      <p style={{ fontSize: '0.9rem', color: 'var(--muted)', margin: '-6px 0 18px', maxWidth: 620 }}>
        Someone who has bought a package of sessions. Add them, grant the package they paid for, and
        share their private link — it lets them book several sessions from that package in one visit.
      </p>

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}

      {creating && (
        <form className="card" onSubmit={submitCreate} style={{ marginBottom: 14 }}>
          <div className="admin-card-title">New client</div>
          <div className="admin-field-row">
            <div className="field">
              <label htmlFor="new-client-name">Name</label>
              <input
                id="new-client-name"
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="new-client-email">Email</label>
              <input
                id="new-client-email"
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
          </div>
          <div className="actions">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Adding…' : 'Add client'}
            </button>
            <button
              type="button"
              className="btn-link"
              onClick={() => {
                setCreating(false);
                setForm(EMPTY_CLIENT_FORM);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading && <p className="status">Loading…</p>}

      {!loading && clients.length === 0 && !creating && (
        <p className="notice notice-muted">No clients yet — add one once someone's bought a package.</p>
      )}

      {!loading && eventTypes.length === 0 && (
        <p className="notice notice-muted" style={{ marginBottom: 14 }}>
          You'll need at least one active session type before you can grant a package — set one up
          on the Sessions page first.
        </p>
      )}

      <div className="admin-list">
        {clients.map((client) => {
          const expanded = expandedId === client.id;
          return (
            <div key={client.id} className="card">
              <div className="admin-row" style={{ padding: 0 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 11, flexWrap: 'wrap' }}>
                    <h2 style={{ fontSize: '1.05rem' }}>{client.name}</h2>
                    <span style={{ fontSize: '0.8rem', color: 'var(--faint)' }}>{client.email}</span>
                  </div>

                  {client.entitlements.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                      {client.entitlements.map((e) => (
                        <span
                          key={e.id}
                          className="notice"
                          style={{
                            padding: '4px 11px',
                            margin: 0,
                            background: e.remaining > 0 ? 'var(--status-live-tint)' : 'var(--side)',
                            color: e.remaining > 0 ? 'var(--status-live-ink)' : 'var(--faint)',
                          }}
                        >
                          {e.eventTypeName}: {e.remaining}/{e.totalSessions} left
                        </span>
                      ))}
                    </div>
                  )}
                  {client.entitlements.length === 0 && (
                    <p style={{ margin: '10px 0 0', fontSize: '0.85rem', color: 'var(--faint)' }}>
                      No package granted yet.
                    </p>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setExpandedId(expanded ? null : client.id)}
                  >
                    {expanded ? 'Close' : 'Manage'}
                  </button>
                  <button type="button" className="btn-link" onClick={() => removeClient(client)}>
                    Remove
                  </button>
                </div>
              </div>

              {expanded && (
                <div style={{ marginTop: 18, paddingTop: 18, borderTop: '1px solid var(--border)' }}>
                  <div style={{ marginBottom: 18 }}>
                    <div style={{ fontSize: '0.82rem', color: 'var(--faint)', marginBottom: 6 }}>
                      Their private booking link
                    </div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <code
                        style={{
                          fontSize: '0.82rem',
                          background: 'var(--side)',
                          padding: '8px 11px',
                          borderRadius: 'var(--radius-sm)',
                          overflowWrap: 'anywhere',
                        }}
                      >
                        {bookingLink(client)}
                      </code>
                      <button type="button" className="btn-secondary" onClick={() => copyLink(client)}>
                        {copiedId === client.id ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>

                  {client.entitlements.length > 0 && (
                    <div style={{ marginBottom: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {client.entitlements.map((e) => (
                        <div
                          key={e.id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            fontSize: '0.9rem',
                          }}
                        >
                          <span>
                            {e.eventTypeName} — {e.usedSessions} of {e.totalSessions} used
                          </span>
                          <button
                            type="button"
                            className="btn-link"
                            onClick={() => removeEntitlement(client.id, e.id)}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {eventTypes.length > 0 && (
                    <form
                      onSubmit={(e) => submitGrant(e, client.id)}
                      className="admin-field-row"
                      style={{ alignItems: 'flex-end' }}
                    >
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label htmlFor={`grant-type-${client.id}`}>Grant a package for</label>
                        <select
                          id={`grant-type-${client.id}`}
                          required
                          value={grantForm.eventTypeId}
                          onChange={(e) => {
                            const eventTypeId = e.target.value;
                            // Suggest the session's own declared pack size as
                            // a starting point — still just a default, not a
                            // constraint, since the actual grant is a
                            // separate, manual step from the service's
                            // config (see the note on Sessions).
                            const matched = eventTypes.find((t) => t.id === eventTypeId);
                            setGrantForm({
                              eventTypeId,
                              sessions:
                                matched?.bookingMode === 'pack' && matched.packSize
                                  ? String(matched.packSize)
                                  : grantForm.sessions,
                            });
                          }}
                        >
                          <option value="" disabled>
                            Choose a session type
                          </option>
                          {eventTypes.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                              {t.bookingMode === 'pack' ? ` (pack of ${t.packSize})` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="field" style={{ marginBottom: 0, maxWidth: 120 }}>
                        <label htmlFor={`grant-sessions-${client.id}`}>Sessions</label>
                        <input
                          id={`grant-sessions-${client.id}`}
                          type="number"
                          min={1}
                          max={1000}
                          required
                          value={grantForm.sessions}
                          onChange={(e) => setGrantForm({ ...grantForm, sessions: e.target.value })}
                        />
                      </div>
                      <button type="submit" className="btn-primary" disabled={granting}>
                        {granting ? 'Granting…' : 'Grant'}
                      </button>
                    </form>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
