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
import { getSettings } from '../settings/settings.service';
import { updateSalesOrderProgress } from '../orders/orderProgress';

const router = Router();
router.use(requireAuth);

interface SaleItemInput {
  productId: number;
  qty: number;
  rate: number;
  discount?: number;
  taxRate?: number;
}

router.get(
  '/',
  requirePermission('sales', 'view'),
  asyncHandler(async (req, res) => {
    const params = getPageParams(req);
    const search = String(req.query.search ?? '').trim();
    const customerId = req.query.customerId ? Number(req.query.customerId) : undefined;
    const fromDate = req.query.fromDate ? new Date(String(req.query.fromDate)) : undefined;
    const toDate = req.query.toDate ? new Date(String(req.query.toDate)) : undefined;

    const where: any = {
      ...(customerId ? { customerId } : {}),
      ...(fromDate || toDate ? { date: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } } : {}),
      ...(search
        ? { OR: [{ invoiceNo: { contains: search } }, { customer: { name: { contains: search } } }] }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.sale.findMany({
        where,
        include: { customer: { select: { id: true, name: true, code: true } } },
        orderBy: { date: 'desc' },
        skip: params.skip,
        take: params.take,
      }),
      prisma.sale.count({ where }),
    ]);
    ok(res, items, pageMeta(total, params));
  })
);

router.get(
  '/:id',
  requirePermission('sales', 'view'),
  asyncHandler(async (req, res) => {
    const sale = await prisma.sale.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        customer: true,
        items: { include: { product: { include: { unit: true } } } },
        returns: true,
        paymentAllocations: { include: { payment: true } },
      },
    });
    if (!sale) throw new ApiError(404, 'Sale not found');
    ok(res, sale);
  })
);

router.post(
  '/',
  requirePermission('sales', 'create'),
  [
    body('customerId').isInt(),
    body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const items: SaleItemInput[] = req.body.items;
    const overallDiscount = D(req.body.discount ?? 0);

    const products = await prisma.product.findMany({ where: { id: { in: items.map((i) => i.productId) } } });
    const productMap = new Map(products.map((p) => [p.id, p]));
    for (const item of items) {
      if (!productMap.has(item.productId)) throw new ApiError(400, `Invalid product id ${item.productId}`);
      if (!(item.qty > 0)) throw new ApiError(400, 'Item quantity must be greater than zero');
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
        qty: D(item.qty),
        rate: D(item.rate),
        discount: D(item.discount ?? 0),
        taxRate: D(item.taxRate ?? 0),
        taxAmount: lineTax,
        total: lineBase.plus(lineTax),
      };
    });
    const grandTotal = subtotal.minus(overallDiscount).plus(taxTotal);
    const paidAmount = D(req.body.paidAmount ?? 0);
    if (paidAmount.gt(grandTotal)) throw new ApiError(400, 'Paid amount cannot exceed the grand total');

    const settings = await getSettings();

    const sale = await prisma.$transaction(async (tx) => {
      const invoiceNo = await nextDocNumber(tx, settings.invoicePrefix);
      const created = await tx.sale.create({
        data: {
          invoiceNo,
          date: req.body.date ? new Date(req.body.date) : new Date(),
          customerId: req.body.customerId,
          warehouseId: req.body.warehouseId || null,
          subtotal,
          discount: overallDiscount,
          taxAmount: taxTotal,
          grandTotal,
          paidAmount,
          salesOrderId: req.body.salesOrderId || null,
          remarks: req.body.remarks,
          createdById: req.user!.id,
          items: { create: computedItems },
        },
        include: { items: true },
      });

      for (const item of computedItems) {
        const product = productMap.get(item.productId)!;
        const newStock = D(product.currentStock).minus(item.qty);
        await tx.product.update({ where: { id: item.productId }, data: { currentStock: newStock } });
        await tx.stockTransaction.create({
          data: {
            productId: item.productId,
            warehouseId: req.body.warehouseId || null,
            type: 'SALE',
            qtyOut: item.qty,
            balanceAfter: newStock,
            rate: item.rate,
            reference: invoiceNo,
            createdById: req.user!.id,
          },
        });
        productMap.set(item.productId, { ...product, currentStock: newStock as any });
      }

      if (req.body.salesOrderId) {
        for (const item of computedItems) {
          await tx.salesOrderItem.updateMany({
            where: { salesOrderId: req.body.salesOrderId, productId: item.productId },
            data: { deliveredQty: { increment: item.qty } },
          });
        }
        await updateSalesOrderProgress(tx, req.body.salesOrderId);
      }

      if (paidAmount.gt(0)) {
        const paymentNo = await nextDocNumber(tx, settings.paymentPrefix);
        const payment = await tx.payment.create({
          data: {
            paymentNo,
            partyType: 'CUSTOMER',
            customerId: req.body.customerId,
            direction: 'RECEIVED',
            amount: paidAmount,
            mode: req.body.paymentMode || 'CASH',
            remarks: `Payment at sale ${invoiceNo}`,
            createdById: req.user!.id,
          },
        });
        await tx.paymentAllocation.create({ data: { paymentId: payment.id, saleId: created.id, amount: paidAmount } });
      }

      return created;
    });

    await writeAudit(req, 'CREATE', 'sales', sale.id, undefined, sale);
    created(res, sale);
  })
);

router.post(
  '/:id/cancel',
  requirePermission('sales', 'delete'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const sale = await prisma.sale.findUnique({ where: { id }, include: { items: true } });
    if (!sale) throw new ApiError(404, 'Sale not found');
    if (sale.status === 'CANCELLED') throw new ApiError(400, 'Sale is already cancelled');
    if (Number(sale.paidAmount) > 0) {
      throw new ApiError(400, 'Cannot cancel a sale that has payments allocated. Record a sale return or reverse the payment first.');
    }

    await prisma.$transaction(async (tx) => {
      for (const item of sale.items) {
        const product = await tx.product.findUniqueOrThrow({ where: { id: item.productId } });
        const newStock = D(product.currentStock).plus(item.qty);
        await tx.product.update({ where: { id: item.productId }, data: { currentStock: newStock } });
        await tx.stockTransaction.create({
          data: {
            productId: item.productId,
            type: 'ADJUSTMENT',
            qtyIn: item.qty,
            balanceAfter: newStock,
            reference: sale.invoiceNo,
            remarks: 'Sale cancelled — stock reversed',
            createdById: req.user!.id,
          },
        });
      }
      await tx.sale.update({ where: { id }, data: { status: 'CANCELLED' } });
    });

    await writeAudit(req, 'UPDATE', 'sales.status', id, { status: sale.status }, { status: 'CANCELLED' });
    ok(res, { cancelled: true });
  })
);

export default router;
