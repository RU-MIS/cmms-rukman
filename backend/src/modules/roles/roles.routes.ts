import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { successResponse } from '../../utils/helpers';
import { db } from '../../config/database';

const router = Router();
router.use(authMiddleware);

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [rows] = await db.execute<any>(
      `SELECT role_id, role_name FROM roles WHERE is_active = true ORDER BY role_name ASC`
    );
    res.json(successResponse('Roles fetched', rows));
  } catch (err) { next(err); }
});

export default router;
