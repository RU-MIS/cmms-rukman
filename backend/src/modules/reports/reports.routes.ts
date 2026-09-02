import { Router } from 'express';
import dayjs from 'dayjs';
import { prisma } from '../../config/prisma';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok } from '../../utils/response';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { D } from '../../utils/money';

const router = Router();
router.use(requireAuth);

function dateRange(req: any) {
  const to = req.query.toDate ? dayjs(String(req.query.toDate)) : dayjs();
  const from = req.query.fromDate ? dayjs(String(req.query.fromDate)) : to.subtract(29, 'day');
  return { from: from.startOf('day'), to: to.endOf('day') };
}

router.get(
  '/date-wise',
  requirePermission('reports', 'view'),
  asyncHandler(async (req, res) => {
    const { from, to } = dateRange(req);
    const [sales, purchases, payments, stockTxns, production, expenses] = await Promise.all([
      prisma.sale.findMany({ where: { date: { gte: from.toDate(), lte: to.toDate() }, status: 'CONFIRMED' } }),
      prisma.purchase.findMany({ where: { date: { gte: from.toDate(), lte: to.toDate() }, status: 'CONFIRMED' } }),
      prisma.payment.findMany({ where: { date: { gte: from.toDate(), lte: to.toDate() } } }),
      prisma.stockTransaction.findMany({ where: { date: { gte: from.toDate(), lte: to.toDate() } } }),
      prisma.productionPlan.findMany({ where: { updatedAt: { gte: from.toDate(), lte: to.toDate() }, completedQty: { gt: 0 } } }),
      prisma.expense.findMany({ where: { date: { gte: from.toDate(), lte: to.toDate() } } }),
    ]);

    const days: Record<string, any> = {};
    let cursor = from.clone();
    while (cursor.isBefore(to) || cursor.isSame(to, 'day')) {
      const key = cursor.format('YYYY-MM-DD');
      days[key] = { date: key, sales: D(0), purchase: D(0), collection: D(0), payment: D(0), stockIn: D(0), stockOut: D(0), production: D(0), expenses: D(0) };
      cursor = cursor.add(1, 'day');
    }
    const key = (d: Date) => dayjs(d).format('YYYY-MM-DD');

    for (const s of sales) if (days[key(s.date)]) days[key(s.date)].sales = days[key(s.date)].sales.plus(s.grandTotal);
    for (const p of purchases) if (days[key(p.date)]) days[key(p.date)].purchase = days[key(p.date)].purchase.plus(p.grandTotal);
    for (const p of payments) {
      if (!days[key(p.date)]) continue;
      if (p.direction === 'RECEIVED') days[key(p.date)].collection = days[key(p.date)].collection.plus(p.amount);
      else days[key(p.date)].payment = days[key(p.date)].payment.plus(p.amount);
    }
    for (const t of stockTxns) {
      if (!days[key(t.date)]) continue;
      days[key(t.date)].stockIn = days[key(t.date)].stockIn.plus(t.qtyIn);
      days[key(t.date)].stockOut = days[key(t.date)].stockOut.plus(t.qtyOut);
    }
    for (const pr of production) if (days[key(pr.updatedAt)]) days[key(pr.updatedAt)].production = days[key(pr.updatedAt)].production.plus(pr.completedQty);
    for (const e of expenses) if (days[key(e.date)]) days[key(e.date)].expenses = days[key(e.date)].expenses.plus(e.amount);

    const rows = Object.values(days)
      .sort((a: any, b: any) => (a.date < b.date ? -1 : 1))
      .map((r: any) => ({ ...r, netSales: r.sales.minus(r.expenses) }));
    ok(res, rows);
  })
);

