'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
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

interface Member {
  userId: string;
  email: string | null;
  role: 'owner' | 'admin' | 'member';
  createdAt: string;
}

const PLANS: Tenant['plan'][] = ['trial', 'starter', 'pro', 'cancelled'];
const ROLES: Member['role'][] = ['owner', 'admin', 'member'];

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export default function ConsoleTenantPage() {
  const { id } = useParams<{ id: string }>();

  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [detailsForm, setDetailsForm] = useState({ name: '', timezone: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingDetails, setSavingDetails] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);

  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [addingMember, setAddingMember] = useState(false);
  const [memberForm, setMemberForm] = useState({ email: '', role: 'member' as Member['role'] });
  const [savingMember, setSavingMember] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await adminFetchJson<{ tenant: Tenant }>(`/api/console/tenants/${id}`);
      setTenant(result.tenant);
      setDetailsForm({ name: result.tenant.name, timezone: result.tenant.timezone });
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function loadMembers() {
    setMembersLoading(true);
    try {
      const result = await adminFetchJson<{ members: Member[] }>(`/api/console/tenants/${id}/members`);
      setMembers(result.members);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setMembersLoading(false);
    }
  }

  useEffect(() => {
    void load();
    void loadMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- id is stable for the life of this page
  }, [id]);

  async function submitDetails(event: React.FormEvent) {
    event.preventDefault();
    setSavingDetails(true);
    setError(null);
    try {
      const result = await adminFetchJson<{ tenant: Tenant }>(`/api/console/tenants/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(detailsForm),
      });
      setTenant(result.tenant);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSavingDetails(false);
    }
  }

  async function toggleStatus() {
    if (!tenant) return;
    const next = tenant.status === 'active' ? 'suspended' : 'active';
    if (next === 'suspended' && !window.confirm(`Suspend ${tenant.name}? Their booking page and dashboard will stop working immediately.`)) {
      return;
    }
    setTogglingStatus(true);
    setError(null);
    try {
      const result = await adminFetchJson<{ tenant: Tenant }>(`/api/console/tenants/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      setTenant(result.tenant);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setTogglingStatus(false);
    }
  }

  async function changePlan(plan: Tenant['plan']) {
    setSavingPlan(true);
    setError(null);
    try {
      const result = await adminFetchJson<{ tenant: Tenant }>(`/api/console/tenants/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      setTenant(result.tenant);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSavingPlan(false);
    }
  }

  async function submitAddMember(event: React.FormEvent) {
    event.preventDefault();
    setSavingMember(true);
    setError(null);
    try {
      await adminFetchJson(`/api/console/tenants/${id}/members`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(memberForm),
      });
      setMemberForm({ email: '', role: 'member' });
      setAddingMember(false);
      await loadMembers();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSavingMember(false);
    }
  }

  async function removeMember(m: Member) {
    if (!window.confirm(`Remove ${m.email ?? 'this person'}'s access to ${tenant?.name}?`)) return;
    setRemovingId(m.userId);
    setError(null);
    try {
      await adminFetchJson(`/api/console/tenants/${id}/members/${m.userId}`, { method: 'DELETE' });
      await loadMembers();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <>
      <a href="/console" className="btn-link" style={{ padding: 0, fontSize: '0.85rem' }}>
        ← All businesses
      </a>

      <div className="admin-page-head" style={{ marginTop: 10 }}>
        <div>
          <div className="admin-eyebrow">{tenant?.slug ?? '…'}</div>
          <h1>{tenant?.name ?? 'Loading…'}</h1>
        </div>
      </div>

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}

      {loading && <p className="status">Loading…</p>}

      {!loading && tenant && (
        <>
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="admin-card-title">Status</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
              <span
                className="notice"
                style={{
                  padding: '4px 11px',
                  margin: 0,
                  background: tenant.status === 'active' ? 'var(--status-live-tint)' : 'var(--status-attention-tint)',
                  color: tenant.status === 'active' ? 'var(--status-live-ink)' : 'var(--status-attention-ink)',
                }}
              >
                {tenant.status === 'active' ? 'Active' : tenant.status === 'suspended' ? 'Suspended' : 'Deleted'}
              </span>
              <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
                joined {dateFormat.format(new Date(tenant.createdAt))}
              </span>
            </div>

            {tenant.status !== 'deleted' && (
              <button
                type="button"
                className={tenant.status === 'active' ? 'btn-secondary' : 'btn-primary'}
                disabled={togglingStatus}
                onClick={toggleStatus}
              >
                {togglingStatus
                  ? 'Working…'
                  : tenant.status === 'active'
                    ? 'Suspend this business'
                    : 'Reactivate this business'}
              </button>
            )}
            {tenant.status === 'active' && (
              <p style={{ margin: '10px 0 0', fontSize: '0.85rem', color: 'var(--muted)' }}>
                Suspending immediately hides their booking page and locks their whole team out of the
                dashboard. Reactivating undoes both.
              </p>
            )}

            <div style={{ marginTop: 18 }}>
              <label htmlFor="plan" style={{ fontSize: '0.85rem', color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
                Plan
              </label>
              <select
                id="plan"
                value={tenant.plan}
                disabled={savingPlan}
                onChange={(e) => changePlan(e.target.value as Tenant['plan'])}
              >
                {PLANS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <form className="card" onSubmit={submitDetails} style={{ marginBottom: 14 }}>
            <div className="admin-card-title">Business details</div>

            <div className="admin-field-row">
              <div className="field">
                <label htmlFor="detail-name">Name</label>
                <input
                  id="detail-name"
                  type="text"
                  required
                  value={detailsForm.name}
                  onChange={(e) => setDetailsForm({ ...detailsForm, name: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="detail-timezone">Time zone</label>
                <input
                  id="detail-timezone"
                  type="text"
                  required
                  value={detailsForm.timezone}
                  onChange={(e) => setDetailsForm({ ...detailsForm, timezone: e.target.value })}
                />
              </div>
            </div>

            <p style={{ fontSize: '0.85rem', color: 'var(--faint)', margin: '-4px 0 14px' }}>
              Web address ({tenant.slug}) can&apos;t be changed here — it&apos;s their live booking link.
            </p>

            <div className="actions">
              <button type="submit" className="btn-primary" disabled={savingDetails}>
                {savingDetails ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>

          <div className="card">
            <div className="admin-page-head" style={{ marginBottom: 14 }}>
              <div className="admin-card-title" style={{ margin: 0 }}>
                Who has access
              </div>
              {!addingMember && (
                <button type="button" className="btn-secondary" onClick={() => setAddingMember(true)}>
                  Add someone
                </button>
              )}
            </div>

            {addingMember && (
              <form onSubmit={submitAddMember} className="admin-field-row" style={{ alignItems: 'flex-end', marginBottom: 16 }}>
                <div className="field">
                  <label htmlFor="member-email">Email</label>
                  <input
                    id="member-email"
                    type="email"
                    required
                    value={memberForm.email}
                    onChange={(e) => setMemberForm({ ...memberForm, email: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="member-role">Role</label>
                  <select
                    id="member-role"
                    value={memberForm.role}
                    onChange={(e) => setMemberForm({ ...memberForm, role: e.target.value as Member['role'] })}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="actions" style={{ margin: 0 }}>
                  <button type="submit" className="btn-primary" disabled={savingMember}>
                    {savingMember ? 'Inviting…' : 'Invite'}
                  </button>
                  <button type="button" className="btn-link" onClick={() => setAddingMember(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {membersLoading && <p className="status">Loading…</p>}

            {!membersLoading && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {members.map((m) => (
                  <div
                    key={m.userId}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '0.95rem' }}>{m.email ?? m.userId}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--faint)', textTransform: 'capitalize' }}>
                        {m.role}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn-link"
                      disabled={removingId === m.userId}
                      onClick={() => removeMember(m)}
                    >
                      {removingId === m.userId ? 'Removing…' : 'Remove'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
