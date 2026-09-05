/**
 * Standalone pre-deploy environment check — validates configuration without
 * starting the server (no port bound, no HTTP listener). Run this on the
 * server after setting up `backend/.env` and before the first
 * `pm2 start`/`npm run start`, so a misconfiguration is caught by a command
 * you run and read, not by a crashed process in your process manager's logs.
 *
 * Exit code 0 = safe to start. Exit code 1 = fix the printed problem(s) first.
 */

function main() {
  // Loaded inside the try block (not as a top-level import) so a thrown
  // config error — e.g. a weak JWT_SECRET in production — is caught and
  // printed cleanly here instead of surfacing as an unhandled exception.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { env, validateProductionEnv } = require('../src/config/env');
  validateProductionEnv();

  console.log(`Environment OK for NODE_ENV=${env.nodeEnv}.`);
  console.log(`  PORT: ${env.port}`);
  console.log(`  CORS_ORIGIN: ${env.corsOrigin}`);
  console.log(`  JWT_SECRET: set (${String(process.env.JWT_SECRET || '').length} chars)`);
  console.log(`  DATABASE_URL: ${process.env.DATABASE_URL ? 'set' : 'NOT SET'}`);
  console.log(`  BCRYPT_ROUNDS: ${env.bcryptRounds}`);
  console.log(`  GST lookup configured: ${Boolean(env.gst.apiKey && env.gst.apiBaseUrl)}`);

  if (!env.isProduction) {
    console.log(
      '\nNote: NODE_ENV is not "production" — the strict checks (JWT_SECRET strength, ' +
        'CORS_ORIGIN not localhost, DATABASE_URL required) only run when NODE_ENV=production. ' +
        'Set NODE_ENV=production in backend/.env and re-run this before deploying.'
    );
  }
}

try {
  main();
  process.exit(0);
} catch (err) {
  console.error('Environment validation FAILED — do not start the server:\n');
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
