import { Router } from 'express';
import { body } from 'express-validator';
import { prisma } from '../../config/prisma';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok, created, ApiError } from '../../utils/response';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { writeAudit } from '../../middleware/audit';

const router = Router();
router.use(requireAuth);

router.get(
  '/',
  requirePermission('products', 'view'),
  asyncHandler(async (_req, res) => {
    const items = await prisma.productCategory.findMany({ orderBy: { name: 'asc' } });
    ok(res, items);
  })
);

router.post(
  '/',
  requirePermission('products', 'create'),
  [body('name').notEmpty()],
  validate,
  asyncHandler(async (req, res) => {
    const category = await prisma.productCategory.create({ data: { name: req.body.name } });
    await writeAudit(req, 'CREATE', 'product_categories', category.id, undefined, category);
    created(res, category);
  })
);

router.put(
  '/:id',
  requirePermission('products', 'edit'),
  [body('name').notEmpty()],
  validate,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const category = await prisma.productCategory.update({ where: { id }, data: { name: req.body.name, active: req.body.active } });
    await writeAudit(req, 'UPDATE', 'product_categories', id, undefined, category);
    ok(res, category);
  })
);

router.delete(
  '/:id',
  requirePermission('products', 'delete'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const usage = await prisma.product.count({ where: { categoryId: id } });
    if (usage > 0) throw new ApiError(400, 'Cannot delete a category that has products. Deactivate it instead.');
    await prisma.productCategory.delete({ where: { id } });
    await writeAudit(req, 'DELETE', 'product_categories', id);
    ok(res, { deleted: true });
  })
);

export default router;
