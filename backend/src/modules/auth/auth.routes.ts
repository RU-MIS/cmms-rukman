import { Router } from 'express';
import { body } from 'express-validator';
import { prisma } from '../../config/prisma';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok, ApiError } from '../../utils/response';
import { comparePassword, hashPassword } from '../../utils/password';
import { signToken, requireAuth } from '../../middleware/auth';
import { writeAudit } from '../../middleware/audit';
import { validate } from '../../middleware/validate';

const router = Router();

router.post(
  '/login',
  [body('username').notEmpty(), body('password').notEmpty()],
  validate,
  asyncHandler(async (req, res) => {
    const { username, password } = req.body;
    const user = await prisma.user.findUnique({
      where: { username },
      include: { role: true },
    });
    if (!user || !user.active) throw new ApiError(401, 'Invalid username or password');

    const match = await comparePassword(password, user.passwordHash);
    if (!match) throw new ApiError(401, 'Invalid username or password');

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const token = signToken(user.id);

    req.user = { id: user.id, username: user.username, name: user.name, roleId: user.roleId, roleName: user.role.name };
    await writeAudit(req, 'LOGIN', 'auth', user.id);

    ok(res, {
      token,
      user: { id: user.id, username: user.username, name: user.name, email: user.email, role: user.role.name },
    });
  })
);

router.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    await writeAudit(req, 'LOGOUT', 'auth', req.user!.id);
    ok(res, { loggedOut: true });
  })
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { id: true, username: true, name: true, email: true, phone: true, role: { select: { name: true } } },
    });
    ok(res, user);
  })
);

router.post(
  '/change-password',
  requireAuth,
  [body('currentPassword').notEmpty(), body('newPassword').isLength({ min: 6 })],
  validate,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    const match = await comparePassword(req.body.currentPassword, user.passwordHash);
    if (!match) throw new ApiError(400, 'Current password is incorrect');

    const passwordHash = await hashPassword(req.body.newPassword);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    await writeAudit(req, 'UPDATE', 'auth.password', user.id);
    ok(res, { changed: true });
  })
);

export default router;
