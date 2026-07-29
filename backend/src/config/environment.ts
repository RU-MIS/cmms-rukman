import dotenv from 'dotenv';
import path from 'path';

// Load .env from backend root directory directly
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function required(key: string): string {
  const value = process.env[key];
  if (!value || value.trim() === '') {
    throw new Error(`❌ Missing required environment variable: ${key}`);
  }
  return value.trim();
}

function optional(key: string, defaultValue: string): string {
  return process.env[key]?.trim() || defaultValue;
}

export const env = {
  NODE_ENV: optional('NODE_ENV', 'development'),
  IS_PRODUCTION: optional('NODE_ENV', 'development') === 'production',
  IS_DEVELOPMENT: optional('NODE_ENV', 'development') === 'development',
  APP_NAME: optional('APP_NAME', 'CMMS Pro'),
  COMPANY_NAME: optional('COMPANY_NAME', 'Rukman Udyog'),
  APP_URL: optional('APP_URL', 'http://localhost:3000'),
  API_URL: optional('API_URL', 'http://localhost:4000'),
  PORT: parseInt(optional('PORT', '4000'), 10),

  DATABASE_URL: optional('DATABASE_URL', ''),
  DB_HOST: optional('DB_HOST', 'localhost'),
  DB_USER: optional('DB_USER', 'root'),
  DB_PASSWORD: optional('DB_PASSWORD', ''),
  DB_NAME: optional('DB_NAME', 'cmms_rukman'),
  DB_PORT: parseInt(optional('DB_PORT', '3306'), 10),
  DB_SSL: optional('DB_SSL', 'false') === 'true',

  JWT_SECRET: optional('JWT_SECRET', 'fallback_secret_key_32chars_minimum'),
  JWT_EXPIRES_IN: optional('JWT_EXPIRES_IN', '8h'),
  JWT_REFRESH_SECRET: optional('JWT_REFRESH_SECRET', 'fallback_refresh_key_32chars_min'),
  JWT_REFRESH_EXPIRES_IN: optional('JWT_REFRESH_EXPIRES_IN', '7d'),

  GOOGLE_SERVICE_ACCOUNT_EMAIL: optional('GOOGLE_SERVICE_ACCOUNT_EMAIL', ''),
  GOOGLE_PRIVATE_KEY: optional('GOOGLE_PRIVATE_KEY', '').replace(/\\n/g, '\n'),
  GOOGLE_DRIVE_FOLDER_ID: optional('GOOGLE_DRIVE_FOLDER_ID', ''),

  GMAIL_USER: optional('GMAIL_USER', ''),
  GMAIL_APP_PASSWORD: optional('GMAIL_APP_PASSWORD', ''),
  EMAIL_FROM: optional('EMAIL_FROM', 'CMMS Pro <noreply@rukman.com>'),

  GCHAT_WEBHOOK_URL: optional('GCHAT_WEBHOOK_URL', ''),

  BCRYPT_ROUNDS: parseInt(optional('BCRYPT_ROUNDS', '12'), 10),
  CORS_ORIGIN: optional('CORS_ORIGIN', 'http://localhost:3000'),
  RATE_LIMIT_WINDOW_MS: parseInt(optional('RATE_LIMIT_WINDOW_MS', '900000'), 10),
  RATE_LIMIT_MAX_REQUESTS: parseInt(optional('RATE_LIMIT_MAX_REQUESTS', '100'), 10),

  LOG_LEVEL: optional('LOG_LEVEL', 'debug'),
} as const;

export type Environment = typeof env;
