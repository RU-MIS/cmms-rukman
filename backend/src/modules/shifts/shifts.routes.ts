import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { successResponse } from '../../utils/helpers';
import { db } from '../../config/database';

const router = Router();
router.use(authMiddleware);

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [rows] = await db.execute<any>(
      `SELECT shift_id, shift_name, start_time, end_time FROM shifts WHERE is_active = true ORDER BY shift_name`
    );
    res.json(successResponse('Shifts fetched', rows));
  } catch (err) { next(err); }
});

export default router;
