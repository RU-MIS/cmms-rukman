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
  requirePermission('roles', 'view'),
  asyncHandler(async (_req, res) => {
    const roles = await prisma.role.findMany({
      orderBy: { name: 'asc' },
      include: { permissions: { include: { permission: true } }, _count: { select: { memberships: true } } },
    });
    ok(res, roles);
  })
);

router.get(
  '/permissions/catalog',
  requirePermission('roles', 'view'),
  asyncHandler(async (_req, res) => {
    const permissions = await prisma.permission.findMany({ orderBy: [{ module: 'asc' }, { action: 'asc' }] });
    ok(res, permissions);
  })
);

router.post(
  '/',
  requirePermission('roles', 'create'),
  [body('name').notEmpty()],
  validate,
  asyncHandler(async (req, res) => {
    const role = await prisma.role.create({ data: { companyId: req.user!.companyId, name: req.body.name, description: req.body.description } });
    await writeAudit(req, 'CREATE', 'roles', role.id, undefined, role);
    created(res, role);
  })
);

router.put(
  '/:id',
  requirePermission('roles', 'edit'),
  [body('name').notEmpty()],
  validate,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.role.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, 'Role not found');
    if (existing.isSystem) throw new ApiError(400, 'System roles cannot be renamed.');
    const role = await prisma.role.update({ where: { id }, data: { name: req.body.name, description: req.body.description } });
    await writeAudit(req, 'UPDATE', 'roles', id, existing, role);
    ok(res, role);
  })
);

router.put(
  '/:id/permissions',
  requirePermission('roles', 'edit'),
  [body('permissionIds').isArray()],
  validate,
  asyncHandler(async (req, res) => {
    const roleId = Number(req.params.id);
    const permissionIds: number[] = req.body.permissionIds;
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId } }),
      prisma.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
        skipDuplicates: true,
      }),
    ]);
    await writeAudit(req, 'UPDATE', 'roles.permissions', roleId, undefined, { permissionIds });
    const role = await prisma.role.findUnique({ where: { id: roleId }, include: { permissions: { include: { permission: true } } } });
    ok(res, role);
  })
);

router.delete(
  '/:id',
  requirePermission('roles', 'delete'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const role = await prisma.role.findUnique({ where: { id }, include: { _count: { select: { memberships: true } } } });
    if (!role) throw new ApiError(404, 'Role not found');
    if (role.isSystem) throw new ApiError(400, 'System roles cannot be deleted.');
    if (role._count.memberships > 0) throw new ApiError(400, 'Cannot delete a role that has users assigned.');
    await prisma.role.delete({ where: { id } });
    await writeAudit(req, 'DELETE', 'roles', id);
    ok(res, { deleted: true });
  })
);

export default router;
