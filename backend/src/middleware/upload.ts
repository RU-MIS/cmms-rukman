import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { env } from '../config/env';
import { ApiError } from '../utils/response';

const uploadRoot = path.join(process.cwd(), env.uploadDir);
if (!fs.existsSync(uploadRoot)) fs.mkdirSync(uploadRoot, { recursive: true });

const ALLOWED_EXT = new Set(['.xlsx', '.xls', '.csv', '.png', '.jpg', '.jpeg', '.pdf']);
const ALLOWED_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'image/png',
  'image/jpeg',
  'application/pdf',
]);

function sanitizeFilename(name: string): string {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${Date.now()}_${base}`;
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadRoot),
  filename: (_req, file, cb) => cb(null, sanitizeFilename(file.originalname)),
});

export const upload = multer({
  storage,
  limits: { fileSize: env.fileSizeLimitMb * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.has(ext) || !ALLOWED_MIME.has(file.mimetype)) {
      return cb(new ApiError(400, `Unsupported file type: ${file.originalname}`));
    }
    cb(null, true);
  },
});
