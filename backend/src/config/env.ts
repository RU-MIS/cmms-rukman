import dotenv from 'dotenv';
dotenv.config();

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

// A short, deliberately non-exhaustive blocklist of values people paste from
// examples/docs — not a strength check, just a guard against the most common
// way to accidentally ship a well-known secret to production.
const KNOWN_WEAK_JWT_SECRETS = new Set([
  'dev_only_insecure_secret_change_me_32chars',
  'change_this_to_a_random_32_char_minimum_secret',
  'secret',
  'changeme',
  'change_me',
  'your_jwt_secret_here',
  'your-secret-key',
  'jwt_secret',
  'password',
]);

function resolveJwtSecret(): string {
  const value = process.env.JWT_SECRET;

  if (!isProduction) {
    // Local/dev convenience only — never used when NODE_ENV=production.
    return value || 'dev_only_insecure_secret_change_me_32chars';
  }

  if (!value) {
    throw new Error(
      'JWT_SECRET is required when NODE_ENV=production. Set a long, random ' +
        'secret (32+ characters) in backend/.env before starting the server. ' +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\""
    );
  }
  if (value.length < 32) {
    throw new Error(
      `JWT_SECRET is too short for production (${value.length} chars, minimum 32). ` +
        "Generate a strong secret with: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\""
    );
  }
  if (KNOWN_WEAK_JWT_SECRETS.has(value.toLowerCase())) {
    throw new Error(
      'JWT_SECRET is set to a well-known placeholder value and must not be used in production. ' +
        "Generate a strong secret with: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\""
    );
  }
  return value;
}

export const env = {
  nodeEnv,
  isProduction,
  appName: process.env.APP_NAME || 'BusinessFlow ERP',
  companyName: process.env.COMPANY_NAME || 'My Company',
  port: parseInt(process.env.PORT || '4000', 10),
  jwtSecret: resolveJwtSecret(),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '10', 10),
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '1000', 10),
  fileSizeLimitMb: parseInt(process.env.FILE_SIZE_LIMIT_MB || '5', 10),
  uploadDir: process.env.UPLOAD_DIR || 'uploads',
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    from: process.env.EMAIL_FROM || 'BusinessFlow ERP <no-reply@example.com>',
  },
  // GST lookup provider — optional. Unset until a plan is purchased; the
  // provider name is a free-text label only, kept deliberately generic so
  // switching vendors later never requires touching frontend code.
  gst: {
    apiKey: process.env.GST_API_KEY || '',
    apiBaseUrl: process.env.GST_API_BASE_URL || '',
    provider: process.env.GST_API_PROVIDER || '',
  },
};

// Extra checks beyond resolveJwtSecret() that only make sense once the rest
// of `env` above is built — called explicitly from server.ts before the
// server starts listening, so a misconfiguration fails startup with one
// clear message instead of surfacing later as a broken login or open CORS.
export function validateProductionEnv(): void {
  if (!isProduction) return;

  const problems: string[] = [];

  if (!process.env.DATABASE_URL) {
    problems.push('DATABASE_URL is not set.');
  }
  if (!process.env.CORS_ORIGIN || process.env.CORS_ORIGIN.includes('localhost')) {
    problems.push(
      'CORS_ORIGIN is missing or still points at localhost — set it to your real frontend URL (e.g. https://app.yourdomain.com).'
    );
  }

  if (problems.length > 0) {
    throw new Error(
      'Refusing to start in production due to invalid configuration:\n' +
        problems.map((p) => `  - ${p}`).join('\n')
    );
  }
}
