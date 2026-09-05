/** Standard 15-character GSTIN format: 2-digit state code, 10-char PAN, entity code, 'Z', checksum. */
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function isValidGSTIN(value: string): boolean {
  if (!value) return false;
  return GSTIN_REGEX.test(value.trim().toUpperCase());
}
