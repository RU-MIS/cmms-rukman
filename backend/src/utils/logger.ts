/**
 * logger.ts
 * ─────────
 * Structured Winston logger.
 * Dev: colorized console output
 * Prod: JSON format (Cloud Run picks this up automatically)
 *
 * Usage:
 *   import { logger } from '@utils/logger'
 *   logger.info('User logged in', { userId: 'USR000001' })
 *   logger.error('DB failed', { error: err.message })
 */

import winston from 'winston';

const { combine, timestamp, printf, colorize, json, errors } = winston.format;

// ── Dev format: readable colorized output ────────────────────────
const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length
      ? '\n  ' + JSON.stringify(meta, null, 2).replace(/\n/g, '\n  ')
      : '';
    return `${timestamp} [${level}]: ${stack || message}${metaStr}`;
  })
);

// ── Prod format: JSON for Cloud Run / log aggregators ────────────
const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json()
);

// ── Create logger instance ───────────────────────────────────────
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: process.env.NODE_ENV === 'production' ? prodFormat : devFormat,
  transports: [
    new winston.transports.Console(),
  ],
  // Don't crash on unhandled exceptions — log them instead
  exceptionHandlers: [new winston.transports.Console()],
  rejectionHandlers: [new winston.transports.Console()],
});

/**
 * HTTP request logger — used by Morgan middleware.
 * Writes to the winston stream so all logs are unified.
 */
export const httpLogStream = {
  write: (message: string) => {
    logger.http(message.trim());
  },
};
