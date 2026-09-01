import { spawnSync } from 'child_process';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run restore -- <path-to-backup-file>');
  process.exit(1);
}
if (!fs.existsSync(file)) {
  console.error(`Backup file not found: ${file}`);
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

console.log('WARNING: This will overwrite data in the target database with the backup contents.');
const result = spawnSync('pg_restore', ['--clean', '--if-exists', '--no-owner', `--dbname=${databaseUrl}`, file], { stdio: 'inherit' });

if (result.status !== 0) {
  console.error('Restore failed. Make sure pg_restore is installed and on your PATH (it ships with PostgreSQL).');
  process.exit(result.status ?? 1);
}

console.log('Restore complete.');
