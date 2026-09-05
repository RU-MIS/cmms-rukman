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

function toUserResponse(m: { user: any; role: { id: number; name: string } }) {
  const { user, role } = m;
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    phone: user.phone,
    active: user.active,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    role: { id: role.id, name: role.name },
  };
}

/**
 * Users are global logins (one login can belong to several companies), but
 * "who works on this company" and "what role do they have here" is per
 * CompanyUser membership. This module manages membership in the currently
 * active company, not the global User record's role.
 */

router.get(
  '/',
  requirePermission('users', 'view'),
  asyncHandler(async (req, res) => {
    const params = getPageParams(req);
    const search = String(req.query.search ?? '').trim();
    const userFilter = search
      ? { user: { OR: [{ name: { contains: search } }, { username: { contains: search } }, { email: { contains: search } }] } }
      : {};
    const where = { companyId: req.user!.companyId, ...userFilter };

    const [memberships, total] = await Promise.all([
      prisma.companyUser.findMany({
        where,
        include: { user: true, role: { select: { id: true, name: true } } },
        orderBy: { user: { name: 'asc' } },
        skip: params.skip,
        take: params.take,
      }),
      prisma.companyUser.count({ where }),
    ]);
    ok(res, memberships.map(toUserResponse), pageMeta(total, params));
  })
);

router.post(
  '/',
  requirePermission('users', 'create'),
  [body('username').isLength({ min: 3 }), body('name').notEmpty(), body('roleId').isInt()],
  validate,
  asyncHandler(async (req, res) => {
    const role = await prisma.role.findUnique({ where: { id: Number(req.body.roleId) } });
    if (!role) throw new ApiError(400, 'Invalid role');

    const existingUser = await prisma.user.findUnique({ where: { username: req.body.username } });
    if (existingUser) {
      const existingMembership = await prisma.companyUser.findUnique({
        where: { companyId_userId: { companyId: req.user!.companyId, userId: existingUser.id } },
      });
      if (existingMembership) throw new ApiError(409, 'This user is already a member of this company');

      const membership = await prisma.companyUser.create({
        data: { companyId: req.user!.companyId, userId: existingUser.id, roleId: role.id },
        include: { user: true, role: { select: { id: true, name: true } } },
      });
      await writeAudit(req, 'CREATE', 'users', existingUser.id, undefined, membership);
      return created(res, toUserResponse(membership));
    }

    if (!req.body.password || String(req.body.password).length < 6) {
      throw new ApiError(400, 'password must be at least 6 characters for a new user');
    }
    const passwordHash = await hashPassword(req.body.password);
    const membership = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username: req.body.username,
          name: req.body.name,
          email: req.body.email || null,
          phone: req.body.phone,
          passwordHash,
          mustChangePassword: true,
        },
      });
      return tx.companyUser.create({
        data: { companyId: req.user!.companyId, userId: user.id, roleId: role.id },
        include: { user: true, role: { select: { id: true, name: true } } },
      });
    });
    await writeAudit(req, 'CREATE', 'users', membership.userId, undefined, membership);
    created(res, toUserResponse(membership));
  })
);

router.put(
  '/:id',
  requirePermission('users', 'edit'),
  [body('name').notEmpty(), body('roleId').isInt()],
  validate,
  asyncHandler(async (req, res) => {
    const userId = Number(req.params.id);
    const membership = await prisma.companyUser.findUnique({
      where: { companyId_userId: { companyId: req.user!.companyId, userId } },
      include: { user: true, role: true },
    });
    if (!membership) throw new ApiError(404, 'User not found in this company');

    const role = await prisma.role.findUnique({ where: { id: Number(req.body.roleId) } });
    if (!role) throw new ApiError(400, 'Invalid role');

    const [, updatedMembership] = await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { name: req.body.name, email: req.body.email || null, phone: req.body.phone },
      }),
      prisma.companyUser.update({
        where: { id: membership.id },
        data: { roleId: role.id },
        include: { user: true, role: { select: { id: true, name: true } } },
      }),
    ]);
    await writeAudit(req, 'UPDATE', 'users', userId, { name: membership.user.name, roleId: membership.roleId }, updatedMembership);
    ok(res, toUserResponse(updatedMembership));
  })
);

router.patch(
  '/:id/toggle-active',
  requirePermission('users', 'edit'),
  asyncHandler(async (req, res) => {
    const userId = Number(req.params.id);
    if (userId === req.user!.id) throw new ApiError(400, 'You cannot deactivate your own account.');
    const membership = await prisma.companyUser.findUnique({
      where: { companyId_userId: { companyId: req.user!.companyId, userId } },
      include: { user: true, role: { select: { id: true, name: true } } },
    });
    if (!membership) throw new ApiError(404, 'User not found in this company');
    const user = await prisma.user.update({ where: { id: userId }, data: { active: !membership.user.active } });
    await writeAudit(req, 'UPDATE', 'users.status', userId, { active: membership.user.active }, { active: user.active });
    ok(res, toUserResponse({ ...membership, user }));
  })
);

router.post(
  '/:id/reset-password',
  requirePermission('users', 'edit'),
  [body('newPassword').isLength({ min: 6 })],
  validate,
  asyncHandler(async (req, res) => {
    const userId = Number(req.params.id);
    const membership = await prisma.companyUser.findUnique({
      where: { companyId_userId: { companyId: req.user!.companyId, userId } },
    });
    if (!membership) throw new ApiError(404, 'User not found in this company');
    const passwordHash = await hashPassword(req.body.newPassword);
    await prisma.user.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: true } });
    await writeAudit(req, 'UPDATE', 'users.password', userId);
    ok(res, { reset: true });
  })
);

export default router;
