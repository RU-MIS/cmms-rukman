import path from 'path';
import { execSync, spawnSync } from 'child_process';
import dotenv from 'dotenv';
import { resolveTestDatabaseUrl, testDatabaseName } from './testDbUrl';

/**
 * Runs once before the whole test run. Drops and recreates a dedicated test
 * database (never the developer's real dev/demo database — see
 * testDbUrl.ts), then applies every migration to it with the same
 * production-safe command the README documents (`prisma migrate deploy`).
 * Every test file starts from this same known-clean schema.
 */
export default async function globalSetup() {
  dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
  const testDatabaseUrl = resolveTestDatabaseUrl();
  const dbName = testDatabaseName(testDatabaseUrl);
  const url = new URL(testDatabaseUrl);
  const backendDir = path.join(__dirname, '..', '..');

  const reset = spawnSync(
    'mysql',
    ['-h', url.hostname, '-P', url.port || '3306', '-u', url.username, '-e', `DROP DATABASE IF EXISTS \`${dbName}\`; CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4;`],
    { stdio: 'inherit', env: { ...process.env, MYSQL_PWD: url.password } }
  );
  if (reset.status !== 0) {
    throw new Error('Failed to reset the test database — is MySQL running and the `mysql` client installed?');
  }

  execSync('npx prisma migrate deploy', {
    cwd: backendDir,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: testDatabaseUrl },
  });
}
