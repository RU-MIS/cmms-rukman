/**
 * environment.ts
 * ──────────────
 * Centralised environment variable loader + validator.
 * App will CRASH on startup if any required variable is missing.
 * This prevents silent failures in production.
 *
 * Usage: import { env } from '@config/environment'
 */

import dotenv from 'dotenv';
import path from 'path';

// Load .env from project root (two levels up from src/config/)
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// ── Helper: throws if env var is missing ────────────────────────
function required(key: string): string {
  const value = process.env[key];
  if (!value || value.trim() === '') {
    throw new Error(`❌ Missing required environment variable: ${key}`);
  }
  return value.trim();
}

// ── Helper: optional with default ───────────────────────────────
function optional(key: string, defaultValue: string): string {
  return process.env[key]?.trim() || defaultValue;
}

// ── Helper: parse integer env var ───────────────────────────────
function requiredInt(key: string): number {
  const value = required(key);
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`❌ Environment variable ${key} must be a valid integer`);
  }
  return parsed;
}

// ── Validated environment object ────────────────────────────────
export const env = {
  // App
  NODE_ENV: optional('NODE_ENV', 'development'),
  IS_PRODUCTION: optional('NODE_ENV', 'development') === 'production',
  IS_DEVELOPMENT: optional('NODE_ENV', 'development') === 'development',
  APP_NAME: optional('APP_NAME', 'CMMS Pro'),
  COMPANY_NAME: optional('COMPANY_NAME', 'Rukman Udyog'),
  APP_URL: optional('APP_URL', 'http://localhost:3000'),
  API_URL: optional('API_URL', 'http://localhost:4000'),
  PORT: parseInt(optional('PORT', '4000'), 10),

  // Database — PlanetScale
  DATABASE_URL: required('DATABASE_URL'),
  DB_HOST: required('DB_HOST'),
  DB_USER: required('DB_USER'),
  DB_PASSWORD: required('DB_PASSWORD'),
  DB_NAME: required('DB_NAME'),
  DB_PORT: parseInt(optional('DB_PORT', '3306'), 10),
  DB_SSL: optional('DB_SSL', 'true') === 'true',

  // JWT
  JWT_SECRET: required('JWT_SECRET'),
  JWT_EXPIRES_IN: optional('JWT_EXPIRES_IN', '8h'),
  JWT_REFRESH_SECRET: required('JWT_REFRESH_SECRET'),
  JWT_REFRESH_EXPIRES_IN: optional('JWT_REFRESH_EXPIRES_IN', '7d'),

  // Google Drive
  GOOGLE_SERVICE_ACCOUNT_EMAIL: required('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
  GOOGLE_PRIVATE_KEY: required('GOOGLE_PRIVATE_KEY').replace(/\\n/g, '\n'),
  GOOGLE_DRIVE_FOLDER_ID: required('GOOGLE_DRIVE_FOLDER_ID'),

  // Gmail
  GMAIL_USER: required('GMAIL_USER'),
  GMAIL_APP_PASSWORD: required('GMAIL_APP_PASSWORD'),
  EMAIL_FROM: optional('EMAIL_FROM', 'CMMS Pro <noreply@rukman.com>'),

  // Google Chat
  GCHAT_WEBHOOK_URL: optional('GCHAT_WEBHOOK_URL', ''),

  // Security
  BCRYPT_ROUNDS: parseInt(optional('BCRYPT_ROUNDS', '12'), 10),
  CORS_ORIGIN: optional('CORS_ORIGIN', 'http://localhost:3000'),
  RATE_LIMIT_WINDOW_MS: parseInt(optional('RATE_LIMIT_WINDOW_MS', '900000'), 10),
  RATE_LIMIT_MAX_REQUESTS: parseInt(optional('RATE_LIMIT_MAX_REQUESTS', '100'), 10),

  // Logging
  LOG_LEVEL: optional('LOG_LEVEL', 'debug'),
} as const;

// ── Type export for use across the app ──────────────────────────
export type Environment = typeof env;
