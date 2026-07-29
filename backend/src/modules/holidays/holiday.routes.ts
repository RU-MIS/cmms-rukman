import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { successResponse } from '../../utils/helpers';
import { db } from '../../config/database';
import { generateId } from '../../utils/idGenerator';

const router = Router();
router.use(authMiddleware);

const ALLOWED_ROLES = ['Admin', 'MD', 'CEO', 'HR', 'MIS Executive'];

function canManage(roleName: string): boolean {
  return ALLOWED_ROLES.includes(roleName);
}

// GET all holidays
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const year = req.query.year || new Date().getFullYear();
    const [rows] = await db.execute<any>(
      `SELECT * FROM holidays 
       WHERE EXTRACT(YEAR FROM holiday_date) = $1
       ORDER BY holiday_date ASC`,
      [year]
    );
    res.json(successResponse('Holidays fetched', rows));
  } catch (err) { next(err); }
});

// POST create holiday
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!canManage(req.user!.roleName)) {
      res.status(403).json({ success: false, message: 'Access denied' });
      return;
    }
    const { holidayName, holidayDate, holidayType, isRecurring, description } = req.body;
    if (!holidayName || !holidayDate) {
      res.status(400).json({ success: false, message: 'Name and date required' });
      return;
    }
    const id = await generateId('HOL' as any);
    await db.query(
      `INSERT INTO holidays (holiday_id, holiday_name, holiday_date, holiday_type, is_recurring, description, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, holidayName, holidayDate, holidayType || 'National', isRecurring || false, description || null, req.user!.userId]
    );
    const [rows] = await db.execute<any>(`SELECT * FROM holidays WHERE holiday_id = $1`, [id]);
    res.status(201).json(successResponse('Holiday added', (rows as any[])[0]));
  } catch (err) { next(err); }
});

// PUT update holiday
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!canManage(req.user!.roleName)) {
      res.status(403).json({ success: false, message: 'Access denied' });
      return;
    }
    const { holidayName, holidayDate, holidayType, isRecurring, description } = req.body;
    await db.query(
      `UPDATE holidays SET 
        holiday_name = $1, holiday_date = $2, holiday_type = $3,
        is_recurring = $4, description = $5, updated_at = NOW()
       WHERE holiday_id = $6`,
      [holidayName, holidayDate, holidayType, isRecurring, description, req.params.id]
    );
    res.json(successResponse('Holiday updated'));
  } catch (err) { next(err); }
});

// DELETE holiday
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!canManage(req.user!.roleName)) {
      res.status(403).json({ success: false, message: 'Access denied' });
      return;
    }
    await db.query(`DELETE FROM holidays WHERE holiday_id = $1`, [req.params.id]);
    res.json(successResponse('Holiday deleted'));
  } catch (err) { next(err); }
});

// GET check if date is holiday/sunday
router.get('/check/:date', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const date = new Date(req.params.date);
    const isSunday = date.getDay() === 0;
    const [rows] = await db.execute<any>(
      `SELECT * FROM holidays WHERE holiday_date = $1`, [req.params.date]
    );
    const holiday = (rows as any[])[0] || null;
    res.json(successResponse('Date checked', {
      date: req.params.date,
      isSunday,
      isHoliday: !!holiday || isSunday,
      holiday,
    }));
  } catch (err) { next(err); }
});

export default router;
