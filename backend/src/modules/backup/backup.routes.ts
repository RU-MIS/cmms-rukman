import { Router } from 'express';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import dayjs from 'dayjs';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok, ApiError } from '../../utils/response';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { writeAudit } from '../../middleware/audit';

const router = Router();
router.use(requireAuth);

const backupDir = path.join(process.cwd(), 'backups');

function ensureDir() {
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
}

router.get(
  '/',
  requirePermission('backup', 'view'),
  asyncHandler(async (_req, res) => {
    ensureDir();
    const files = fs
      .readdirSync(backupDir)
      .filter((f) => f.endsWith('.dump'))
      .map((f) => {
        const stat = fs.statSync(path.join(backupDir, f));
        return { filename: f, sizeBytes: stat.size, createdAt: stat.birthtime };
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    ok(res, files);
  })
);

router.post(
  '/run',
  requirePermission('backup', 'create'),
  asyncHandler(async (req, res) => {
    ensureDir();
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new ApiError(500, 'DATABASE_URL is not configured');

    const filename = `backup_${dayjs().format('YYYY-MM-DD_HHmmss')}.dump`;
    const filepath = path.join(backupDir, filename);
    const result = spawnSync('pg_dump', ['--format=custom', `--file=${filepath}`, databaseUrl]);

    if (result.status !== 0) {
      throw new ApiError(500, `Backup failed: ${result.stderr?.toString() || 'pg_dump is not installed on this server'}`);
    }
    await writeAudit(req, 'CREATE', 'backup', undefined, undefined, { filename });
    ok(res, { filename, createdAt: new Date() });
  })
);

router.get(
  '/download/:filename',
  requirePermission('backup', 'export'),
  asyncHandler(async (req, res) => {
    const filename = path.basename(req.params.filename);
    const filepath = path.join(backupDir, filename);
    if (!fs.existsSync(filepath)) throw new ApiError(404, 'Backup file not found');
    res.download(filepath);
  })
);

export default router;
