/**
 * database.ts
 * ───────────
 * PlanetScale MySQL connection pool.
 * Uses mysql2 with promise support.
 * Pool is reused across all requests — never create new connections per query.
 *
 * PlanetScale requires SSL — this is configured automatically.
 * Uses the DATABASE_URL from env for primary config.
 *
 * Usage:
 *   import { db } from '@config/database'
 *   const [rows] = await db.execute('SELECT * FROM users WHERE id = ?', [id])
 */

import mysql from 'mysql2/promise';
import { env } from './environment';
import { logger } from '../utils/logger';

// ── Connection pool singleton ────────────────────────────────────
let pool: mysql.Pool | null = null;

/**
 * Creates and returns the MySQL connection pool.
 * Singleton — only one pool is created for the entire app lifetime.
 */
export function createPool(): mysql.Pool {
  if (pool) return pool;

  pool = mysql.createPool({
    host:               env.DB_HOST,
    user:               env.DB_USER,
    password:           env.DB_PASSWORD,
    database:           env.DB_NAME,
    port:               env.DB_PORT,
    ssl:                env.DB_SSL ? { rejectUnauthorized: true } : undefined,
    waitForConnections: true,
    connectionLimit:    10,       // Max 10 simultaneous connections
    queueLimit:         0,        // Unlimited queue (0 = no limit)
    connectTimeout:     10000,    // 10 seconds connection timeout
    idleTimeout:        60000,    // Close idle connections after 60s
    maxIdle:            5,        // Keep max 5 idle connections
    timezone:           '+05:30', // IST — India Standard Time
    decimalNumbers:     true,     // Return decimals as numbers not strings
    dateStrings:        false,    // Return dates as Date objects
  });

  logger.info('✅ MySQL connection pool created', {
    host: env.DB_HOST,
    database: env.DB_NAME,
    ssl: env.DB_SSL,
  });

  return pool;
}

/**
 * Returns the active pool.
 * Throws if pool hasn't been initialized yet.
 * Always call createPool() in server.ts before using this.
 */
export function getPool(): mysql.Pool {
  if (!pool) {
    throw new Error('Database pool not initialized. Call createPool() first.');
  }
  return pool;
}

/**
 * Shorthand getter — use this everywhere in services.
 * import { db } from '@config/database'
 * const [rows] = await db.execute(sql, params)
 */
export const db = {
  /**
   * Execute a parameterized query — use for SELECT.
   * Returns [rows, fields]
   */
  execute: async <T = mysql.RowDataPacket[]>(
    sql: string,
    params?: unknown[]
  ): Promise<[T, mysql.FieldPacket[]]> => {
    const pool = getPool();
    return pool.execute<T & mysql.RowDataPacket[]>(sql, params);
  },

  /**
   * Execute a query — use for INSERT/UPDATE/DELETE.
   * Returns [ResultSetHeader, fields]
   */
  query: async (
    sql: string,
    params?: unknown[]
  ): Promise<[mysql.ResultSetHeader, mysql.FieldPacket[]]> => {
    const pool = getPool();
    return pool.query<mysql.ResultSetHeader>(sql, params);
  },

  /**
   * Get a connection from the pool for transactions.
   * ALWAYS release the connection in a finally block.
   *
   * Example:
   *   const conn = await db.getConnection()
   *   try {
   *     await conn.beginTransaction()
   *     await conn.execute(...)
   *     await conn.commit()
   *   } catch(e) {
   *     await conn.rollback()
   *     throw e
   *   } finally {
   *     conn.release()
   *   }
   */
  getConnection: async (): Promise<mysql.PoolConnection> => {
    const pool = getPool();
    return pool.getConnection();
  },

  /**
   * Test database connectivity.
   * Called on app startup to fail fast if DB is unreachable.
   */
  testConnection: async (): Promise<void> => {
    const pool = getPool();
    const connection = await pool.getConnection();
    try {
      await connection.ping();
      logger.info('✅ Database connection test passed');
    } finally {
      connection.release();
    }
  },

  /**
   * Close all connections in the pool.
   * Called on graceful shutdown.
   */
  close: async (): Promise<void> => {
    if (pool) {
      await pool.end();
      pool = null;
      logger.info('🔌 Database pool closed');
    }
  },
};

export type DbConnection = mysql.PoolConnection;
export type QueryResult = mysql.RowDataPacket;
export type ResultSetHeader = mysql.ResultSetHeader;
