/**
 * migrate.ts — PostgreSQL version (fixed - one statement per file)
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

    const sqlFiles = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
    logger.info(`📂 Found ${sqlFiles.length} migration files`);

    for (const file of sqlFiles) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8').trim();
      try {
        await db.query(sql);
        logger.info(`  ✅ ${file}`);
      } catch (err: any) {
        if (err.code === '42P07') {
          logger.info(`  ⏭️  ${file} (already exists)`);
          continue;
        }
        logger.error(`  ❌ ${file}: ${err.message}`);
        throw err;
      }
    }

    logger.info('📋 Migrations complete. Running seeds...');
    await runSeeds();
    logger.info('🎉 Database setup complete!');
    logger.info('Default login → username: admin | password: Admin@1234');

  } catch (error) {
    logger.error('❌ Migration failed', { error });
    process.exit(1);
  } finally {
    await db.close();
  }
}

async function dropAllTables(): Promise<void> {
  const tables = [
    'audit_logs','notifications','task_verification','task_responses',
    'task_master','machine_template_map','checklist_items','checklist_templates',
    'machine_assignments','machines','users','shifts','departments','roles','settings'
  ];
  for (const table of tables) {
    await db.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
    logger.info(`  🗑️  Dropped: ${table}`);
  }
}

migrate();
