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
import { D } from '../../utils/money';
import { assertOwned } from '../../utils/ownership';

const router = Router();
router.use(requireAuth);

router.get(
  '/current',
  requirePermission('inventory', 'view'),
  asyncHandler(async (req, res) => {
    const params = getPageParams(req);
    const search = String(req.query.search ?? '').trim();
    const stockType = String(req.query.stockType ?? '');
    const where: any = {
      active: true,
      ...(stockType === 'raw' ? { isRawMaterial: true } : {}),
      ...(stockType === 'finished' ? { isRawMaterial: false } : {}),
      ...(search ? { OR: [{ name: { contains: search } }, { sku: { contains: search } }] } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: { unit: true, category: true },
        orderBy: { name: 'asc' },
        skip: params.skip,
        take: params.take,
      }),
      prisma.product.count({ where }),
    ]);
    ok(res, items, pageMeta(total, params));
  })
);

router.get(
  '/low-stock',
  requirePermission('inventory', 'view'),
  asyncHandler(async (_req, res) => {
    const products = await prisma.product.findMany({ where: { active: true }, include: { unit: true } });
    const low = products.filter((p) => Number(p.currentStock) <= Number(p.reorderLevel));
    ok(res, low);
  })
);

router.get(
  '/valuation',
  requirePermission('inventory', 'view'),
  asyncHandler(async (req, res) => {
    const stockType = String(req.query.stockType ?? '');
    const where: any = {
      active: true,
      ...(stockType === 'raw' ? { isRawMaterial: true } : {}),
      ...(stockType === 'finished' ? { isRawMaterial: false } : {}),
    };
    const products = await prisma.product.findMany({ where, include: { unit: true } });
    let totalValue = D(0);
    let rawMaterialValue = D(0);
    let finishedGoodsValue = D(0);
    const rows = products.map((p) => {
      const value = D(p.currentStock).mul(p.purchaseRate);
      totalValue = totalValue.plus(value);
      if (p.isRawMaterial) rawMaterialValue = rawMaterialValue.plus(value);
      else finishedGoodsValue = finishedGoodsValue.plus(value);
      return { id: p.id, sku: p.sku, name: p.name, unit: p.unit.shortName, currentStock: p.currentStock, purchaseRate: p.purchaseRate, isRawMaterial: p.isRawMaterial, value };
    });
    ok(res, rows, { totalValue, rawMaterialValue, finishedGoodsValue });
  })
);

router.get(
  '/ledger',
  requirePermission('inventory', 'view'),
  asyncHandler(async (req, res) => {
    const params = getPageParams(req);
    const productId = req.query.productId ? Number(req.query.productId) : undefined;
    const fromDate = req.query.fromDate ? new Date(String(req.query.fromDate)) : undefined;
    const toDate = req.query.toDate ? new Date(String(req.query.toDate)) : undefined;
    const where: any = {
      ...(productId ? { productId } : {}),
      ...(fromDate || toDate ? { date: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.stockTransaction.findMany({
        where,
        include: { product: { select: { name: true, sku: true } }, warehouse: { select: { name: true } }, createdBy: { select: { name: true } } },
        orderBy: { date: 'desc' },
        skip: params.skip,
        take: params.take,
      }),
      prisma.stockTransaction.count({ where }),
    ]);
    ok(res, items, pageMeta(total, params));
  })
);

async function applyStockChange(companyId: number, productId: number, delta: number, userId: number, type: 'STOCK_IN' | 'STOCK_OUT' | 'ADJUSTMENT', reference?: string, remarks?: string, warehouseId?: number, rate?: number) {
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({ where: { id: productId } });
    if (!product) throw new ApiError(404, 'Product not found');
    const newStock = D(product.currentStock).plus(delta);
    if (newStock.lt(0)) throw new ApiError(400, 'This would take stock below zero');
    await tx.product.update({ where: { id: productId }, data: { currentStock: newStock } });
    return tx.stockTransaction.create({
      data: {
        companyId,
        productId,
        warehouseId: warehouseId || null,
        type,
        qtyIn: delta > 0 ? D(delta) : D(0),
        qtyOut: delta < 0 ? D(Math.abs(delta)) : D(0),
        balanceAfter: newStock,
        rate: rate !== undefined ? D(rate) : undefined,
        reference,
        remarks,
        createdById: userId,
      },
    });
  });
}

