import { PrismaTransactionClient } from '../config/prisma';

/**
 * Atomically reserves the next number for a document prefix, scoped to a
 * company, using an UPSERT + row lock inside the caller's transaction, so
 * concurrent users never receive duplicate invoice/PO/payment numbers, and
 * two companies both using e.g. prefix "INV" never collide.
 */
export async function nextDocNumber(
  tx: PrismaTransactionClient,
  companyId: number,
  prefix: string,
  padLength = 6
): Promise<string> {
  const counter = await tx.documentCounter.upsert({
    where: { companyId_prefix: { companyId, prefix } },
    create: { companyId, prefix, nextNumber: 2 },
    update: { nextNumber: { increment: 1 } },
  });
  const usedNumber = counter.nextNumber - 1;
  return `${prefix}-${String(usedNumber).padStart(padLength, '0')}`;
}
