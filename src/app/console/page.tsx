'use client';

import { useEffect, useState } from 'react';
import { adminFetchJson } from '@/lib/admin-fetch';
import { MiniFlow } from '@/components/console/MiniFlow';
import { Lamp } from '@/components/admin/Instruments';
import type { MiniFlow as MiniFlowModel } from '@/lib/tenant-health';

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
  flow: MiniFlowModel | null;
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

const STATUS_LABEL: Record<Tenant['status'], string> = {
  active: 'Active',
  suspended: 'Suspended',
  deleted: 'Deleted',
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

      {/* Every business as its own small flow, worst first, so the list is
          a queue: where the line breaks is where to look. Counts, dates and
          fixed phrases — no client, no address, no question, no answer.
          Every support case worth chasing is a shape, and none of them
          needs a name. */}
      {!loading && tenants.length > 0 && <Businesses tenants={tenants} health={health} />}
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


function Businesses({ tenants, health }: { tenants: Tenant[]; health: HealthPayload | null }) {
  const byId = new Map((health?.tenants ?? []).map((h) => [h.id, h]));
  /* Health's order is worst first; anything it does not know about follows. */
  const ordered = [
    ...(health?.tenants ?? []).map((h) => tenants.find((t) => t.id === h.id)).filter((t): t is Tenant => !!t),
    ...tenants.filter((t) => !byId.has(t.id)),
  ];
  const needsLook = (health?.tenants ?? []).filter((h) => h.findings.length > 0).length;

  return (
    <>
      <p className="section-note" style={{ maxWidth: '72ch' }}>
        {tenants.length} {tenants.length === 1 ? 'business' : 'businesses'}
        {health
          ? needsLook === 0
            ? ', none of them stuck.'
            : `, ${needsLook} worth a look — worst first.`
          : '.'}{' '}
        Each is drawn as its own flow from counts alone: where the line breaks is what stops their bookings.
        Never anybody&apos;s clients or answers.
      </p>
      <div className="biz-grid">
        {ordered.map((t) => {
          const h = byId.get(t.id);
          const stopped = h?.findings.some((f) => f.severity === 'stopped');
          return (
            <article key={t.id} className={`biz-card${stopped ? ' is-stopped' : h && h.findings.length > 0 ? ' is-watch' : ''}`}>
              <div className="biz-card-head">
                <a href={`/console/${t.id}`}>{t.name}</a>
                {/* Paused by us, not broken: a ring, like a paused service. */}
                {t.status !== 'active' && (
                  <span className="fc-state">
                    <Lamp tone="off" />
                    {STATUS_LABEL[t.status]}
                  </span>
                )}
              </div>
              <p className="biz-card-meta">
                {t.slug} · {t.plan} · joined {dateFormat.format(new Date(t.createdAt))}
              </p>
              {h?.flow && <MiniFlow flow={h.flow} />}
              {h?.flow && <p className="biz-card-sentence">{h.flow.sentence}</p>}
              {h && h.findings.length > 1 && (
                <ul className="biz-card-findings">
                  {h.findings.slice(1).map((f) => (
                    <li key={f.headline}>{f.headline}</li>
                  ))}
                </ul>
              )}
              <div className="biz-card-foot">
                <a href={`/console/${t.id}`}>Open</a>
                {/* Their booking page is public, so this is the one place a
                    support person can see what a client sees without asking
                    anybody's permission for anything. */}
                <a href={`/t/${t.slug}`} target="_blank" rel="noreferrer">
                  Their booking page →
                </a>
                {h?.activity && (
                  <span className="wk-muted">
                    Last booking {sinceLabel(h.activity.lastBookingAt)}
                  </span>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
