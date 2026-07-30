import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { successResponse } from '../../utils/helpers';
import { db } from '../../config/database';

const router = Router();
router.use(authMiddleware);

const ADMIN = ['Admin', 'MD', 'CEO', 'HR', 'MIS Executive'];
const canManage = (role: string) => ADMIN.includes(role);

// GET all plants
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [rows] = await db.execute<any>(
      `SELECT plant_id, plant_no, plant_name, address, is_active 
       FROM plants ORDER BY plant_no ASC`
    );
    res.json(successResponse('Plants fetched', rows));
  } catch (err) { next(err); }
});

// POST create plant
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!canManage(req.user!.roleName)) {
      res.status(403).json({ success: false, message: 'Access denied' }); return;
    }
    const { plantNo, plantName, address } = req.body;
    if (!plantNo || !plantName) {
      res.status(400).json({ success: false, message: 'Plant No. and name required' }); return;
    }
    const id = `PLT${String(plantNo).padStart(3, '0')}`;
    await db.query(
      `INSERT INTO plants (plant_id, plant_no, plant_name, address) VALUES ($1, $2, $3, $4)`,
      [id, plantNo, plantName.trim(), address || null]
    );
    res.status(201).json(successResponse('Plant created', { plant_id: id, plant_no: plantNo, plant_name: plantName }));
  } catch (err) { next(err); }
});

// PUT update plant
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!canManage(req.user!.roleName)) {
      res.status(403).json({ success: false, message: 'Access denied' }); return;
    }
    const { plantName, address } = req.body;
    await db.query(
      `UPDATE plants SET plant_name = $1, address = $2, updated_at = NOW() WHERE plant_id = $3`,
      [plantName.trim(), address || null, req.params.id]
    );
    res.json(successResponse('Plant updated'));
  } catch (err) { next(err); }
});

// PATCH toggle
router.patch('/:id/toggle', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!canManage(req.user!.roleName)) {
      res.status(403).json({ success: false, message: 'Access denied' }); return;
    }
    const [rows] = await db.execute<any>(`SELECT is_active FROM plants WHERE plant_id = $1`, [req.params.id]);
    const current = (rows as any[])[0]?.is_active;
    await db.query(`UPDATE plants SET is_active = $1, updated_at = NOW() WHERE plant_id = $2`, [!current, req.params.id]);
    res.json(successResponse('Status updated'));
  } catch (err) { next(err); }
});

// DELETE plant
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!canManage(req.user!.roleName)) {
      res.status(403).json({ success: false, message: 'Access denied' }); return;
    }
    await db.query(`DELETE FROM plants WHERE plant_id = $1`, [req.params.id]);
    res.json(successResponse('Plant deleted'));
  } catch (err) { next(err); }
});

export default router;
