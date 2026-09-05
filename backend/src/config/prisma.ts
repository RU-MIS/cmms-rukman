import { PrismaClient } from '@prisma/client';
import { getCurrentCompanyId } from '../lib/tenantContext';

/**
 * Models with a `companyId` column. All standard operations on these models
 * get their tenant filter injected automatically by the extension below, so
 * the ~240 call sites across the app don't each need a manual `companyId`
 * filter. `CompanyUser`/`Company` are deliberately excluded — they span
 * companies by design. `DocumentCounter` is excluded too — it's keyed by a
 * compound (companyId, prefix) id handled directly in `utils/docNumber.ts`.
 */
const TENANT_MODELS = new Set([
  'Customer', 'Vendor', 'ProductCategory', 'Unit', 'Warehouse', 'Product',
  'Sale', 'Purchase', 'SaleReturn', 'PurchaseReturn', 'SalesOrder', 'PurchaseOrder',
  'Payment', 'Account', 'FundTransfer', 'StockTransaction', 'ProductionPlan',
  'Expense', 'EmailLog', 'AuditLog', 'Settings', 'Role', 'BomItem',
]);

const CREATE_ONE_OPS = new Set(['create']);
const CREATE_MANY_OPS = new Set(['createMany', 'createManyAndReturn']);
const WHERE_SCOPED_OPS = new Set([
  'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany',
  'update', 'updateMany', 'delete', 'deleteMany', 'count', 'aggregate', 'groupBy',
]);

function buildClient() {
  const rawPrisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

  return rawPrisma.$extends({
    name: 'tenantIsolation',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANT_MODELS.has(model)) return query(args);

          const companyId = getCurrentCompanyId();
          // No tenant in context (seed scripts, one-off maintenance scripts) —
          // let the call through unscoped rather than silently mangling it.
          if (companyId == null) return query(args);

          const a = args as any;
          if (CREATE_ONE_OPS.has(operation)) {
            a.data = { ...a.data, companyId };
          } else if (CREATE_MANY_OPS.has(operation)) {
            a.data = Array.isArray(a.data) ? a.data.map((d: any) => ({ ...d, companyId })) : { ...a.data, companyId };
          } else if (operation === 'upsert') {
            a.where = { ...a.where, companyId };
            a.create = { ...a.create, companyId };
          } else if (WHERE_SCOPED_OPS.has(operation)) {
            a.where = { ...a.where, companyId };
          }
          return query(a);
        },
      },
    },
  });
}

const globalForPrisma = global as unknown as { prisma?: ReturnType<typeof buildClient> };

export const prisma = globalForPrisma.prisma ?? buildClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/**
 * The `tx` type Prisma passes into `prisma.$transaction(async (tx) => ...)`
 * callbacks on our tenant-extended client — structurally different from the
 * stock `Prisma.TransactionClient` type, so helpers that accept a
 * transaction handle (e.g. `nextDocNumber`) must use this instead.
 */
export type PrismaTransactionClient = Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'>;
