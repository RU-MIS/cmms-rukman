import path from 'path';
import dotenv from 'dotenv';
import { resolveTestDatabaseUrl } from './testDbUrl';

// Runs before the test framework and before the test file's own imports —
// so this must set DATABASE_URL/NODE_ENV before anything under src/config
// is loaded. dotenv.config() never overwrites a key already present in
// process.env, so setting these first guarantees the app's own
// dotenv.config() call (inside src/config/env.ts) can't override them.
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = resolveTestDatabaseUrl();
