/**
 * Production demo-data cleanup.
 *
 * Finds the workspace created by `npm run seed` (identified by its exact,
 * hardcoded seed values — never by a fuzzy/partial match, so a buyer who
 * renamed or is actively using this company is never touched) and lets you
 * retire it before handing the system to a real buyer.
 *
 * Usage:
 *   npm run cleanup:demo                     # dry run — reports only, changes nothing
 *   npm run cleanup:demo -- --confirm         # deactivates the demo company (safe, reversible)
 *   npm run cleanup:demo -- --confirm --delete  # permanently deletes the demo company and all its data
 *
 * What "deactivate" does (the recommended default):
 *   Sets Company.active = false. The app already refuses login/switch-company
 *   into an inactive company everywhere, so it simply disappears from use.
 *   No rows are deleted, no schema is touched, and it can be reversed by
 *   flipping the flag back in the database if needed.
 *
 * What "--delete" does (opt-in, irreversible):
 *   Permanently deletes the demo Company row and every row under it. Most
 *   tables cascade from Company automatically via foreign keys, but several
 *   cross-references between sibling tables (e.g. Sale -> Customer, an item
 *   table -> Product) are intentionally NOT cascading — a plain
 *   `company.delete()` hits a foreign-key error partway through. So this
 *   script deletes in an explicit, dependency-safe order (line items before
 *   their transactions, transactions before the master data they reference,
 *   master data last) inside a single transaction, then deletes the Company
 *   row itself. DocumentCounter rows are included too, since that table has
 *   no FK relation to Company at all.
 *   Deleting also removes that company's audit log and email log history.
 *   Prefer --confirm without --delete unless you specifically want the
 *   data gone rather than just hidden.
 *
 * The global `admin` login (shared across companies by username) is never
 * deleted or deactivated by this script — doing so automatically risks
 * locking a buyer out entirely. If, after cleanup, that account has no
 * remaining company memberships, the script only reports that fact so you
 * can decide manually (e.g. leave it for the buyer's first login, since it
 * already forces a password change, or deactivate it yourself later).
 */
import { prisma } from '../src/config/prisma';

const DEMO_COMPANY_NAME = 'BusinessFlow ERP Demo Co.';
const DEMO_GSTIN = '27ABCDE1234F1Z5';

