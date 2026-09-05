import { body } from 'express-validator';

/** Standard 15-character GSTIN format: 2-digit state code, 10-char PAN, entity code, 'Z', checksum. */
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function isValidGstin(value: string): boolean {
  return GSTIN_REGEX.test(value.trim().toUpperCase());
}

/** Reusable express-validator chain: GSTIN is optional, but if present must be well-formed. */
export const gstinValidator = body('gstin')
  .optional({ values: 'falsy' })
  .customSanitizer((v: string) => String(v).trim().toUpperCase())
  .matches(GSTIN_REGEX)
  .withMessage('Invalid GSTIN format — expected 15 characters, e.g. 22AAAAA0000A1Z5');
