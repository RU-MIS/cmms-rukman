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
    const items = await prisma.warehouse.findMany({ orderBy: { name: 'asc' } });
    ok(res, items);
  })
);

router.post(
  '/',
  requirePermission('products', 'create'),
  [body('name').notEmpty()],
  validate,
  asyncHandler(async (req, res) => {
    const warehouse = await prisma.warehouse.create({ data: { name: req.body.name, address: req.body.address } });
    await writeAudit(req, 'CREATE', 'warehouses', warehouse.id, undefined, warehouse);
    created(res, warehouse);
  })
);

router.put(
  '/:id',
  requirePermission('products', 'edit'),
  [body('name').notEmpty()],
  validate,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const warehouse = await prisma.warehouse.update({
      where: { id },
      data: { name: req.body.name, address: req.body.address, active: req.body.active },
    });
    await writeAudit(req, 'UPDATE', 'warehouses', id, undefined, warehouse);
    ok(res, warehouse);
  })
);

router.delete(
  '/:id',
  requirePermission('products', 'delete'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const usage = await prisma.stockTransaction.count({ where: { warehouseId: id } });
    if (usage > 0) throw new ApiError(400, 'Cannot delete a warehouse with stock history. Deactivate it instead.');
    await prisma.warehouse.delete({ where: { id } });
    await writeAudit(req, 'DELETE', 'warehouses', id);
    ok(res, { deleted: true });
  })
);

export default router;