router.post(
  '/stock-in',
  requirePermission('inventory', 'create'),
  [body('productId').isInt(), body('qty').isFloat({ gt: 0 })],
  validate,
  asyncHandler(async (req, res) => {
    if (req.body.warehouseId) {
      assertOwned(await prisma.warehouse.findUnique({ where: { id: Number(req.body.warehouseId) } }), 'warehouse');
    }
    const txn = await applyStockChange(req.user!.companyId, req.body.productId, req.body.qty, req.user!.id, 'STOCK_IN', req.body.reference, req.body.remarks, req.body.warehouseId, req.body.rate);
    await writeAudit(req, 'CREATE', 'inventory.stock_in', txn.id, undefined, txn);
    created(res, txn);
  })
);

router.post(
  '/stock-out',
  requirePermission('inventory', 'create'),
  [body('productId').isInt(), body('qty').isFloat({ gt: 0 })],
  validate,
  asyncHandler(async (req, res) => {
    if (req.body.warehouseId) {
      assertOwned(await prisma.warehouse.findUnique({ where: { id: Number(req.body.warehouseId) } }), 'warehouse');
    }
    const txn = await applyStockChange(req.user!.companyId, req.body.productId, -Math.abs(req.body.qty), req.user!.id, 'STOCK_OUT', req.body.reference, req.body.remarks, req.body.warehouseId);
    await writeAudit(req, 'CREATE', 'inventory.stock_out', txn.id, undefined, txn);
    created(res, txn);
  })
);

router.post(
  '/adjustment',
  requirePermission('inventory', 'create'),
  [body('productId').isInt(), body('qty').isFloat().custom((v) => Number(v) !== 0).withMessage('Adjustment quantity cannot be zero')],
  validate,
  asyncHandler(async (req, res) => {
    const txn = await applyStockChange(req.user!.companyId, req.body.productId, req.body.qty, req.user!.id, 'ADJUSTMENT', req.body.reference, req.body.remarks || 'Manual stock adjustment');
    await writeAudit(req, 'CREATE', 'inventory.adjustment', txn.id, undefined, txn);
    created(res, txn);
  })
);

router.post(
  '/transfer',
  requirePermission('inventory', 'create'),
  [body('productId').isInt(), body('qty').isFloat({ gt: 0 }), body('fromWarehouseId').isInt(), body('toWarehouseId').isInt()],
  validate,
  asyncHandler(async (req, res) => {
    if (req.body.fromWarehouseId === req.body.toWarehouseId) throw new ApiError(400, 'Source and destination warehouse must differ');
    const product = await prisma.product.findUnique({ where: { id: req.body.productId } });
    if (!product) throw new ApiError(404, 'Product not found');
    assertOwned(await prisma.warehouse.findUnique({ where: { id: Number(req.body.fromWarehouseId) } }), 'source warehouse');
    assertOwned(await prisma.warehouse.findUnique({ where: { id: Number(req.body.toWarehouseId) } }), 'destination warehouse');

    const [out, inn] = await prisma.$transaction([
      prisma.stockTransaction.create({
        data: {
          companyId: req.user!.companyId,
          productId: req.body.productId,
          warehouseId: req.body.fromWarehouseId,
          type: 'TRANSFER_OUT',
          qtyOut: req.body.qty,
          balanceAfter: product.currentStock,
          reference: req.body.reference,
          remarks: req.body.remarks,
          createdById: req.user!.id,
        },
      }),
      prisma.stockTransaction.create({
        data: {
          companyId: req.user!.companyId,
          productId: req.body.productId,
          warehouseId: req.body.toWarehouseId,
          type: 'TRANSFER_IN',
          qtyIn: req.body.qty,
          balanceAfter: product.currentStock,
          reference: req.body.reference,
          remarks: req.body.remarks,
          createdById: req.user!.id,
        },
      }),
    ]);
    await writeAudit(req, 'CREATE', 'inventory.transfer', out.id, undefined, { out, inn });
    created(res, { out, inn });
  })
);

export default router;
