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

const router = Router();
router.use(requireAuth);

async function generateSku(): Promise<string> {
  const last = await prisma.product.findFirst({ orderBy: { id: 'desc' } });
  const next = (last?.id ?? 0) + 1;
  return `PRD-${String(next).padStart(5, '0')}`;
}

router.get(
  '/',
  requirePermission('products', 'view'),
  asyncHandler(async (req, res) => {
    const params = getPageParams(req);
    const search = String(req.query.search ?? '').trim();
    const activeOnly = req.query.active !== 'all';
    const categoryId = req.query.categoryId ? Number(req.query.categoryId) : undefined;
    const lowStockOnly = req.query.lowStock === 'true';

    const where: any = {
      ...(activeOnly ? { active: true } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { sku: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    let items = await prisma.product.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { category: true, unit: true },
      ...(lowStockOnly ? {} : { skip: params.skip, take: params.take }),
    });

    if (lowStockOnly) {
      items = items.filter((p) => Number(p.currentStock) <= Number(p.reorderLevel));
    }

    const total = lowStockOnly ? items.length : await prisma.product.count({ where });
    const pageItems = lowStockOnly ? items.slice(params.skip, params.skip + params.take) : items;
    ok(res, pageItems, pageMeta(total, params));
  })
);

router.get(
  '/:id',
  requirePermission('products', 'view'),
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findUnique({
      where: { id: Number(req.params.id) },
      include: { category: true, unit: true },
    });
    if (!product) throw new ApiError(404, 'Product not found');
    ok(res, product);
  })
);

const productValidators = [
  body('name').notEmpty().withMessage('Name is required'),
  body('unitId').isInt().withMessage('Unit is required'),
  body('saleRate').optional().isNumeric(),
  body('purchaseRate').optional().isNumeric(),
];

router.post(
  '/',
  requirePermission('products', 'create'),
  productValidators,
  validate,
  asyncHandler(async (req, res) => {
    const sku = req.body.sku || (await generateSku());
    const openingStock = req.body.openingStock ?? 0;

    const product = await prisma.$transaction(async (tx) => {
      const p = await tx.product.create({
        data: {
          sku,
          name: req.body.name,
          categoryId: req.body.categoryId || null,
          unitId: req.body.unitId,
          purchaseRate: req.body.purchaseRate ?? 0,
          saleRate: req.body.saleRate ?? 0,
          taxRate: req.body.taxRate ?? 0,
          openingStock,
          currentStock: openingStock,
          reorderLevel: req.body.reorderLevel ?? 0,
          isRawMaterial: !!req.body.isRawMaterial,
          description: req.body.description,
        },
      });
      if (Number(openingStock) > 0) {
        await tx.stockTransaction.create({
          data: {
            productId: p.id,
            type: 'OPENING',
            qtyIn: openingStock,
            balanceAfter: openingStock,
            reference: 'Opening Stock',
            createdById: req.user!.id,
          },
        });
      }
      return p;
    });

    await writeAudit(req, 'CREATE', 'products', product.id, undefined, product);
    created(res, product);
  })
);

router.put(
  '/:id',
  requirePermission('products', 'edit'),
  productValidators,
  validate,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await prisma.product.findUnique({ where: { id } });
    if (!before) throw new ApiError(404, 'Product not found');

    const product = await prisma.product.update({
      where: { id },
      data: {
        name: req.body.name,
        categoryId: req.body.categoryId || null,
        unitId: req.body.unitId,
        purchaseRate: req.body.purchaseRate,
        saleRate: req.body.saleRate,
        taxRate: req.body.taxRate,
        reorderLevel: req.body.reorderLevel,
        isRawMaterial: !!req.body.isRawMaterial,
        description: req.body.description,
      },
    });
    await writeAudit(req, 'UPDATE', 'products', id, before, product);
    ok(res, product);
  })
);

router.patch(
  '/:id/toggle-active',
  requirePermission('products', 'edit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, 'Product not found');
    const product = await prisma.product.update({ where: { id }, data: { active: !existing.active } });
    await writeAudit(req, 'UPDATE', 'products.status', id, existing, product);
    ok(res, product);
  })
);

router.delete(
  '/:id',
  requirePermission('products', 'delete'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const usage = await prisma.stockTransaction.count({ where: { productId: id } });
    if (usage > 1) {
      const existing = await prisma.product.update({ where: { id }, data: { active: false } });
      await writeAudit(req, 'UPDATE', 'products.status', id, undefined, existing);
      return ok(res, { deactivated: true, product: existing, reason: 'Product has transaction history; deactivated instead of deleted.' });
    }
    await prisma.stockTransaction.deleteMany({ where: { productId: id } });
    await prisma.product.delete({ where: { id } });
    await writeAudit(req, 'DELETE', 'products', id);
    ok(res, { deleted: true });
  })
);

export default router;
