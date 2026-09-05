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

router.get(
  '/',
  requirePermission('purchases', 'view'),
  asyncHandler(async (req, res) => {
    const params = getPageParams(req);
    const [items, total] = await Promise.all([
      prisma.purchaseReturn.findMany({
        include: { vendor: { select: { id: true, name: true } }, purchase: { select: { billNo: true } } },
        orderBy: { date: 'desc' },
        skip: params.skip,
        take: params.take,
      }),
      prisma.purchaseReturn.count(),
    ]);
    ok(res, items, pageMeta(total, params));
  })
);

router.get(
  '/:id',
  requirePermission('purchases', 'view'),
  asyncHandler(async (req, res) => {
    const item = await prisma.purchaseReturn.findUnique({
      where: { id: Number(req.params.id) },
      include: { vendor: true, purchase: true, items: { include: { product: true } } },
    });
    if (!item) throw new ApiError(404, 'Purchase return not found');
    ok(res, item);
  })
);

router.post(
  '/',
  requirePermission('purchases', 'edit'),
  [body('purchaseId').isInt(), body('items').isArray({ min: 1 })],
  validate,
  asyncHandler(async (req, res) => {
    const purchase = await prisma.purchase.findUnique({ where: { id: req.body.purchaseId }, include: { items: true } });
    if (!purchase) throw new ApiError(404, 'Purchase not found');

    const items: { productId: number; qty: number; rate: number }[] = req.body.items;
    for (const item of items) {
      const purchaseItem = purchase.items.find((i) => i.productId === item.productId);
      if (!purchaseItem) throw new ApiError(400, `Product ${item.productId} was not part of this purchase`);
      if (item.qty <= 0 || item.qty > Number(purchaseItem.qty)) throw new ApiError(400, `Invalid return quantity for product ${item.productId}`);
    }

    let totalAmount = D(0);
    const computedItems = items.map((i) => {
      const total = D(i.qty).mul(i.rate);
      totalAmount = totalAmount.plus(total);
      return { productId: i.productId, qty: D(i.qty), rate: D(i.rate), total };
    });

    const purchaseReturn = await prisma.$transaction(async (tx) => {
      const returnNo = await nextDocNumber(tx, req.user!.companyId, 'PB-RET');
      const pr = await tx.purchaseReturn.create({
        data: {
          companyId: req.user!.companyId,
          returnNo,
          purchaseId: purchase.id,
          vendorId: purchase.vendorId,
          totalAmount,
          remarks: req.body.remarks,
          items: { create: computedItems },
        },
        include: { items: true },
      });

      for (const item of computedItems) {
        const product = await tx.product.findUniqueOrThrow({ where: { id: item.productId } });
        const newStock = D(product.currentStock).minus(item.qty);
        await tx.product.update({ where: { id: item.productId }, data: { currentStock: newStock } });
        await tx.stockTransaction.create({
          data: {
            companyId: req.user!.companyId,
            productId: item.productId,
            type: 'PURCHASE_RETURN',
            qtyOut: item.qty,
            balanceAfter: newStock,
            rate: item.rate,
            reference: returnNo,
            createdById: req.user!.id,
          },
        });
      }
      return pr;
    });

    await writeAudit(req, 'CREATE', 'purchase_returns', purchaseReturn.id, undefined, purchaseReturn);
    created(res, purchaseReturn);
  })
);

export default router;
