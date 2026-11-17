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
  trialEndsAt: string | null;
  freeAccess: boolean;
  founding: boolean;
  billing: Billing;
  renewsAt: string | null;
}

type Billing = 'free' | 'trial' | 'active' | 'past_due' | 'cancelled';

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
  const [deletedNote, setDeletedNote] = useState<string | null>(null);

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
    // Back from deleting a business: say what was done, once.
    const note = new URLSearchParams(window.location.search).get('deleted');
    if (note) {
      setDeletedNote(note);
      window.history.replaceState(null, '', '/console/businesses');
    }
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

      {deletedNote && (
        <p className="notice notice-muted" role="status">
          {deletedNote}
        </p>
      )}

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

      {/* Account and billing facts only: nothing from inside a business. */}
      {!loading && tenants.length > 0 && <Businesses tenants={tenants} />}
    </>
  );
}

const BILLING_LABEL: Record<Billing, string> = {
  trial: 'Trial',
  active: 'Paying',
  past_due: 'Payment failed',
  cancelled: 'Cancelled',
  free: 'Free access',
};

type Filter = 'all' | 'trial' | 'paying' | 'past_due' | 'cancelled';
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'trial', label: 'Trial' },
  { id: 'paying', label: 'Paying' },
  { id: 'past_due', label: 'Payment failed' },
  { id: 'cancelled', label: 'Cancelled' },
];

/** What needs the owner first: a failed payment, then a trial about to end. */
function urgency(t: Tenant): number {
  if (t.billing === 'past_due') return 0;
  if (t.billing === 'trial' && t.trialEndsAt) {
    const days = (new Date(t.trialEndsAt).getTime() - Date.now()) / 86_400_000;
    if (days >= 0 && days <= 7) return 1;
  }
  return 2;
}

/** A trial that ran out without a subscription: no access until they pay. */
function trialOver(t: Tenant): boolean {
  return t.billing === 'trial' && !!t.trialEndsAt && new Date(t.trialEndsAt).getTime() < Date.now();
}

/** When this business's next billing moment is, in words. */
function nextDate(t: Tenant): string {
  if (t.billing === 'trial' && t.trialEndsAt) {
    const end = new Date(t.trialEndsAt);
    return end.getTime() < Date.now() ? `Trial ended ${dateFormat.format(end)}` : `Trial ends ${dateFormat.format(end)}`;
  }
  if ((t.billing === 'active' || t.billing === 'past_due') && t.renewsAt) return `Renews ${dateFormat.format(new Date(t.renewsAt))}`;
  return '';
}

/**
 * Every business, one line each: its name, address, plan and billing. The
 * owner's privacy rule: nothing from inside a business shows here, not its
 * services, hours, clients or bookings.
 */
function Businesses({ tenants }: { tenants: Tenant[] }) {
  const [filter, setFilter] = useState<Filter>('all');
  const match = (t: Tenant) =>
    filter === 'all' ||
    (filter === 'paying' ? t.billing === 'active' || t.billing === 'past_due' : t.billing === filter);
  const shown = tenants.filter(match).sort((a, b) => urgency(a) - urgency(b));
  const count = (f: Filter) =>
    tenants.filter((t) =>
      f === 'all' ? true : f === 'paying' ? t.billing === 'active' || t.billing === 'past_due' : t.billing === f,
    ).length;

  return (
    <>
      <div className="wk-mode cb-filter" role="group" aria-label="Show">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className="filter-chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label} <span className="cb-count">{count(f.id)}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="notice notice-muted">None.</p>
      ) : (
        <ul className="cb-rows">
          {shown.map((t) => {
            const flag = urgency(t) < 2;
            return (
              <li key={t.id}>
                <a className="cb-row" href={`/console/${t.id}`}>
                  <span className="cb-name">
                    <b>{t.name}</b>
                    <small>/{t.slug}</small>
                  </span>
                  <span className={`cb-billing is-${trialOver(t) ? 'cancelled' : t.billing}${flag ? ' is-need' : ''}`}>
                    {trialOver(t) ? 'Trial ended' : BILLING_LABEL[t.billing]}
                    {t.founding && t.billing !== 'free' ? ' · founding' : ''}
                    {t.status === 'suspended' ? ' · suspended' : ''}
                  </span>
                  <span className="cb-date">{nextDate(t)}</span>
                  <span className="cb-joined">Joined {dateFormat.format(new Date(t.createdAt))}</span>
                  <span className="sp-go" aria-hidden="true">›</span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
