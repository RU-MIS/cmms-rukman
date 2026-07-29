import { createPool, db } from '../src/config/database';
import { logger } from '../src/utils/logger';

async function check() {
  createPool();
  await db.testConnection();
  
  const [tables] = await db.execute<any>(
    `SELECT table_name FROM information_schema.tables 
     WHERE table_schema = 'public' ORDER BY table_name`
  );
  
  logger.info('Tables in database:');
  (tables as any[]).forEach((t: any) => logger.info(`  - ${t.table_name}`));
  
  await db.close();
}

check().catch(err => { console.error(err); process.exit(1); });
