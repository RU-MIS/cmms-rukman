import dotenv from 'dotenv';
dotenv.config();

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  appName: process.env.APP_NAME || 'BusinessFlow ERP',
  companyName: process.env.COMPANY_NAME || 'My Company',
  port: parseInt(process.env.PORT || '4000', 10),
  jwtSecret: required('JWT_SECRET', 'dev_only_insecure_secret_change_me_32chars'),
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
