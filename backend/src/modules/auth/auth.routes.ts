import { Router } from 'express';
import crypto from 'crypto';
import { body } from 'express-validator';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok, ApiError } from '../../utils/response';
import { comparePassword, hashPassword } from '../../utils/password';
import { signToken, requireAuth } from '../../middleware/auth';
import { writeAudit } from '../../middleware/audit';
import { validate } from '../../middleware/validate';
import { sendPlainEmail } from '../email/email.service';

const router = Router();

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

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

router.post(
  '/forgot-password',
  [body('email').isEmail()],
  validate,
  asyncHandler(async (req, res) => {
    const email = String(req.body.email).toLowerCase();
    const user = await prisma.user.findFirst({ where: { email: { equals: email }, active: true } });

    // Always respond the same way whether or not the email exists, so this
    // endpoint can't be used to discover which emails have accounts. Respond
    // immediately rather than waiting on SMTP, which can be slow or broken.
    ok(res, { message: 'If that email is registered, a password reset link has been sent.' });
    if (!user) return;

    // Everything below runs after the response has already been sent, so
    // any failure here must be swallowed (logged) rather than thrown —
    // there is no response left to attach an error to.
    try {
      const rawToken = crypto.randomBytes(32).toString('hex');
      await prisma.user.update({
        where: { id: user.id },
        data: { resetTokenHash: hashToken(rawToken), resetTokenExpiry: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
      });
      await writeAudit(req, 'UPDATE', 'auth.forgot-password', user.id);

      const resetUrl = `${env.corsOrigin}/reset-password?token=${rawToken}`;
      let status: 'SENT' | 'FAILED' = 'SENT';
      let error: string | undefined;
      try {
        await sendPlainEmail({
          to: user.email!,
          subject: `Reset your ${env.appName} password`,
          text: `Hi ${user.name},\n\nSomeone requested a password reset for your ${env.appName} account (username: ${user.username}).\n\nClick this link to set a new password (valid for 1 hour):\n${resetUrl}\n\nIf you didn't request this, you can ignore this email — your password will stay the same.`,
          html: `<p>Hi ${user.name},</p><p>Someone requested a password reset for your ${env.appName} account (username: <b>${user.username}</b>).</p><p><a href="${resetUrl}">Click here to set a new password</a> (valid for 1 hour).</p><p>If you didn't request this, you can ignore this email — your password will stay the same.</p>`,
        });
      } catch (err) {
        status = 'FAILED';
        error = err instanceof Error ? err.message : 'Unknown error';
      }
      await prisma.emailLog.create({
        data: { recipient: user.email!, subject: 'Password reset', documentType: 'password-reset', documentRef: String(user.id), status, error },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('forgot-password background task failed:', err);
    }
  })
);

router.post(
  '/reset-password',
  [body('token').notEmpty(), body('newPassword').isLength({ min: 6 })],
  validate,
  asyncHandler(async (req, res) => {
    const tokenHash = hashToken(req.body.token);
    const user = await prisma.user.findFirst({ where: { resetTokenHash: tokenHash } });

    if (!user || !user.resetTokenExpiry || user.resetTokenExpiry < new Date()) {
      throw new ApiError(400, 'This reset link is invalid or has expired. Please request a new one.');
    }

    const passwordHash = await hashPassword(req.body.newPassword);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, resetTokenHash: null, resetTokenExpiry: null },
    });
    await writeAudit(req, 'UPDATE', 'auth.reset-password', user.id);
    ok(res, { reset: true });
  })
);

export default router;
