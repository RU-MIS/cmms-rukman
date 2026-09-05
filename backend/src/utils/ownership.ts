import { ApiError } from './response';

/**
 * Guards against cross-tenant foreign-key injection: a request body can name
 * any id for a related record (customerId, unitId, accountId, ...), and
 * without this check that id is written as-is with no proof it belongs to
 * the caller's own company. Tenant-scoped models are already
 * company-filtered by the Prisma extension (config/prisma.ts) on every
 * read, so a `findUnique` for a record that exists but belongs to another
 * company already comes back null — this just turns that null into a clear
 * 400 instead of letting the caller's id flow into a write unchecked.
 */
export function assertOwned<T>(record: T | null | undefined, label: string): T {
  if (!record) throw new ApiError(400, `Invalid ${label}`);
  return record;
}
