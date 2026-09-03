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
import { updatePurchaseOrderProgress } from '../orders/orderProgress';

const router = Router();
router.use(requireAuth);

interface PurchaseItemInput {
  productId: number;
  qty: number;
  rate: number;
  discount?: number;
  taxRate?: number;
}

router.get(
  '/',
  requirePermission('purchases', 'view'),
  asyncHandler(async (req, res) => {
    const params = getPageParams(req);
    const search = String(req.query.search ?? '').trim();
    const vendorId = req.query.vendorId ? Number(req.query.vendorId) : undefined;
    const fromDate = req.query.fromDate ? new Date(String(req.query.fromDate)) : undefined;
    const toDate = req.query.toDate ? new Date(String(req.query.toDate)) : undefined;

    const where: any = {
      ...(vendorId ? { vendorId } : {}),
      ...(fromDate || toDate ? { date: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } } : {}),
      ...(search
        ? { OR: [{ billNo: { contains: search } }, { vendor: { name: { contains: search } } }] }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.purchase.findMany({
        where,
        include: { vendor: { select: { id: true, name: true, code: true } } },
        orderBy: { date: 'desc' },
        skip: params.skip,
        take: params.take,
      }),
      prisma.purchase.count({ where }),
    ]);
    ok(res, items, pageMeta(total, params));
  })
);

router.get(
  '/:id',
  requirePermission('purchases', 'view'),
  asyncHandler(async (req, res) => {
    const purchase = await prisma.purchase.findUnique({
      where: { id: Number(req.params.id) },
      include: { vendor: true, items: { include: { product: { include: { unit: true } } } }, returns: true, paymentAllocations: { include: { payment: true } } },
    });
    if (!purchase) throw new ApiError(404, 'Purchase not found');
    ok(res, purchase);
  })
);

router.post(
  '/',
  requirePermission('purchases', 'create'),
  [body('vendorId').isInt(), body('items').isArray({ min: 1 }).withMessage('At least one item is required')],
  validate,
  asyncHandler(async (req, res) => {
    const items: PurchaseItemInput[] = req.body.items;
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

    const purchase = await prisma.$transaction(async (tx) => {
      const billNo = await nextDocNumber(tx, 'PB');
      const createdPurchase = await tx.purchase.create({
        data: {
          billNo,
          vendorBillNo: req.body.vendorBillNo,
          date: req.body.date ? new Date(req.body.date) : new Date(),
          vendorId: req.body.vendorId,
          subtotal,
          discount: overallDiscount,
          taxAmount: taxTotal,
          grandTotal,
          paidAmount,
          purchaseOrderId: req.body.purchaseOrderId || null,
          remarks: req.body.remarks,
          createdById: req.user!.id,
          items: { create: computedItems },
        },
        include: { items: true },
      });

      for (const item of computedItems) {
        const product = productMap.get(item.productId)!;
        const newStock = D(product.currentStock).plus(item.qty);
        await tx.product.update({ where: { id: item.productId }, data: { currentStock: newStock, purchaseRate: item.rate } });
        await tx.stockTransaction.create({
          data: {
            productId: item.productId,
            type: 'PURCHASE',
            qtyIn: item.qty,
            balanceAfter: newStock,
            rate: item.rate,
            reference: billNo,
            createdById: req.user!.id,
          },
        });
        productMap.set(item.productId, { ...product, currentStock: newStock as any });
      }

      if (req.body.purchaseOrderId) {
        for (const item of computedItems) {
          await tx.purchaseOrderItem.updateMany({
            where: { purchaseOrderId: req.body.purchaseOrderId, productId: item.productId },
            data: { receivedQty: { increment: item.qty } },
          });
        }
        await updatePurchaseOrderProgress(tx, req.body.purchaseOrderId);
      }

      if (paidAmount.gt(0)) {
        const paymentNo = await nextDocNumber(tx, settings.paymentPrefix);
        const payment = await tx.payment.create({
          data: {
            paymentNo,
            partyType: 'VENDOR',
            vendorId: req.body.vendorId,
            direction: 'PAID',
            amount: paidAmount,
            mode: req.body.paymentMode || 'CASH',
            remarks: `Payment at purchase ${billNo}`,
            createdById: req.user!.id,
          },
        });
        await tx.paymentAllocation.create({ data: { paymentId: payment.id, purchaseId: createdPurchase.id, amount: paidAmount } });
      }

      return createdPurchase;
    });

    await writeAudit(req, 'CREATE', 'purchases', purchase.id, undefined, purchase);
    created(res, purchase);
  })
);

router.post(
  '/:id/cancel',
  requirePermission('purchases', 'delete'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const purchase = await prisma.purchase.findUnique({ where: { id }, include: { items: true } });
    if (!purchase) throw new ApiError(404, 'Purchase not found');
    if (purchase.status === 'CANCELLED') throw new ApiError(400, 'Purchase is already cancelled');
    if (Number(purchase.paidAmount) > 0) {
      throw new ApiError(400, 'Cannot cancel a purchase that has payments allocated. Record a purchase return or reverse the payment first.');
    }

    await prisma.$transaction(async (tx) => {
      for (const item of purchase.items) {
        const product = await tx.product.findUniqueOrThrow({ where: { id: item.productId } });
        const newStock = D(product.currentStock).minus(item.qty);
        await tx.product.update({ where: { id: item.productId }, data: { currentStock: newStock } });
        await tx.stockTransaction.create({
          data: {
            productId: item.productId,
            type: 'ADJUSTMENT',
            qtyOut: item.qty,
            balanceAfter: newStock,
            reference: purchase.billNo,
            remarks: 'Purchase cancelled — stock reversed',
            createdById: req.user!.id,
          },
        });
      }
      await tx.purchase.update({ where: { id }, data: { status: 'CANCELLED' } });
    });

    await writeAudit(req, 'UPDATE', 'purchases.status', id, { status: purchase.status }, { status: 'CANCELLED' });
    ok(res, { cancelled: true });
  })
);

router.delete(
  '/:id',
  requirePermission('purchases', 'delete'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const purchase = await prisma.purchase.findUnique({ where: { id }, include: { paymentAllocations: true, returns: true } });
    if (!purchase) throw new ApiError(404, 'Purchase not found');
    if (purchase.status !== 'CANCELLED') throw new ApiError(400, 'Only a cancelled purchase can be deleted. Cancel it first.');
    if (purchase.paymentAllocations.length > 0) throw new ApiError(400, 'Cannot delete — payments are allocated to this purchase.');
    if (purchase.returns.length > 0) throw new ApiError(400, 'Cannot delete — purchase returns exist for this purchase.');

    await prisma.purchase.delete({ where: { id } });
    await writeAudit(req, 'DELETE', 'purchases', id, purchase, undefined);
    ok(res, { deleted: true });
  })
);

export default router;
