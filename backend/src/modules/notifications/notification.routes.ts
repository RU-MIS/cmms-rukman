/**
 * notification.service.ts + notification.routes.ts
 * ─────────────────────────────────────────────────
 * In-app notification management.
 */

import { db } from '../../config/database';
import { TABLE } from '../../config/constants';
import { generateId } from '../../utils/idGenerator';
import { parsePagination, buildPaginationMeta } from '../../utils/helpers';
import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { successResponse } from '../../utils/helpers';

// ── Service functions ──────────────────────────────────────────────

export async function getUserNotifications(userId: string, query: Record<string, unknown>) {
  const { page, limit, offset } = parsePagination(query);
  const onlyUnread = query.unread === 'true';

  const conditions = ['user_id = ?'];
  const params: unknown[] = [userId];

  if (onlyUnread) { conditions.push('is_read = false'); }

  const where = conditions.join(' AND ');

  const [rows] = await db.execute<any[]>(
    `SELECT * FROM ${TABLE.NOTIFICATIONS}
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const [countRows] = await db.execute<any[]>(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN is_read = false THEN 1 ELSE 0 END) AS unread
     FROM ${TABLE.NOTIFICATIONS} WHERE user_id = ?`,
    [userId]
  );

  return {
    data: rows,
    meta: buildPaginationMeta(countRows[0].total, page, limit),
    unreadCount: Number(countRows[0].unread || 0),
  };
}

export async function markAsRead(notifId: string, userId: string): Promise<void> {
  await db.query(
    `UPDATE ${TABLE.NOTIFICATIONS}
     SET is_read = true, read_at = NOW()
     WHERE notif_id = ? AND user_id = ?`,
    [notifId, userId]
  );
}

export async function markAllAsRead(userId: string): Promise<void> {
  await db.query(
    `UPDATE ${TABLE.NOTIFICATIONS}
     SET is_read = true, read_at = NOW()
     WHERE user_id = ? AND is_read = false`,
    [userId]
  );
}

export async function getUnreadCount(userId: string): Promise<number> {
  const [rows] = await db.execute<any[]>(
    `SELECT COUNT(*) AS count FROM ${TABLE.NOTIFICATIONS}
     WHERE user_id = ? AND is_read = false`,
    [userId]
  );
  return Number(rows[0].count || 0);
}

// ── Router ─────────────────────────────────────────────────────────

const router = Router();
router.use(authMiddleware);

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await getUserNotifications(req.user!.userId, req.query as any);
    res.json(successResponse('Notifications', result.data, result.meta));
  } catch (err) { next(err); }
});

router.get('/unread-count', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const count = await getUnreadCount(req.user!.userId);
    res.json(successResponse('Unread count', { count }));
  } catch (err) { next(err); }
});

router.patch('/:id/read', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await markAsRead(req.params.id, req.user!.userId);
    res.json(successResponse('Notification marked as read'));
  } catch (err) { next(err); }
});

router.patch('/mark-all-read', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await markAllAsRead(req.user!.userId);
    res.json(successResponse('All notifications marked as read'));
  } catch (err) { next(err); }
});

export default router;