router.get(
  '/customer-wise',
  requirePermission('reports', 'view'),
  asyncHandler(async (req, res) => {
    const { from, to } = dateRange(req);
    const customers = await prisma.customer.findMany({
      include: {
        sales: { where: { date: { gte: from.toDate(), lte: to.toDate() }, status: 'CONFIRMED' } },
        saleReturns: { where: { date: { gte: from.toDate(), lte: to.toDate() } } },
        payments: { where: { date: { gte: from.toDate(), lte: to.toDate() } } },
      },
    });
    const rows = customers
      .map((c) => {
        const sales = c.sales.reduce((s, x) => s.plus(x.grandTotal), D(0));
        const paid = c.payments.reduce((s, x) => s.plus(x.amount), D(0));
        const returns = c.saleReturns.reduce((s, x) => s.plus(x.totalAmount), D(0));
        const outstandingAllTime = D(c.openingBalance);
        return { id: c.id, customer: c.name, sales, payments: paid, returns, outstanding: outstandingAllTime.plus(sales).minus(paid).minus(returns) };
      })
      .filter((r) => Number(r.sales) !== 0 || Number(r.payments) !== 0 || Number(r.returns) !== 0);
    ok(res, rows);
  })
);

router.get(
  '/vendor-wise',
  requirePermission('reports', 'view'),
  asyncHandler(async (req, res) => {
    const { from, to } = dateRange(req);
    const vendors = await prisma.vendor.findMany({
      include: {
        purchases: { where: { date: { gte: from.toDate(), lte: to.toDate() }, status: 'CONFIRMED' } },
        purchaseReturns: { where: { date: { gte: from.toDate(), lte: to.toDate() } } },
        payments: { where: { date: { gte: from.toDate(), lte: to.toDate() } } },
      },
    });
    const rows = vendors
      .map((v) => {
        const purchases = v.purchases.reduce((s, x) => s.plus(x.grandTotal), D(0));
        const paid = v.payments.reduce((s, x) => s.plus(x.amount), D(0));
        const returns = v.purchaseReturns.reduce((s, x) => s.plus(x.totalAmount), D(0));
        return { id: v.id, vendor: v.name, purchases, payments: paid, returns, outstanding: D(v.openingBalance).plus(purchases).minus(paid).minus(returns) };
      })
      .filter((r) => Number(r.purchases) !== 0 || Number(r.payments) !== 0 || Number(r.returns) !== 0);
    ok(res, rows);
  })
);

router.get(
  '/product-wise',
  requirePermission('reports', 'view'),
  asyncHandler(async (req, res) => {
    const { from, to } = dateRange(req);
    const products = await prisma.product.findMany({
      include: { unit: true, stockTxns: { where: { date: { gte: from.toDate(), lte: to.toDate() } } } },
    });
    const rows = products.map((p) => {
      const sortedTxns = [...p.stockTxns].sort((a, b) => a.date.getTime() - b.date.getTime());
      const earliest = sortedTxns[0];
      const opening = earliest ? D(earliest.balanceAfter).minus(earliest.qtyIn).plus(earliest.qtyOut) : D(p.currentStock);
      const stockIn = p.stockTxns.filter((t) => ['STOCK_IN', 'OPENING', 'TRANSFER_IN'].includes(t.type)).reduce((s, t) => s.plus(t.qtyIn), D(0));
      const stockOut = p.stockTxns.filter((t) => ['STOCK_OUT', 'TRANSFER_OUT'].includes(t.type)).reduce((s, t) => s.plus(t.qtyOut), D(0));
      const production = p.stockTxns.filter((t) => t.type === 'PRODUCTION_IN').reduce((s, t) => s.plus(t.qtyIn), D(0));
      const salesQty = p.stockTxns.filter((t) => t.type === 'SALE').reduce((s, t) => s.plus(t.qtyOut), D(0));
      const purchaseQty = p.stockTxns.filter((t) => t.type === 'PURCHASE').reduce((s, t) => s.plus(t.qtyIn), D(0));
      const returns = p.stockTxns
        .filter((t) => ['SALE_RETURN', 'PURCHASE_RETURN'].includes(t.type))
        .reduce((s, t) => s.plus(t.qtyIn).minus(t.qtyOut), D(0));
      return {
        id: p.id,
        product: p.name,
        unit: p.unit.shortName,
        opening,
        stockIn: stockIn.plus(purchaseQty),
        stockOut: stockOut.plus(salesQty),
        production,
        returns,
        closing: p.currentStock,
      };
    });
    ok(res, rows);
  })
);

export default router;
