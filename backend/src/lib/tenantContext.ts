import { AsyncLocalStorage } from 'async_hooks';

export interface TenantStore {
  companyId: number;
}

const tenantContext = new AsyncLocalStorage<TenantStore>();

export function getCurrentCompanyId(): number | undefined {
  return tenantContext.getStore()?.companyId;
}

export function runWithCompany<T>(companyId: number, fn: () => T): T {
  return tenantContext.run({ companyId }, fn);
}
