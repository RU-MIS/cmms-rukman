import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { successResponse } from '../../utils/helpers';
import { db } from '../../config/database';
import { generateId } from '../../utils/idGenerator';

const router = Router();
router.use(authMiddleware);

const ADMIN = ['Admin', 'MD', 'CEO', 'HR', 'MIS Executive'];
const canManage = (role: string) => ADMIN.includes(role);

// GET all shifts
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [rows] = await db.execute<any>(
      `SELECT shift_id, shift_name, start_time, end_time, is_active FROM shifts ORDER BY shift_name ASC`
    );
    res.json(successResponse('Shifts fetched', rows));
  } catch (err) { next(err); }
});

// POST create shift
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!canManage(req.user!.roleName)) { res.status(403).json({ success: false, message: 'Access denied' }); return; }
    const { shiftName, startTime, endTime } = req.body;
    if (!shiftName?.trim() || !startTime || !endTime) {
      res.status(400).json({ success: false, message: 'All fields required' }); return;
    }
    const id = await generateId('SHF' as any);
    await db.query(
      `INSERT INTO shifts (shift_id, shift_name, start_time, end_time) VALUES ($1, $2, $3, $4)`,
      [id, shiftName.trim(), startTime, endTime]
    );
    res.status(201).json(successResponse('Shift created', { shift_id: id, shift_name: shiftName }));
  } catch (err) { next(err); }
});

// PUT update shift
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!canManage(req.user!.roleName)) { res.status(403).json({ success: false, message: 'Access denied' }); return; }
    const { shiftName, startTime, endTime } = req.body;
    await db.query(
      `UPDATE shifts SET shift_name = $1, start_time = $2, end_time = $3 WHERE shift_id = $4`,
      [shiftName.trim(), startTime, endTime, req.params.id]
    );
    res.json(successResponse('Shift updated'));
  } catch (err) { next(err); }
});

// PATCH toggle active
router.patch('/:id/toggle', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!canManage(req.user!.roleName)) { res.status(403).json({ success: false, message: 'Access denied' }); return; }
    const [rows] = await db.execute<any>(`SELECT is_active FROM shifts WHERE shift_id = $1`, [req.params.id]);
    const current = (rows as any[])[0]?.is_active;
    await db.query(`UPDATE shifts SET is_active = $1 WHERE shift_id = $2`, [!current, req.params.id]);
    res.json(successResponse('Status updated'));
  } catch (err) { next(err); }
});

export default router;
