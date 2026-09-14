import { describe, expect, it } from 'vitest';
import { tenantIsGated } from '@/lib/billing-gate';

const HOUR = 60 * 60 * 1000;

describe('tenantIsGated', () => {
  it('never gates a tenant with free_access, regardless of plan', () => {
    expect(
      tenantIsGated({ plan: 'trial', free_access: true, trial_ends_at: new Date(Date.now() - HOUR).toISOString() }),
    ).toBe(false);
    expect(tenantIsGated({ plan: 'cancelled', free_access: true, trial_ends_at: null })).toBe(false);
  });

  it('gates a cancelled plan', () => {
    expect(tenantIsGated({ plan: 'cancelled', free_access: false, trial_ends_at: null })).toBe(true);
  });

  it('does not gate a trial tenant before trial_ends_at', () => {
    const future = new Date(Date.now() + HOUR).toISOString();
    expect(tenantIsGated({ plan: 'trial', free_access: false, trial_ends_at: future })).toBe(false);
  });

  it('gates a trial tenant once past trial_ends_at', () => {
    const past = new Date(Date.now() - HOUR).toISOString();
    expect(tenantIsGated({ plan: 'trial', free_access: false, trial_ends_at: past })).toBe(true);
  });

  it('does not gate a trial tenant with no trial_ends_at set — unknown is not expired', () => {
    expect(tenantIsGated({ plan: 'trial', free_access: false, trial_ends_at: null })).toBe(false);
  });

  it('never gates a paid plan (starter, pro), regardless of trial_ends_at', () => {
    const past = new Date(Date.now() - HOUR).toISOString();
    expect(tenantIsGated({ plan: 'starter', free_access: false, trial_ends_at: past })).toBe(false);
    expect(tenantIsGated({ plan: 'pro', free_access: false, trial_ends_at: past })).toBe(false);
  });
});
