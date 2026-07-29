/**
 * database.ts — PostgreSQL version for Render deployment
 */

import { Pool, PoolClient, QueryResult } from 'pg';
import { env } from './environment';
import { logger } from '../utils/logger';

let pool: Pool | null = null;

export function createPool(): Pool {
  if (pool) return pool;

  pool = new Pool({
    connectionString: env.DATABASE_URL,
    ssl: env.DB_SSL ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 60000,
    connectionTimeoutMillis: 10000,
  });

  pool.on('error', (err) => {
    logger.error('PostgreSQL pool error', { err });
  });

  logger.info('✅ PostgreSQL connection pool created');
  return pool;
}

export function getPool(): Pool {
  if (!pool) throw new Error('Database pool not initialized.');
  return pool;
}

export const db = {
  execute: async <T = any>(sql: string, params?: any[]): Promise<[T[], any]> => {
    const p = getPool();
    // Convert MySQL ? placeholders to PostgreSQL $1, $2...
    let pgSql = sql;
    let i = 0;
    pgSql = pgSql.replace(/\?/g, () => `$${++i}`);
    const result = await p.query(pgSql, params);
    return [result.rows as T[], result.fields];
  },

  query: async (sql: string, params?: any[]): Promise<[any, any]> => {
    const p = getPool();
    let pgSql = sql;
    let i = 0;
    pgSql = pgSql.replace(/\?/g, () => `$${++i}`);
    const result = await p.query(pgSql, params);
    return [{ affectedRows: result.rowCount, insertId: 0 }, result.fields];
  },

  getConnection: async (): Promise<PoolClient & { beginTransaction: () => Promise<void>; commit: () => Promise<void>; rollback: () => Promise<void>; release: () => void; ping: () => Promise<void> }> => {
    const p = getPool();
    const client = await p.connect() as any;
    client.beginTransaction = () => client.query('BEGIN');
    client.commit = () => client.query('COMMIT');
    client.rollback = () => client.query('ROLLBACK');
    client.ping = () => client.query('SELECT 1');
    client.execute = async (sql: string, params?: any[]) => {
      let pgSql = sql;
      let i = 0;
      pgSql = pgSql.replace(/\?/g, () => `$${++i}`);
      const result = await client.query(pgSql, params);
      return [result.rows, result.fields];
    };
    return client;
  },

  testConnection: async (): Promise<void> => {
    const p = getPool();
    const client = await p.connect();
    try {
      await client.query('SELECT 1');
      logger.info('✅ Database connection test passed');
    } finally {
      client.release();
    }
  },

  close: async (): Promise<void> => {
    if (pool) {
      await pool.end();
      pool = null;
      logger.info('🔌 Database pool closed');
    }
  },
};

export type DbConnection = PoolClient;
