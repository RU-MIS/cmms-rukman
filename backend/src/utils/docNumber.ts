import { Prisma } from '@prisma/client';

/**
 * Atomically reserves the next number for a document prefix using an
 * UPSERT + row lock inside the caller's transaction, so concurrent users
 * never receive duplicate invoice/PO/payment numbers.
 */
export async function nextDocNumber(
  tx: Prisma.TransactionClient,
  prefix: string,
  padLength = 6
): Promise<string> {
  const counter = await tx.documentCounter.upsert({
    where: { prefix },
    create: { prefix, nextNumber: 2 },
    update: { nextNumber: { increment: 1 } },
  });
  const usedNumber = counter.nextNumber - 1;
  return `${prefix}-${String(usedNumber).padStart(padLength, '0')}`;
}
