'use client';

import { useEffect, useState } from 'react';
import { adminFetchJson } from '@/lib/admin-fetch';

interface Finding {
  severity: 'stopped' | 'watch';
  headline: string;
  detail?: string;
}

interface HealthRow {
  id: string;
  slug: string;
  name: string;
  findings: Finding[];
  activity: { lastBookingAt: string | null; lastEnquiryAt: string | null; activeServices: number } | null;
}

interface HealthPayload {
  windowDays: number;
  tenants: HealthRow[];
}

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

/**
 * Time zone starts empty rather than guessing New York. The real default is
 * whatever zone this browser is in, which is only knowable on the client —
 * filled in by the effect below, so the value here is never what anybody
 * actually submits.
 */
const EMPTY_FORM = { slug: '', name: '', timezone: '', ownerEmail: '' };

export default function ConsolePage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Every zone this browser knows, which is the same list the server
  // validates against (requireTimezone in api.ts calls the identical
  // Intl.supportedValuesOf). Reading it here rather than shipping a hardcoded
  // list means the two can't drift apart, and it makes an invalid choice
  // unreachable rather than merely rejected afterwards.
  //
  // Populated in an effect, not at module scope, for two reasons: this page
  // is prerendered, so module scope would run in Node and bake the server's
  // answer into the HTML; and the local zone differs between server and
  // browser, which is a hydration mismatch. Empty until mounted, which the
  // render below falls back to a plain text field for.
  const [zones, setZones] = useState<string[]>([]);
  const [localZone, setLocalZone] = useState('');

  useEffect(() => {
    let supported: string[] = [];
    try {
      supported = Intl.supportedValuesOf('timeZone');
    } catch {
      // Ancient browser. The text field still works, and the server still
      // checks — worse to type in, impossible to get wrong silently.
    }
    setZones(supported);

    const here = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
    setLocalZone(here);
    // Only as a default: never overwrite something already typed.
    setForm((current) => (current.timezone ? current : { ...current, timezone: here }));
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [result, healthResult] = await Promise.all([
        adminFetchJson<{ tenants: Tenant[] }>('/api/console/tenants'),
        /* Non-critical: the list is still worth showing without it, so a
           failure here leaves the panel out rather than the page. */
        adminFetchJson<HealthPayload>('/api/console/health').catch(() => null),
      ]);
      setTenants(result.tenants);
      setHealth(healthResult);
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
      setForm({ ...EMPTY_FORM, timezone: localZone });
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

      {/* What needs looking at, before the list of everybody.
       *
       * Counts, dates and fixed phrases — no client, no address, no
       * question, no answer. That is not a limitation worked around: every
       * support case worth chasing is a shape, and none of them need a
       * name. Reading somebody's client list to discover they have no
       * opening hours would be both a violation and a waste of time.
       *
       * Absent when nothing is wrong. A panel that says "all fine" every
       * day is a panel nobody reads on the day it doesn't. */}
      {health && <HealthPanel health={health} />}

      {creating && (
        <form className="card" onSubmit={submitCreate} style={{ marginBottom: 14 }}>
          <div className="admin-card-title">New business</div>
          <p style={{ fontSize: '0.9rem', color: 'var(--muted)', margin: '-4px 0 16px' }}>
            An owner who already has a login is added straight to this business. One who
            doesn&apos;t gets an email from Supabase to set a password — either way, nothing
            to send yourself.
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
              {zones.length > 0 ? (
                <select
                  id="new-timezone"
                  required
                  value={form.timezone}
                  onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                >
                  {zones.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id="new-timezone"
                  type="text"
                  required
                  placeholder="Europe/Madrid"
                  value={form.timezone}
                  onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                />
              )}
              <p className="tz">
                Every working hour and booking time is read in this zone.
                {localZone && form.timezone === localZone ? " Yours, by default." : ''}
              </p>
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
              {saving ? 'Creating…' : 'Create business'}
            </button>
            <button
              type="button"
              className="btn-link"
              onClick={() => {
                setCreating(false);
                setForm({ ...EMPTY_FORM, timezone: localZone });
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

/** "3 days ago", or "never". Dates, not contents. */
function sinceLabel(iso: string | null): string {
  if (!iso) return 'never';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

function HealthPanel({ health }: { health: HealthPayload }) {
  const needsLook = health.tenants.filter((t) => t.findings.length > 0);

  if (needsLook.length === 0) {
    return (
      <div className="health-panel is-quiet">
        <p>
          Nothing needs looking at. {health.tenants.length}{' '}
          {health.tenants.length === 1 ? 'business' : 'businesses'}, none of them stuck.
        </p>
      </div>
    );
  }

  return (
    <div className="health-panel">
      <div className="health-panel-head">
        <h2>Needs a look</h2>
        <p>
          {needsLook.length} of {health.tenants.length}, worst first. Configuration and
          delivery only — never anybody&apos;s clients or answers.
        </p>
      </div>

      <ul className="health-list">
        {needsLook.map((tenant) => {
          const stopped = tenant.findings.some((f) => f.severity === 'stopped');
          return (
            <li key={tenant.id} className={`health-row${stopped ? ' is-stopped' : ''}`}>
              <div className="health-row-head">
                <a className="health-row-name" href={`/console/${tenant.id}`}>
                  {tenant.name}
                </a>
                {/* Their booking page is public, so this is the one place a
                    support person can look at what a client sees without
                    asking anybody's permission for anything. */}
                <a
                  className="health-row-visit"
                  href={`/t/${tenant.slug}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  See their booking page →
                </a>
              </div>

              <ul className="health-findings">
                {tenant.findings.map((finding) => (
                  <li key={finding.headline} className={`is-${finding.severity}`}>
                    <strong>{finding.headline}</strong>
                    {finding.detail && <span>{finding.detail}</span>}
                  </li>
                ))}
              </ul>

              {tenant.activity && (
                <p className="health-row-activity">
                  Last booking {sinceLabel(tenant.activity.lastBookingAt)} · last enquiry{' '}
                  {sinceLabel(tenant.activity.lastEnquiryAt)} · {tenant.activity.activeServices}{' '}
                  {tenant.activity.activeServices === 1 ? 'service' : 'services'}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
