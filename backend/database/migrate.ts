/**
 * migrate.ts
 * ──────────
 * Runs all SQL migration files in order.
 * Safe to run multiple times — uses CREATE TABLE IF NOT EXISTS.
 *
 * Run: npm run migrate
 * Fresh: npm run migrate:fresh (drops all tables first — USE WITH CAUTION)
 */

import fs from 'fs';
import path from 'path';
import { createPool, db } from '../src/config/database';
import { logger } from '../src/utils/logger';
import { runSeeds } from './seeds/master.seed';

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const FRESH = process.argv.includes('--fresh');

async function migrate(): Promise<void> {
  createPool();

  try {
    await db.testConnection();

    if (FRESH) {
      logger.warn('⚠️  FRESH MODE: Dropping all tables...');
      await dropAllTables();
    }

    // Get all .sql files sorted by filename (001_, 002_, etc.)
    const sqlFiles = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    logger.info(`📂 Found ${sqlFiles.length} migration files`);

    for (const file of sqlFiles) {
      const filePath = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      // Split by semicolon to handle multiple statements per file
      const statements = sql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

      for (const statement of statements) {
        await db.query(statement);
      }

      logger.info(`  ✅ ${file}`);
    }

    logger.info('📋 Migrations complete. Running seeds...');
    await runSeeds();

    logger.info('🎉 Database setup complete!');
    logger.info('');
    logger.info('Next steps:');
    logger.info('  1. npm run dev  →  Start the backend server');
    logger.info('  2. Login: username=admin, password=Admin@1234');
    logger.info('  3. CHANGE THE DEFAULT PASSWORD IMMEDIATELY');

  } catch (error) {
    logger.error('❌ Migration failed', { error });
    process.exit(1);
  } finally {
    await db.close();
  }
}

async function dropAllTables(): Promise<void> {
  await db.query('SET FOREIGN_KEY_CHECKS = 0');
  const tables = [
    'audit_logs', 'notifications', 'task_verification',
    'task_responses', 'task_master', 'machine_template_map',
    'checklist_items', 'checklist_templates', 'machine_assignments',
    'machines', 'users', 'shifts', 'departments', 'roles', 'settings'
  ];
  for (const table of tables) {
    await db.query(`DROP TABLE IF EXISTS ${table}`);
    logger.info(`  🗑️  Dropped: ${table}`);
  }
  await db.query('SET FOREIGN_KEY_CHECKS = 1');
}

migrate();
