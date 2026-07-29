/**
 * idGenerator.ts — PostgreSQL version
 * Thread-safe ID generation using PostgreSQL advisory locks
 */

import { db } from '../config/database';
import { ID_PREFIX, ID_PAD_LENGTH } from '../config/constants';
import { logger } from './logger';

export type IdPrefix = typeof ID_PREFIX[keyof typeof ID_PREFIX];

const counterKey = (prefix: IdPrefix) => `COUNTER_${prefix}`;

export async function generateId(prefix: IdPrefix): Promise<string> {
  const client = await db.getConnection();
  try {
    await client.beginTransaction();
    const key = counterKey(prefix);

    const result = await client.execute(
      `SELECT value FROM settings WHERE key = $1 FOR UPDATE`,
      [key]
    );
    const rows = result[0] as any[];

    let nextNumber: number;
    if (rows.length === 0) {
      nextNumber = 1;
      await client.execute(
        `INSERT INTO settings (key, value, description) VALUES ($1, $2, $3)`,
        [key, '1', `Counter for ${prefix} IDs`]
      );
    } else {
      nextNumber = parseInt(rows[0].value, 10) + 1;
      await client.execute(
        `UPDATE settings SET value = $1, updated_at = NOW() WHERE key = $2`,
        [nextNumber.toString(), key]
      );
    }

    await client.commit();
    const paddedNumber = nextNumber.toString().padStart(ID_PAD_LENGTH, '0');
    return `${prefix}${paddedNumber}`;

  } catch (error) {
    await client.rollback();
    logger.error(`Failed to generate ID for prefix ${prefix}`, { error });
    throw error;
  } finally {
    client.release();
  }
}

export async function generateIds(prefix: IdPrefix, count: number): Promise<string[]> {
  if (count <= 0) return [];
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    ids.push(await generateId(prefix));
  }
  return ids;
}

export function isValidId(id: string, prefix: IdPrefix): boolean {
  const regex = new RegExp(`^${prefix}\\d{${ID_PAD_LENGTH}}$`);
  return regex.test(id);
}
