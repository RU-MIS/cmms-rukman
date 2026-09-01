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
  '/bom/:productId',
  requirePermission('production', 'view'),
  asyncHandler(async (req, res) => {
    const items = await prisma.bomItem.findMany({
      where: { finishedProductId: Number(req.params.productId) },
      include: { component: { include: { unit: true } } },
    });
    ok(res, items);
  })
);

router.put(
  '/bom/:productId',
  requirePermission('production', 'edit'),
  [body('items').isArray()],
  validate,
  asyncHandler(async (req, res) => {
    const finishedProductId = Number(req.params.productId);
    const items: { componentId: number; qtyPerUnit: number }[] = req.body.items;
    if (items.some((i) => i.componentId === finishedProductId)) {
      throw new ApiError(400, 'A product cannot be a component of itself');
    }
    await prisma.$transaction([
      prisma.bomItem.deleteMany({ where: { finishedProductId } }),
      prisma.bomItem.createMany({
        data: items.map((i) => ({ finishedProductId, componentId: i.componentId, qtyPerUnit: i.qtyPerUnit })),
      }),
    ]);
    await writeAudit(req, 'UPDATE', 'bom', finishedProductId, undefined, { items });
    const bom = await prisma.bomItem.findMany({ where: { finishedProductId }, include: { component: true } });
    ok(res, bom);
  })
);

router.get(
  '/plans',
  requirePermission('production', 'view'),
  asyncHandler(async (req, res) => {
    const params = getPageParams(req);
    const status = req.query.status ? String(req.query.status) : undefined;
    const where: any = status ? { status } : {};
    const [items, total] = await Promise.all([
      prisma.productionPlan.findMany({
        where,
        include: { product: { include: { unit: true } } },
        orderBy: { date: 'desc' },
        skip: params.skip,
        take: params.take,
      }),
      prisma.productionPlan.count({ where }),
    ]);
    ok(res, items, pageMeta(total, params));
  })
);

router.get(
  '/plans/:id',
  requirePermission('production', 'view'),
  asyncHandler(async (req, res) => {
    const plan = await prisma.productionPlan.findUnique({
      where: { id: Number(req.params.id) },
      include: { product: { include: { unit: true } } },
    });
    if (!plan) throw new ApiError(404, 'Production plan not found');
    const bom = await prisma.bomItem.findMany({ where: { finishedProductId: plan.productId }, include: { component: { include: { unit: true } } } });
    const remainingQty = D(plan.plannedQty).minus(plan.completedQty);
    const requirement = bom.map((b) => ({
      componentId: b.componentId,
      name: b.component.name,
      unit: b.component.unit.shortName,
      qtyPerUnit: b.qtyPerUnit,
      requiredForRemaining: D(b.qtyPerUnit).mul(remainingQty),
      available: b.component.currentStock,
    }));
    ok(res, { plan, requirement });
  })
);

router.post(
  '/plans',
  requirePermission('production', 'create'),
  [body('productId').isInt(), body('plannedQty').isFloat({ gt: 0 })],
  validate,
  asyncHandler(async (req, res) => {
    const plan = await prisma.$transaction(async (tx) => {
      const planNo = await nextDocNumber(tx, 'PRD');
      return tx.productionPlan.create({
        data: {
          planNo,
          date: req.body.date ? new Date(req.body.date) : new Date(),
          dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null,
          productId: req.body.productId,
          plannedQty: req.body.plannedQty,
          remarks: req.body.remarks,
          createdById: req.user!.id,
        },
      });
    });
    await writeAudit(req, 'CREATE', 'production_plans', plan.id, undefined, plan);
    created(res, plan);
  })
);

router.post(
  '/plans/:id/start',
  requirePermission('production', 'edit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const plan = await prisma.productionPlan.update({ where: { id }, data: { status: 'IN_PROGRESS' } });
    await writeAudit(req, 'UPDATE', 'production_plans.status', id, undefined, plan);
    ok(res, plan);
  })
);

router.post(
  '/plans/:id/cancel',
  requirePermission('production', 'edit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const plan = await prisma.productionPlan.update({ where: { id }, data: { status: 'CANCELLED' } });
    await writeAudit(req, 'UPDATE', 'production_plans.status', id, undefined, plan);
    ok(res, plan);
  })
);

router.post(
  '/plans/:id/complete',
  requirePermission('production', 'edit'),
  [body('completedQty').isFloat({ gt: 0 })],
  validate,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const plan = await prisma.productionPlan.findUnique({ where: { id } });
    if (!plan) throw new ApiError(404, 'Production plan not found');
    if (plan.status === 'COMPLETED' || plan.status === 'CANCELLED') {
      throw new ApiError(400, `Cannot complete a plan with status ${plan.status}`);
    }

    const completeQty = D(req.body.completedQty);
    const remaining = D(plan.plannedQty).minus(plan.completedQty);
    if (completeQty.gt(remaining)) throw new ApiError(400, `Cannot produce more than the remaining planned quantity (${remaining.toString()})`);

    const bom = await prisma.bomItem.findMany({ where: { finishedProductId: plan.productId }, include: { component: true } });

    const result = await prisma.$transaction(async (tx) => {
      for (const b of bom) {
        const required = D(b.qtyPerUnit).mul(completeQty);
        const component = await tx.product.findUniqueOrThrow({ where: { id: b.componentId } });
        if (D(component.currentStock).lt(required)) {
          throw new ApiError(400, `Insufficient stock of raw material '${component.name}' — need ${required.toString()}, have ${component.currentStock.toString()}`);
        }
        const newStock = D(component.currentStock).minus(required);
        await tx.product.update({ where: { id: b.componentId }, data: { currentStock: newStock } });
        await tx.stockTransaction.create({
          data: {
            productId: b.componentId,
            type: 'PRODUCTION_CONSUME',
            qtyOut: required,
            balanceAfter: newStock,
            reference: plan.planNo,
            createdById: req.user!.id,
          },
        });
      }

      const finished = await tx.product.findUniqueOrThrow({ where: { id: plan.productId } });
      const newFinishedStock = D(finished.currentStock).plus(completeQty);
      await tx.product.update({ where: { id: plan.productId }, data: { currentStock: newFinishedStock } });
      await tx.stockTransaction.create({
        data: {
          productId: plan.productId,
          type: 'PRODUCTION_IN',
          qtyIn: completeQty,
          balanceAfter: newFinishedStock,
          reference: plan.planNo,
          createdById: req.user!.id,
        },
      });

      const newCompletedQty = D(plan.completedQty).plus(completeQty);
      const newStatus = newCompletedQty.gte(plan.plannedQty) ? 'COMPLETED' : 'PARTIALLY_COMPLETED';
      return tx.productionPlan.update({ where: { id }, data: { completedQty: newCompletedQty, status: newStatus } });
    });

    await writeAudit(req, 'UPDATE', 'production_plans.complete', id, plan, result);
    ok(res, result);
  })
);

export default router;
