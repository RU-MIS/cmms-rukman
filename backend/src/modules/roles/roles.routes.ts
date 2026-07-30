import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { successResponse } from '../../utils/helpers';
import { db } from '../../config/database';
import { generateId } from '../../utils/idGenerator';

const router = Router();
router.use(authMiddleware);

const ADMIN = ['Admin', 'MD', 'CEO', 'HR', 'MIS Executive'];
const canManage = (role: string) => ADMIN.includes(role);

// GET all roles
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [rows] = await db.execute<any>(
      `SELECT role_id, role_name, is_active FROM roles ORDER BY role_name ASC`
    );
    res.json(successResponse('Roles fetched', rows));
  } catch (err) { next(err); }
});

// POST create role
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!canManage(req.user!.roleName)) { res.status(403).json({ success: false, message: 'Access denied' }); return; }
    const { roleName } = req.body;
    if (!roleName?.trim()) { res.status(400).json({ success: false, message: 'Role name required' }); return; }
    const id = await generateId('ROL' as any);
    await db.query(`INSERT INTO roles (role_id, role_name, permissions) VALUES ($1, $2, $3)`, [id, roleName.trim(), '{}']);
    res.status(201).json(successResponse('Role created', { role_id: id, role_name: roleName.trim() }));
  } catch (err) { next(err); }
});

// PUT update role
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!canManage(req.user!.roleName)) { res.status(403).json({ success: false, message: 'Access denied' }); return; }
    const { roleName } = req.body;
    await db.query(`UPDATE roles SET role_name = $1 WHERE role_id = $2`, [roleName.trim(), req.params.id]);
    res.json(successResponse('Role updated'));
  } catch (err) { next(err); }
});

// PATCH toggle active
router.patch('/:id/toggle', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!canManage(req.user!.roleName)) { res.status(403).json({ success: false, message: 'Access denied' }); return; }
    const [rows] = await db.execute<any>(`SELECT is_active FROM roles WHERE role_id = $1`, [req.params.id]);
    const current = (rows as any[])[0]?.is_active;
    await db.query(`UPDATE roles SET is_active = $1 WHERE role_id = $2`, [!current, req.params.id]);
    res.json(successResponse('Status updated'));
  } catch (err) { next(err); }
});

export default router;