async function main() {
  const args = process.argv.slice(2);
  const confirm = args.includes('--confirm');
  const hardDelete = args.includes('--delete');

  const demoCompany = await prisma.company.findFirst({
    where: { name: DEMO_COMPANY_NAME, gstin: DEMO_GSTIN },
    orderBy: { id: 'asc' },
  });

  if (!demoCompany) {
    console.log(
      `No demo company found (looked for a company named "${DEMO_COMPANY_NAME}" with GSTIN "${DEMO_GSTIN}").\n` +
        'Either it was already cleaned up, or it was renamed/edited and is now treated as real data — nothing to do.'
    );
    return;
  }

  const [customers, vendors, products, sales, purchases, payments, users] = await Promise.all([
    prisma.customer.count({ where: { companyId: demoCompany.id } }),
    prisma.vendor.count({ where: { companyId: demoCompany.id } }),
    prisma.product.count({ where: { companyId: demoCompany.id } }),
    prisma.sale.count({ where: { companyId: demoCompany.id } }),
    prisma.purchase.count({ where: { companyId: demoCompany.id } }),
    prisma.payment.count({ where: { companyId: demoCompany.id } }),
    prisma.companyUser.findMany({
      where: { companyId: demoCompany.id },
      include: { user: { select: { id: true, username: true, email: true } } },
    }),
  ]);

  console.log(`Found demo company: "${demoCompany.name}" (id ${demoCompany.id}, active=${demoCompany.active})`);
  console.log(`  Customers: ${customers}, Vendors: ${vendors}, Products: ${products}`);
  console.log(`  Sales: ${sales}, Purchases: ${purchases}, Payments: ${payments}`);
  console.log(`  Members: ${users.map((u) => `${u.user.username} (userId ${u.user.id})`).join(', ') || 'none'}`);

  if (!confirm) {
    console.log('\nDry run only — nothing changed. Re-run with --confirm to deactivate this company,');
    console.log('or --confirm --delete to permanently delete it and all its data.');
    return;
  }

  if (hardDelete) {
    console.log('\n--delete passed: permanently deleting the demo company and all related data...');
    const id = demoCompany.id;
    await prisma.$transaction(async (tx) => {
      // 1. Line items and pure leaves — reference Sale/Purchase/etc. (cascades
      //    fine) but also Product, which does NOT cascade, so these must go
      //    before Product is deleted.
      await tx.paymentAllocation.deleteMany({ where: { payment: { companyId: id } } });
      await tx.saleItem.deleteMany({ where: { sale: { companyId: id } } });
      await tx.purchaseItem.deleteMany({ where: { purchase: { companyId: id } } });
      await tx.saleReturnItem.deleteMany({ where: { saleReturn: { companyId: id } } });
      await tx.purchaseReturnItem.deleteMany({ where: { purchaseReturn: { companyId: id } } });
      await tx.salesOrderItem.deleteMany({ where: { salesOrder: { companyId: id } } });
      await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrder: { companyId: id } } });
      await tx.bomItem.deleteMany({ where: { companyId: id } });
      await tx.stockTransaction.deleteMany({ where: { companyId: id } });
      await tx.productionPlan.deleteMany({ where: { companyId: id } });

      // 2. Rows that reference Sale/Purchase/Customer/Vendor/Account —
      //    must go before those.
      await tx.saleReturn.deleteMany({ where: { companyId: id } });
      await tx.purchaseReturn.deleteMany({ where: { companyId: id } });
      await tx.payment.deleteMany({ where: { companyId: id } });
      await tx.fundTransfer.deleteMany({ where: { companyId: id } });

      // 3. Sale/Purchase reference Customer/Vendor and SalesOrder/PurchaseOrder.
      await tx.sale.deleteMany({ where: { companyId: id } });
      await tx.purchase.deleteMany({ where: { companyId: id } });

      // 4. Orders reference Customer/Vendor.
      await tx.salesOrder.deleteMany({ where: { companyId: id } });
      await tx.purchaseOrder.deleteMany({ where: { companyId: id } });

      // 5. Now safe: master data nothing above still points at.
      await tx.customer.deleteMany({ where: { companyId: id } });
      await tx.vendor.deleteMany({ where: { companyId: id } });
      await tx.account.deleteMany({ where: { companyId: id } });
      await tx.product.deleteMany({ where: { companyId: id } });
      await tx.warehouse.deleteMany({ where: { companyId: id } });

      // 6. Depended on only by Product, now gone.
      await tx.productCategory.deleteMany({ where: { companyId: id } });
      await tx.unit.deleteMany({ where: { companyId: id } });

      // 7. No cross-table dependencies — safe standalone.
      await tx.expense.deleteMany({ where: { companyId: id } });
      await tx.emailLog.deleteMany({ where: { companyId: id } });
      await tx.auditLog.deleteMany({ where: { companyId: id } });

      // 8. Membership before Role (CompanyUser.roleId -> Role); RolePermission
      //    cascades automatically once Role is deleted.
      await tx.companyUser.deleteMany({ where: { companyId: id } });
      await tx.role.deleteMany({ where: { companyId: id } });

      // 9. No FK relation to Company at all — cleaned up explicitly.
      await tx.documentCounter.deleteMany({ where: { companyId: id } });

      // 10. Settings cascades fine on its own, then the company itself —
      //     nothing left pointing at it.
      await tx.company.delete({ where: { id } });
    });
    console.log('Demo company and its data have been permanently deleted.');
  } else {
    console.log('\n--confirm passed: deactivating the demo company (data preserved, hidden from login/use)...');
    await prisma.company.update({ where: { id: demoCompany.id }, data: { active: false } });
    console.log('Demo company deactivated. It will no longer appear at login or in switch-company.');
  }

  const orphanedAdmins = users.filter((u) => u.user.username === 'admin');
  if (orphanedAdmins.length > 0) {
    for (const m of orphanedAdmins) {
      const remaining = await prisma.companyUser.count({
        where: { userId: m.user.id, companyId: { not: demoCompany.id } },
      });
      if (remaining === 0) {
        console.log(
          `\nNote: the "admin" login (userId ${m.user.id}) now has no other company memberships. ` +
            'It has NOT been deleted or deactivated — decide manually whether to keep it for the buyer\'s ' +
            'first login (it already forces a password change) or deactivate it once real users exist.'
        );
      }
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
