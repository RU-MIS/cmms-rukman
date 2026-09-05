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
import { assertOwned } from '../../utils/ownership';

const router = Router();
router.use(requireAuth);

interface PurchaseOrderItemInput {
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
    const vendorId = req.query.vendorId ? Number(req.query.vendorId) : undefined;
    const where: any = { ...(status ? { status } : {}), ...(vendorId ? { vendorId } : {}) };
    const [items, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        include: { vendor: { select: { id: true, name: true } }, items: true },
        orderBy: { date: 'desc' },
        skip: params.skip,
        take: params.take,
      }),
      prisma.purchaseOrder.count({ where }),
    ]);
    ok(res, items, pageMeta(total, params));
  })
);

router.get(
  '/pending/tracking',
  requirePermission('orders', 'view'),
  asyncHandler(async (req, res) => {
    const orders = await prisma.purchaseOrder.findMany({
      where: { status: { in: ['PENDING', 'PARTIAL'] } },
      include: { vendor: { select: { id: true, name: true } }, items: { include: { product: { select: { id: true, name: true } } } } },
      orderBy: { dueDate: 'asc' },
    });
    const now = new Date();
    const rows = orders.flatMap((order) =>
      order.items
        .filter((item) => Number(item.receivedQty) < Number(item.orderedQty))
        .map((item) => ({
          orderId: order.id,
          orderNo: order.orderNo,
          orderDate: order.date,
          vendor: order.vendor.name,
          product: item.product.name,
          orderedQty: item.orderedQty,
          receivedQty: item.receivedQty,
          pendingQty: Number(item.orderedQty) - Number(item.receivedQty),
          dueDate: order.dueDate,
          overdue: order.dueDate ? order.dueDate < now : false,
          status: order.status,
        }))
    );
    ok(res, rows, {
      totalPending: rows.length,
      overdue: rows.filter((r) => r.overdue).length,
      partiallyReceived: rows.filter((r) => Number(r.receivedQty) > 0).length,
    });
  })
);

router.get(
  '/:id',
  requirePermission('orders', 'view'),
  asyncHandler(async (req, res) => {
    const order = await prisma.purchaseOrder.findUnique({
      where: { id: Number(req.params.id) },
      include: { vendor: true, items: { include: { product: { include: { unit: true } } } }, purchases: { select: { id: true, billNo: true, date: true } } },
    });
    if (!order) throw new ApiError(404, 'Purchase order not found');
    ok(res, order);
  })
);

router.post(
  '/',
  requirePermission('orders', 'create'),
  [body('vendorId').isInt(), body('items').isArray({ min: 1 })],
  validate,
  asyncHandler(async (req, res) => {
    const settings = await prisma.settings.findUnique({ where: { companyId: req.user!.companyId } });
    const items: PurchaseOrderItemInput[] = req.body.items;
    const overallDiscount = D(req.body.discount ?? 0);

    assertOwned(await prisma.vendor.findUnique({ where: { id: Number(req.body.vendorId) } }), 'vendor');
    const products = await prisma.product.findMany({ where: { id: { in: items.map((i) => i.productId) } } });
    const productIds = new Set(products.map((p) => p.id));
    for (const item of items) {
      if (!productIds.has(item.productId)) throw new ApiError(400, `Invalid product id ${item.productId}`);
    }

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
      const orderNo = await nextDocNumber(tx, req.user!.companyId, settings?.poPrefix || 'PO');
      return tx.purchaseOrder.create({
        data: {
          companyId: req.user!.companyId,
          orderNo,
          date: req.body.date ? new Date(req.body.date) : new Date(),
          dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null,
          vendorId: req.body.vendorId,
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

    await writeAudit(req, 'CREATE', 'purchase_orders', order.id, undefined, order);
    created(res, order);
  })
);

router.post(
  '/:id/cancel',
  requirePermission('orders', 'edit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const order = await prisma.purchaseOrder.update({ where: { id }, data: { status: 'CANCELLED' } });
    await writeAudit(req, 'UPDATE', 'purchase_orders.status', id, undefined, order);
    ok(res, order);
  })
);

export default router;
