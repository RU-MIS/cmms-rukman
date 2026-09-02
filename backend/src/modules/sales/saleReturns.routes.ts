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

const router = Router();
router.use(requireAuth);

router.get(
  '/',
  requirePermission('sales', 'view'),
  asyncHandler(async (req, res) => {
    const params = getPageParams(req);
    const [items, total] = await Promise.all([
      prisma.saleReturn.findMany({
        include: { customer: { select: { id: true, name: true } }, sale: { select: { invoiceNo: true } } },
        orderBy: { date: 'desc' },
        skip: params.skip,
        take: params.take,
      }),
      prisma.saleReturn.count(),
    ]);
    ok(res, items, pageMeta(total, params));
  })
);

router.get(
  '/:id',
  requirePermission('sales', 'view'),
  asyncHandler(async (req, res) => {
    const item = await prisma.saleReturn.findUnique({
      where: { id: Number(req.params.id) },
      include: { customer: true, sale: true, items: { include: { product: true } } },
    });
    if (!item) throw new ApiError(404, 'Sale return not found');
    ok(res, item);
  })
);

router.post(
  '/',
  requirePermission('sales', 'edit'),
  [body('saleId').isInt(), body('items').isArray({ min: 1 })],
  validate,
  asyncHandler(async (req, res) => {
    const sale = await prisma.sale.findUnique({ where: { id: req.body.saleId }, include: { items: true } });
    if (!sale) throw new ApiError(404, 'Sale not found');

    const items: { productId: number; qty: number; rate: number }[] = req.body.items;
    for (const item of items) {
      const saleItem = sale.items.find((i) => i.productId === item.productId);
      if (!saleItem) throw new ApiError(400, `Product ${item.productId} was not part of this sale`);
      if (item.qty <= 0 || item.qty > Number(saleItem.qty)) throw new ApiError(400, `Invalid return quantity for product ${item.productId}`);
    }

    let totalAmount = D(0);
    const computedItems = items.map((i) => {
      const total = D(i.qty).mul(i.rate);
      totalAmount = totalAmount.plus(total);
      return { productId: i.productId, qty: D(i.qty), rate: D(i.rate), total };
    });

    const settings = await getSettings();
    const saleReturn = await prisma.$transaction(async (tx) => {
      const returnNo = await nextDocNumber(tx, `${settings.invoicePrefix}-RET`);
      const sr = await tx.saleReturn.create({
        data: {
          returnNo,
          saleId: sale.id,
          customerId: sale.customerId,
          totalAmount,
          remarks: req.body.remarks,
          items: { create: computedItems },
        },
        include: { items: true },
      });

      for (const item of computedItems) {
        const product = await tx.product.findUniqueOrThrow({ where: { id: item.productId } });
        const newStock = D(product.currentStock).plus(item.qty);
        await tx.product.update({ where: { id: item.productId }, data: { currentStock: newStock } });
        await tx.stockTransaction.create({
          data: {
            productId: item.productId,
            type: 'SALE_RETURN',
            qtyIn: item.qty,
            balanceAfter: newStock,
            rate: item.rate,
            reference: returnNo,
            createdById: req.user!.id,
          },
        });
      }
      return sr;
    });

    await writeAudit(req, 'CREATE', 'sale_returns', saleReturn.id, undefined, saleReturn);
    created(res, saleReturn);
  })
);

export default router;
