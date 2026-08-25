'use client';

import { useEffect, useState } from 'react';
import { adminFetchJson } from '@/lib/admin-fetch';

interface Tenant {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  plan: 'trial' | 'starter' | 'pro' | 'cancelled';
  status: 'active' | 'suspended' | 'deleted';
  createdAt: string;
}

const STATUS_TONE: Record<Tenant['status'], { label: string; bg: string; fg: string }> = {
  active: { label: 'Active', bg: 'var(--status-live-tint)', fg: 'var(--status-live-ink)' },
  suspended: { label: 'Suspended', bg: 'var(--status-attention-tint)', fg: 'var(--status-attention-ink)' },
  deleted: { label: 'Deleted', bg: 'var(--status-broken-tint)', fg: 'var(--status-broken)' },
};

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

const EMPTY_FORM = { slug: '', name: '', timezone: 'America/New_York', ownerEmail: '' };

export default function ConsolePage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await adminFetchJson<{ tenants: Tenant[] }>('/api/console/tenants');
      setTenants(result.tenants);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function submitCreate(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await adminFetchJson('/api/console/tenants', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
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

  return (
    <>
      <div className="admin-page-head">
        <div>
          <div className="admin-eyebrow">Businesses</div>
          <h1>Every business on the platform</h1>
        </div>
        {!creating && (
          <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
            Create business
          </button>
        )}
      </div>

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}

      {creating && (
        <form className="card" onSubmit={submitCreate} style={{ marginBottom: 14 }}>
          <div className="admin-card-title">New business</div>
          <p style={{ fontSize: '0.9rem', color: 'var(--muted)', margin: '-4px 0 16px' }}>
            The owner gets an email from Supabase to set their password and sign in — nothing to send
            yourself.
          </p>

          <div className="field">
            <label htmlFor="new-name">Business name</label>
            <input
              id="new-name"
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div className="admin-field-row">
            <div className="field">
              <label htmlFor="new-slug">Web address</label>
              <input
                id="new-slug"
                type="text"
                required
                placeholder="acme-coaching"
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })}
              />
            </div>
            <div className="field">
              <label htmlFor="new-timezone">Time zone</label>
              <input
                id="new-timezone"
                type="text"
                required
                placeholder="America/New_York"
                value={form.timezone}
                onChange={(e) => setForm({ ...form, timezone: e.target.value })}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="new-owner-email">Owner&apos;s email</label>
            <input
              id="new-owner-email"
              type="email"
              required
              value={form.ownerEmail}
              onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })}
            />
          </div>

          <div className="actions">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Creating…' : 'Create and invite owner'}
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

      {!loading && tenants.length === 0 && !creating && (
        <p className="notice notice-muted">No businesses yet.</p>
      )}

      <div className="admin-list">
        {tenants.map((t) => {
          const tone = STATUS_TONE[t.status];
          return (
            <a
              key={t.id}
              href={`/console/${t.id}`}
              className="card admin-row"
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 11, flexWrap: 'wrap' }}>
                  <h2 style={{ fontSize: '1.05rem' }}>{t.name}</h2>
                  <span style={{ fontSize: '0.8rem', color: 'var(--faint)' }}>{t.slug}</span>
                </div>
                <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--muted)' }}>
                  {t.timezone} · joined {dateFormat.format(new Date(t.createdAt))} · {t.plan}
                </p>
              </div>
              <span
                className="notice"
                style={{ padding: '4px 11px', margin: 0, background: tone.bg, color: tone.fg }}
              >
                {tone.label}
              </span>
            </a>
          );
        })}
      </div>
    </>
  );
}
