// Public surface of the data layer. Note the absence of any raw client export —
// see the note in client.ts.
export { TenantScope, tenantScope } from './scope';
export { resolveTenantBySlug, resolveBookingByToken, type ResolvedTenant } from './tenants';
export * from './types';
