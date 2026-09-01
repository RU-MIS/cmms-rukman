import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import dayjs from 'dayjs';
import dotenv from 'dotenv';

dotenv.config();

const backupDir = path.join(process.cwd(), 'backups');
if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const filename = `backup_${dayjs().format('YYYY-MM-DD_HHmmss')}.dump`;
const filepath = path.join(backupDir, filename);

const result = spawnSync('pg_dump', ['--format=custom', `--file=${filepath}`, databaseUrl], { stdio: 'inherit' });

if (result.status !== 0) {
  console.error('Backup failed. Make sure pg_dump is installed and on your PATH (it ships with PostgreSQL).');
  process.exit(result.status ?? 1);
}

console.log(`Backup written to ${filepath}`);
