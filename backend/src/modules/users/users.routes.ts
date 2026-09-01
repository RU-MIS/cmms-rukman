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
import { hashPassword } from '../../utils/password';

const router = Router();
router.use(requireAuth);

const userSelect = {
  id: true,
  username: true,
  name: true,
  email: true,
  phone: true,
  active: true,
  lastLoginAt: true,
  createdAt: true,
  role: { select: { id: true, name: true } },
};

router.get(
  '/',
  requirePermission('users', 'view'),
  asyncHandler(async (req, res) => {
    const params = getPageParams(req);
    const search = String(req.query.search ?? '').trim();
    const where = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { username: { contains: search, mode: 'insensitive' as const } },
            { email: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};
    const [items, total] = await Promise.all([
      prisma.user.findMany({ where, select: userSelect, orderBy: { name: 'asc' }, skip: params.skip, take: params.take }),
      prisma.user.count({ where }),
    ]);
    ok(res, items, pageMeta(total, params));
  })
);

router.post(
  '/',
  requirePermission('users', 'create'),
  [
    body('username').isLength({ min: 3 }),
    body('name').notEmpty(),
    body('password').isLength({ min: 6 }),
    body('roleId').isInt(),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const existing = await prisma.user.findUnique({ where: { username: req.body.username } });
    if (existing) throw new ApiError(409, 'Username already taken');

    const passwordHash = await hashPassword(req.body.password);
    const user = await prisma.user.create({
      data: {
        username: req.body.username,
        name: req.body.name,
        email: req.body.email || null,
        phone: req.body.phone,
        passwordHash,
        roleId: req.body.roleId,
      },
      select: userSelect,
    });
    await writeAudit(req, 'CREATE', 'users', user.id, undefined, user);
    created(res, user);
  })
);

router.put(
  '/:id',
  requirePermission('users', 'edit'),
  [body('name').notEmpty(), body('roleId').isInt()],
  validate,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await prisma.user.findUnique({ where: { id } });
    if (!before) throw new ApiError(404, 'User not found');

    const user = await prisma.user.update({
      where: { id },
      data: {
        name: req.body.name,
        email: req.body.email || null,
        phone: req.body.phone,
        roleId: req.body.roleId,
      },
      select: userSelect,
    });
    await writeAudit(req, 'UPDATE', 'users', id, { name: before.name, roleId: before.roleId }, user);
    ok(res, user);
  })
);

router.patch(
  '/:id/toggle-active',
  requirePermission('users', 'edit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user!.id) throw new ApiError(400, 'You cannot deactivate your own account.');
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, 'User not found');
    const user = await prisma.user.update({ where: { id }, data: { active: !existing.active }, select: userSelect });
    await writeAudit(req, 'UPDATE', 'users.status', id, { active: existing.active }, user);
    ok(res, user);
  })
);

router.post(
  '/:id/reset-password',
  requirePermission('users', 'edit'),
  [body('newPassword').isLength({ min: 6 })],
  validate,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const passwordHash = await hashPassword(req.body.newPassword);
    await prisma.user.update({ where: { id }, data: { passwordHash } });
    await writeAudit(req, 'UPDATE', 'users.password', id);
    ok(res, { reset: true });
  })
);

export default router;
