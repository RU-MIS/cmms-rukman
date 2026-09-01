import { Router } from 'express';
import dayjs from 'dayjs';
import { prisma } from '../../config/prisma';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok } from '../../utils/response';
import { requireAuth } from '../../middleware/auth';
import { D } from '../../utils/money';

const router = Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const todayStart = dayjs().startOf('day').toDate();
    const todayEnd = dayjs().endOf('day').toDate();
    const trendStart = dayjs().subtract(13, 'day').startOf('day').toDate();

    const [
      todaySales,
      todayPurchases,
      todayPayments,
      customers,
      vendors,
      products,
      pendingSalesOrders,
      pendingPurchaseOrders,
      trendSales,
      trendPurchases,
      trendPayments,
      recentExpenses,
      topProductAgg,
      topCustomerAgg,
      categories,
    ] = await Promise.all([
      prisma.sale.aggregate({ _sum: { grandTotal: true }, where: { date: { gte: todayStart, lte: todayEnd }, status: 'CONFIRMED' } }),
      prisma.purchase.aggregate({ _sum: { grandTotal: true }, where: { date: { gte: todayStart, lte: todayEnd }, status: 'CONFIRMED' } }),
      prisma.payment.findMany({ where: { date: { gte: todayStart, lte: todayEnd } } }),
      prisma.customer.findMany({ where: { active: true }, include: { sales: { where: { status: 'CONFIRMED' } }, payments: true, saleReturns: true } }),
      prisma.vendor.findMany({ where: { active: true }, include: { purchases: { where: { status: 'CONFIRMED' } }, payments: true, purchaseReturns: true } }),
      prisma.product.findMany({ where: { active: true }, include: { category: true } }),
      prisma.salesOrder.count({ where: { status: { in: ['PENDING', 'PARTIAL'] } } }),
      prisma.purchaseOrder.count({ where: { status: { in: ['PENDING', 'PARTIAL'] } } }),
      prisma.sale.findMany({ where: { date: { gte: trendStart }, status: 'CONFIRMED' }, select: { date: true, grandTotal: true } }),
      prisma.purchase.findMany({ where: { date: { gte: trendStart }, status: 'CONFIRMED' }, select: { date: true, grandTotal: true } }),
      prisma.payment.findMany({ where: { date: { gte: trendStart } }, select: { date: true, amount: true, direction: true } }),
      prisma.expense.findMany({ where: { date: { gte: trendStart } } }),
      prisma.saleItem.groupBy({ by: ['productId'], _sum: { total: true, qty: true }, orderBy: { _sum: { total: 'desc' } }, take: 5 }),
      prisma.sale.groupBy({ by: ['customerId'], _sum: { grandTotal: true }, orderBy: { _sum: { grandTotal: 'desc' } }, take: 5, where: { status: 'CONFIRMED' } }),
      prisma.productCategory.findMany({ include: { products: { where: { active: true } } } }),
    ]);

    const todayCollection = todayPayments.filter((p) => p.direction === 'RECEIVED').reduce((s, p) => s.plus(p.amount), D(0));
    const todayPayment = todayPayments.filter((p) => p.direction === 'PAID').reduce((s, p) => s.plus(p.amount), D(0));

    const totalReceivable = customers.reduce((sum, c) => {
      const sales = c.sales.reduce((s, x) => s.plus(x.grandTotal), D(0));
      const paid = c.payments.reduce((s, x) => s.plus(x.amount), D(0));
      const returns = c.saleReturns.reduce((s, x) => s.plus(x.totalAmount), D(0));
      return sum.plus(D(c.openingBalance).plus(sales).minus(paid).minus(returns));
    }, D(0));

    const totalPayable = vendors.reduce((sum, v) => {
      const purchases = v.purchases.reduce((s, x) => s.plus(x.grandTotal), D(0));
      const paid = v.payments.reduce((s, x) => s.plus(x.amount), D(0));
      const returns = v.purchaseReturns.reduce((s, x) => s.plus(x.totalAmount), D(0));
      return sum.plus(D(v.openingBalance).plus(purchases).minus(paid).minus(returns));
    }, D(0));

    const totalStockValue = products.reduce((sum, p) => sum.plus(D(p.currentStock).mul(p.purchaseRate)), D(0));
    const lowStockCount = products.filter((p) => Number(p.currentStock) <= Number(p.reorderLevel)).length;

    const days: string[] = [];
    for (let i = 13; i >= 0; i--) days.push(dayjs().subtract(i, 'day').format('YYYY-MM-DD'));
    const trend = days.map((d) => {
      const sales = trendSales.filter((s) => dayjs(s.date).format('YYYY-MM-DD') === d).reduce((s, x) => s.plus(x.grandTotal), D(0));
      const purchase = trendPurchases.filter((p) => dayjs(p.date).format('YYYY-MM-DD') === d).reduce((s, x) => s.plus(x.grandTotal), D(0));
      const collection = trendPayments.filter((p) => dayjs(p.date).format('YYYY-MM-DD') === d && p.direction === 'RECEIVED').reduce((s, x) => s.plus(x.amount), D(0));
      const expense = recentExpenses.filter((e) => dayjs(e.date).format('YYYY-MM-DD') === d).reduce((s, x) => s.plus(x.amount), D(0));
      return { date: d, sales, purchase, collection, expense, profit: sales.minus(expense) };
    });

    const productIds = topProductAgg.map((t) => t.productId);
    const productDetails = await prisma.product.findMany({ where: { id: { in: productIds } } });
    const topProducts = topProductAgg.map((t) => ({
      product: productDetails.find((p) => p.id === t.productId)?.name ?? 'Unknown',
      amount: t._sum.total ?? 0,
      qty: t._sum.qty ?? 0,
    }));

    const customerIds = topCustomerAgg.map((t) => t.customerId);
    const customerDetails = await prisma.customer.findMany({ where: { id: { in: customerIds } } });
    const topCustomers = topCustomerAgg.map((t) => ({
      customer: customerDetails.find((c) => c.id === t.customerId)?.name ?? 'Unknown',
      amount: t._sum.grandTotal ?? 0,
    }));

    const stockDistribution = categories.map((c) => ({
      category: c.name,
      value: c.products.reduce((s, p) => s.plus(D(p.currentStock).mul(p.purchaseRate)), D(0)),
    })).filter((c) => Number(c.value) > 0);

    ok(res, {
      cards: {
        todaySales: todaySales._sum.grandTotal ?? 0,
        todayPurchase: todayPurchases._sum.grandTotal ?? 0,
        todayCollection,
        todayPayment,
        totalReceivable,
        totalPayable,
        totalStockValue,
        pendingSalesOrders,
        pendingPurchaseOrders,
        lowStockCount,
      },
      trend,
      topProducts,
      topCustomers,
      stockDistribution,
    });
  })
);

export default router;
