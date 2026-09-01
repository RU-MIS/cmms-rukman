import { Router } from 'express';
import { prisma } from '../../config/prisma';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok, ApiError } from '../../utils/response';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { D } from '../../utils/money';

const router = Router();
router.use(requireAuth);

function ageingBucket(days: number) {
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

router.get(
  '/customers',
  requirePermission('payments', 'view'),
  asyncHandler(async (_req, res) => {
    const customers = await prisma.customer.findMany({
      where: { active: true },
      include: { sales: { where: { status: 'CONFIRMED' } }, saleReturns: true },
    });
    const now = new Date();
    const rows = customers
      .map((c) => {
        const salesTotal = c.sales.reduce((sum, s) => sum.plus(s.grandTotal), D(0));
        const paidTotal = c.sales.reduce((sum, s) => sum.plus(s.paidAmount), D(0));
        const returnsTotal = c.saleReturns.reduce((sum, r) => sum.plus(r.totalAmount), D(0));
        const outstanding = D(c.openingBalance).plus(salesTotal).minus(paidTotal).minus(returnsTotal);
        const ageing = { '0-30': D(0), '31-60': D(0), '61-90': D(0), '90+': D(0) };
        for (const sale of c.sales) {
          const due = D(sale.grandTotal).minus(sale.paidAmount);
          if (due.lte(0)) continue;
          const days = Math.floor((now.getTime() - new Date(sale.date).getTime()) / 86400000);
          ageing[ageingBucket(days)] = ageing[ageingBucket(days)].plus(due);
        }
        return { id: c.id, code: c.code, name: c.name, outstanding, ageing };
      })
      .filter((r) => Number(r.outstanding) !== 0);
    ok(res, rows);
  })
);

router.get(
  '/vendors',
  requirePermission('payments', 'view'),
  asyncHandler(async (_req, res) => {
    const vendors = await prisma.vendor.findMany({
      where: { active: true },
      include: { purchases: { where: { status: 'CONFIRMED' } }, purchaseReturns: true },
    });
    const now = new Date();
    const rows = vendors
      .map((v) => {
        const purchaseTotal = v.purchases.reduce((sum, p) => sum.plus(p.grandTotal), D(0));
        const paidTotal = v.purchases.reduce((sum, p) => sum.plus(p.paidAmount), D(0));
        const returnsTotal = v.purchaseReturns.reduce((sum, r) => sum.plus(r.totalAmount), D(0));
        const outstanding = D(v.openingBalance).plus(purchaseTotal).minus(paidTotal).minus(returnsTotal);
        const ageing = { '0-30': D(0), '31-60': D(0), '61-90': D(0), '90+': D(0) };
        for (const purchase of v.purchases) {
          const due = D(purchase.grandTotal).minus(purchase.paidAmount);
          if (due.lte(0)) continue;
          const days = Math.floor((now.getTime() - new Date(purchase.date).getTime()) / 86400000);
          ageing[ageingBucket(days)] = ageing[ageingBucket(days)].plus(due);
        }
        return { id: v.id, code: v.code, name: v.name, outstanding, ageing };
      })
      .filter((r) => Number(r.outstanding) !== 0);
    ok(res, rows);
  })
);

router.get(
  '/customers/:id/ledger',
  requirePermission('payments', 'view'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new ApiError(404, 'Customer not found');

    const [sales, payments, returns] = await Promise.all([
      prisma.sale.findMany({ where: { customerId: id, status: 'CONFIRMED' } }),
      prisma.payment.findMany({ where: { customerId: id } }),
      prisma.saleReturn.findMany({ where: { customerId: id } }),
    ]);

    const entries = [
      ...sales.map((s) => ({ date: s.date, type: 'Sale', reference: s.invoiceNo, debit: D(s.grandTotal), credit: D(0) })),
      ...payments.map((p) => ({ date: p.date, type: 'Payment', reference: p.paymentNo, debit: D(0), credit: D(p.amount) })),
      ...returns.map((r) => ({ date: r.date, type: 'Sale Return', reference: r.returnNo, debit: D(0), credit: D(r.totalAmount) })),
    ].sort((a, b) => a.date.getTime() - b.date.getTime());

    let balance = D(customer.openingBalance);
    const ledger = [
      { date: customer.createdAt, type: 'Opening Balance', reference: '-', debit: D(customer.openingBalance), credit: D(0), balance },
      ...entries.map((e) => {
        balance = balance.plus(e.debit).minus(e.credit);
        return { ...e, balance };
      }),
    ];
    ok(res, { customer, ledger, closingBalance: balance });
  })
);

router.get(
  '/vendors/:id/ledger',
  requirePermission('payments', 'view'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const vendor = await prisma.vendor.findUnique({ where: { id } });
    if (!vendor) throw new ApiError(404, 'Vendor not found');

    const [purchases, payments, returns] = await Promise.all([
      prisma.purchase.findMany({ where: { vendorId: id, status: 'CONFIRMED' } }),
      prisma.payment.findMany({ where: { vendorId: id } }),
      prisma.purchaseReturn.findMany({ where: { vendorId: id } }),
    ]);

    // Accounts-payable convention: credit increases what we owe the vendor
    // (purchases), debit decreases it (payments made, purchase returns).
    const entries = [
      ...purchases.map((p) => ({ date: p.date, type: 'Purchase', reference: p.billNo, debit: D(0), credit: D(p.grandTotal) })),
      ...payments.map((p) => ({ date: p.date, type: 'Payment', reference: p.paymentNo, debit: D(p.amount), credit: D(0) })),
      ...returns.map((r) => ({ date: r.date, type: 'Purchase Return', reference: r.returnNo, debit: D(r.totalAmount), credit: D(0) })),
    ].sort((a, b) => a.date.getTime() - b.date.getTime());

    let balance = D(vendor.openingBalance);
    const ledger = [
      { date: vendor.createdAt, type: 'Opening Balance', reference: '-', debit: D(0), credit: D(vendor.openingBalance), balance },
      ...entries.map((e) => {
        balance = balance.plus(e.credit).minus(e.debit);
        return { ...e, balance };
      }),
    ];
    ok(res, { vendor, ledger, closingBalance: balance });
  })
);

export default router;
