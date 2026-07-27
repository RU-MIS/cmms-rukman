/**
 * server.ts
 * ─────────
 * Main Express application entry point.
 * Initializes middleware, routes, DB connection, and starts the server.
 * Also sets up graceful shutdown handling.
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';

import { env } from './config/environment';
import { createPool, db } from './config/database';
import { logger, httpLogStream } from './utils/logger';
import { errorMiddleware } from './middleware/error.middleware';

// ── Route imports ────────────────────────────────────────────────
import authRoutes       from './modules/auth/auth.routes';
import userRoutes       from './modules/users/user.routes';
import departmentRoutes from './modules/departments/department.routes';
import machineRoutes    from './modules/machines/machine.routes';
import checklistRoutes  from './modules/checklists/checklist.routes';
import taskRoutes       from './modules/tasks/task.routes';
import dashboardRoutes  from './modules/dashboard/dashboard.routes';

const app = express();

// ── Security headers ─────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// ── CORS — allow frontend origin ─────────────────────────────────
app.use(cors({
  origin: env.CORS_ORIGIN,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── Compression ───────────────────────────────────────────────────
app.use(compression());

// ── Body parsers ─────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// ── HTTP request logging ─────────────────────────────────────────
app.use(morgan(env.IS_PRODUCTION ? 'combined' : 'dev', { stream: httpLogStream }));

// ── Global rate limiter ───────────────────────────────────────────
const limiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max:      env.RATE_LIMIT_MAX_REQUESTS,
  message:  { success: false, message: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders:   false,
});
app.use('/api/', limiter);

// ── Health check — no auth required ──────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status:   'ok',
    app:      env.APP_NAME,
    company:  env.COMPANY_NAME,
    version:  '1.0.0',
    env:      env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// ── API Routes ───────────────────────────────────────────────────
app.use('/api/v1/auth',        authRoutes);
app.use('/api/v1/users',       userRoutes);
app.use('/api/v1/departments', departmentRoutes);
app.use('/api/v1/machines',    machineRoutes);
app.use('/api/v1/checklists',  checklistRoutes);
app.use('/api/v1/tasks',       taskRoutes);
app.use('/api/v1/dashboard',   dashboardRoutes);

// ── 404 handler ──────────────────────────────────────────────────
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
});

// ── Global error handler ─────────────────────────────────────────
app.use(errorMiddleware);

// ── Start server ─────────────────────────────────────────────────
async function startServer(): Promise<void> {
  try {
    // Initialize DB pool + test connection
    createPool();
    await db.testConnection();

    const server = app.listen(env.PORT, () => {
      logger.info(`🚀 ${env.APP_NAME} API running on port ${env.PORT}`);
      logger.info(`📡 Environment: ${env.NODE_ENV}`);
      logger.info(`🔗 Frontend: ${env.CORS_ORIGIN}`);
      logger.info(`❤️  Health: http://localhost:${env.PORT}/health`);
    });

    // ── Graceful shutdown ────────────────────────────────────────
    const shutdown = async (signal: string) => {
      logger.info(`\n${signal} received — shutting down gracefully...`);
      server.close(async () => {
        await db.close();
        logger.info('✅ Server closed cleanly');
        process.exit(0);
      });

      // Force exit after 10 seconds if graceful shutdown fails
      setTimeout(() => {
        logger.error('⚠️ Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));

  } catch (error) {
    logger.error('❌ Failed to start server', { error });
    process.exit(1);
  }
}

startServer();

export default app;
