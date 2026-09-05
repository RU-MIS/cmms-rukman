import { Router } from 'express';
import { body } from 'express-validator';
import { prisma } from '../../config/prisma';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok, created, ApiError } from '../../utils/response';
import { getPageParams, pageMeta } from '../../utils/pagination';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { writeAudit } from '../../middleware/audit';
import { nextDocNumber } from '../../utils/docNumber';
import { D } from '../../utils/money';

const router = Router();
router.use(requireAuth);

interface SalesOrderItemInput {
  productId: number;
  qty: number;
  rate: number;
  discount?: number;
  taxRate?: number;
}

router.get(
  '/',
  requirePermission('orders', 'view'),
  asyncHandler(async (req, res) => {
    const params = getPageParams(req);
    const status = req.query.status ? String(req.query.status) : undefined;
    const customerId = req.query.customerId ? Number(req.query.customerId) : undefined;
    const where: any = { ...(status ? { status } : {}), ...(customerId ? { customerId } : {}) };
    const [items, total] = await Promise.all([
      prisma.salesOrder.findMany({
        where,
        include: { customer: { select: { id: true, name: true } }, items: true },
        orderBy: { date: 'desc' },
        skip: params.skip,
        take: params.take,
      }),
      prisma.salesOrder.count({ where }),
    ]);
    ok(res, items, pageMeta(total, params));
  })
);

router.get(
  '/pending/tracking',
  requirePermission('orders', 'view'),
  asyncHandler(async (req, res) => {
    const orders = await prisma.salesOrder.findMany({
      where: { status: { in: ['PENDING', 'PARTIAL'] } },
      include: { customer: { select: { id: true, name: true } }, items: { include: { product: { select: { id: true, name: true } } } } },
      orderBy: { dueDate: 'asc' },
    });
    const now = new Date();
    const rows = orders.flatMap((order) =>
      order.items
        .filter((item) => Number(item.deliveredQty) < Number(item.orderedQty))
        .map((item) => ({
          orderId: order.id,
          orderNo: order.orderNo,
          orderDate: order.date,
          customer: order.customer.name,
          product: item.product.name,
          orderedQty: item.orderedQty,
          deliveredQty: item.deliveredQty,
          pendingQty: Number(item.orderedQty) - Number(item.deliveredQty),
          dueDate: order.dueDate,
          overdue: order.dueDate ? order.dueDate < now : false,
          status: order.status,
        }))
    );
    const summary = {
      totalPending: rows.length,
      dueToday: rows.filter((r) => r.dueDate && new Date(r.dueDate).toDateString() === now.toDateString()).length,
      overdue: rows.filter((r) => r.overdue).length,
      partiallyDelivered: rows.filter((r) => Number(r.deliveredQty) > 0).length,
    };
    ok(res, rows, summary);
  })
);

router.get(
  '/:id',
  requirePermission('orders', 'view'),
  asyncHandler(async (req, res) => {
    const order = await prisma.salesOrder.findUnique({
      where: { id: Number(req.params.id) },
      include: { customer: true, items: { include: { product: { include: { unit: true } } } }, sales: { select: { id: true, invoiceNo: true, date: true } } },
    });
    if (!order) throw new ApiError(404, 'Sales order not found');
    ok(res, order);
  })
);

router.post(
  '/',
  requirePermission('orders', 'create'),
  [body('customerId').isInt(), body('items').isArray({ min: 1 })],
  validate,
  asyncHandler(async (req, res) => {
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    const items: SalesOrderItemInput[] = req.body.items;
    const overallDiscount = D(req.body.discount ?? 0);

    let subtotal = D(0);
    let taxTotal = D(0);
    const computedItems = items.map((item) => {
      const lineBase = D(item.qty).mul(item.rate).minus(item.discount ?? 0);
      const lineTax = lineBase.mul(item.taxRate ?? 0).div(100);
      subtotal = subtotal.plus(lineBase);
      taxTotal = taxTotal.plus(lineTax);
      return {
        productId: item.productId,
        orderedQty: D(item.qty),
        rate: D(item.rate),
        discount: D(item.discount ?? 0),
        taxRate: D(item.taxRate ?? 0),
        taxAmount: lineTax,
        total: lineBase.plus(lineTax),
      };
    });
    const grandTotal = subtotal.minus(overallDiscount).plus(taxTotal);

    const order = await prisma.$transaction(async (tx) => {
      const orderNo = await nextDocNumber(tx, settings?.soPrefix || 'SO');
      return tx.salesOrder.create({
        data: {
          orderNo,
          date: req.body.date ? new Date(req.body.date) : new Date(),
          dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null,
          customerId: req.body.customerId,
          subtotal,
          discount: overallDiscount,
          taxAmount: taxTotal,
          grandTotal,
          remarks: req.body.remarks,
          items: { create: computedItems },
        },
        include: { items: true },
      });
    });

    await writeAudit(req, 'CREATE', 'sales_orders', order.id, undefined, order);
    created(res, order);
  })
);

router.post(
  '/:id/cancel',
  requirePermission('orders', 'edit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const order = await prisma.salesOrder.update({ where: { id }, data: { status: 'CANCELLED' } });
    await writeAudit(req, 'UPDATE', 'sales_orders.status', id, undefined, order);
    ok(res, order);
  })
);

export default router;
