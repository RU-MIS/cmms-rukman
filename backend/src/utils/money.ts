import { Prisma } from '@prisma/client';

export const D = (v: unknown): Prisma.Decimal => new Prisma.Decimal((v as any) ?? 0);

export function round2(v: Prisma.Decimal): Prisma.Decimal {
  return v.toDecimalPlaces(2);
}
