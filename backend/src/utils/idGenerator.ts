/**
 * idGenerator.ts
 * ──────────────
 * Generates unique IDs in the format: USR000001, MAC000001, etc.
 *
 * Strategy:
 * - Each entity type has a counter row in the `settings` table
 * - We use a DB transaction to atomically increment + read the counter
 * - This is thread-safe even with multiple server instances
 *
 * Format: {PREFIX}{ZERO_PADDED_NUMBER}
 * Example: USR000001, MAC000042, TSK001337
 *
 * Usage:
 *   import { generateId } from '@utils/idGenerator'
 *   const userId = await generateId('USR')
 */

import { db } from '../config/database';
import { ID_PREFIX, ID_PAD_LENGTH } from '../config/constants';
import { logger } from './logger';

// ── Type for valid ID prefixes ───────────────────────────────────
export type IdPrefix = typeof ID_PREFIX[keyof typeof ID_PREFIX];

// ── Settings key format for counters ────────────────────────────
// Stored as: COUNTER_USR, COUNTER_MAC, etc.
const counterKey = (prefix: IdPrefix) => `COUNTER_${prefix}`;

/**
 * Generates the next unique ID for a given entity prefix.
 * Uses a DB-level transaction to ensure uniqueness across
 * multiple server instances (horizontal scaling safe).
 *
 * @param prefix - ID prefix from ID_PREFIX constants (e.g. 'USR')
 * @returns Promise<string> - e.g. 'USR000001'
 */
export async function generateId(prefix: IdPrefix): Promise<string> {
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const key = counterKey(prefix);

    // Lock the row, read current value
    const [rows] = await conn.execute<any[]>(
      `SELECT \`value\` FROM settings WHERE \`key\` = ? FOR UPDATE`,
      [key]
    );

    let nextNumber: number;

    if (rows.length === 0) {
      // First time — insert counter starting at 1
      nextNumber = 1;
      await conn.execute(
        `INSERT INTO settings (\`key\`, \`value\`, description) VALUES (?, ?, ?)`,
        [key, '1', `Auto-increment counter for ${prefix} IDs`]
      );
    } else {
      // Increment existing counter
      nextNumber = parseInt(rows[0].value, 10) + 1;
      await conn.execute(
        `UPDATE settings SET \`value\` = ?, updated_at = NOW() WHERE \`key\` = ?`,
        [nextNumber.toString(), key]
      );
    }

    await conn.commit();

    // Format: prefix + zero-padded number
    const paddedNumber = nextNumber.toString().padStart(ID_PAD_LENGTH, '0');
    const generatedId = `${prefix}${paddedNumber}`;

    logger.debug(`Generated ID: ${generatedId}`);
    return generatedId;

  } catch (error) {
    await conn.rollback();
    logger.error(`Failed to generate ID for prefix ${prefix}`, { error });
    throw new Error(`ID generation failed for ${prefix}: ${(error as Error).message}`);
  } finally {
    // Always release connection back to pool
    conn.release();
  }
}

/**
 * Bulk ID generator — generates multiple IDs in one transaction.
 * More efficient than calling generateId() in a loop.
 *
 * @param prefix - ID prefix
 * @param count - How many IDs to generate
 * @returns Promise<string[]> - Array of generated IDs
 */
export async function generateIds(prefix: IdPrefix, count: number): Promise<string[]> {
  if (count <= 0) return [];

  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const key = counterKey(prefix);

    const [rows] = await conn.execute<any[]>(
      `SELECT \`value\` FROM settings WHERE \`key\` = ? FOR UPDATE`,
      [key]
    );

    let startNumber: number;

    if (rows.length === 0) {
      startNumber = 1;
      const endNumber = count;
      await conn.execute(
        `INSERT INTO settings (\`key\`, \`value\`, description) VALUES (?, ?, ?)`,
        [key, endNumber.toString(), `Auto-increment counter for ${prefix} IDs`]
      );
    } else {
      startNumber = parseInt(rows[0].value, 10) + 1;
      const endNumber = startNumber + count - 1;
      await conn.execute(
        `UPDATE settings SET \`value\` = ?, updated_at = NOW() WHERE \`key\` = ?`,
        [endNumber.toString(), key]
      );
    }

    await conn.commit();

    // Generate array of IDs from startNumber to startNumber + count - 1
    return Array.from({ length: count }, (_, i) => {
      const num = (startNumber + i).toString().padStart(ID_PAD_LENGTH, '0');
      return `${prefix}${num}`;
    });

  } catch (error) {
    await conn.rollback();
    logger.error(`Failed to bulk generate IDs for prefix ${prefix}`, { error });
    throw new Error(`Bulk ID generation failed for ${prefix}: ${(error as Error).message}`);
  } finally {
    conn.release();
  }
}

/**
 * Validate ID format — useful in route validators.
 * @param id - e.g. 'USR000001'
 * @param prefix - expected prefix e.g. 'USR'
 */
export function isValidId(id: string, prefix: IdPrefix): boolean {
  const regex = new RegExp(`^${prefix}\\d{${ID_PAD_LENGTH}}$`);
  return regex.test(id);
}
