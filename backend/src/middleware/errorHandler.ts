import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { ApiError } from '../utils/response';

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.path}` });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ success: false, message: err.message, details: err.details });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return res.status(409).json({ success: false, message: 'A record with this value already exists.' });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ success: false, message: 'Record not found.' });
    }
    return res.status(400).json({ success: false, message: 'Database request error.', code: err.code });
  }
  // eslint-disable-next-line no-console
  console.error(err);
  const message = err instanceof Error ? err.message : 'Internal server error';
  return res.status(500).json({ success: false, message: process.env.NODE_ENV === 'production' ? 'Internal server error' : message });
}
