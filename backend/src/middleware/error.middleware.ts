/**
 * error.middleware.ts
 * ───────────────────
 * Global error handler — catches all errors thrown in routes/services.
 * Formats them into consistent API responses.
 * Never exposes stack traces in production.
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { env } from '../config/environment';

// ── Custom error class ────────────────────────────────────────────
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly code?: string;

  constructor(message: string, statusCode = 500, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    this.code = code;
    Error.captureStackTrace(this, this.constructor);
  }
}

// ── Common error factories ────────────────────────────────────────
export const AppErrors = {
  notFound:      (resource = 'Resource') => new AppError(`${resource} not found`, 404, 'NOT_FOUND'),
  unauthorized:  ()                      => new AppError('Unauthorized. Please login again.', 401, 'UNAUTHORIZED'),
  forbidden:     ()                      => new AppError('Access denied. Insufficient permissions.', 403, 'FORBIDDEN'),
  badRequest:    (msg: string)           => new AppError(msg, 400, 'BAD_REQUEST'),
  conflict:      (msg: string)           => new AppError(msg, 409, 'CONFLICT'),
  serverError:   (msg = 'Internal server error') => new AppError(msg, 500, 'SERVER_ERROR'),
};

// ── Global error middleware ───────────────────────────────────────
export function errorMiddleware(
  err: Error | AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Log the error
  logger.error('Request error', {
    message: err.message,
    stack: err.stack,
    ...(err instanceof AppError && { code: err.code, statusCode: err.statusCode }),
  });

  // Handle known operational errors
  if (err instanceof AppError && err.isOperational) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      code: err.code,
    });
    return;
  }

  // Handle MySQL duplicate entry error
  if ((err as any).code === 'ER_DUP_ENTRY') {
    res.status(409).json({
      success: false,
      message: 'This record already exists.',
      code: 'DUPLICATE_ENTRY',
    });
    return;
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    res.status(401).json({
      success: false,
      message: 'Invalid token. Please login again.',
      code: 'INVALID_TOKEN',
    });
    return;
  }

  if (err.name === 'TokenExpiredError') {
    res.status(401).json({
      success: false,
      message: 'Session expired. Please login again.',
      code: 'TOKEN_EXPIRED',
    });
    return;
  }

  // Unknown / unexpected errors — don't leak details in production
  res.status(500).json({
    success: false,
    message: 'Something went wrong. Please try again.',
    code: 'SERVER_ERROR',
    ...(env.IS_DEVELOPMENT && { debug: err.message, stack: err.stack }),
  });
}
