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

const url = new URL(databaseUrl);
const dbName = url.pathname.replace(/^\//, '');

const filename = `backup_${dayjs().format('YYYY-MM-DD_HHmmss')}.sql`;
const filepath = path.join(backupDir, filename);
const outFd = fs.openSync(filepath, 'w');

const result = spawnSync(
  'mysqldump',
  ['-h', url.hostname, '-P', url.port || '3306', '-u', url.username, '--single-transaction', '--routines', '--triggers', dbName],
  { stdio: ['ignore', outFd, 'inherit'], env: { ...process.env, MYSQL_PWD: url.password } }
);
fs.closeSync(outFd);

if (result.status !== 0) {
  fs.unlinkSync(filepath);
  console.error('Backup failed. Make sure mysqldump is installed and on your PATH (it ships with MySQL).');
  process.exit(result.status ?? 1);
}

console.log(`Backup written to ${filepath}`);
