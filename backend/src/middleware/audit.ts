import { Request } from 'express';
import { prisma } from '../config/prisma';

export async function writeAudit(
  req: Request,
  action: string,
  module: string,
  recordId?: string | number,
  before?: unknown,
  after?: unknown
) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: req.user?.id,
        action,
        module,
        recordId: recordId !== undefined ? String(recordId) : undefined,
        before: before === undefined ? undefined : JSON.parse(JSON.stringify(before)),
        after: after === undefined ? undefined : JSON.parse(JSON.stringify(after)),
        ipAddress: req.ip,
      },
    });
  } catch {
    // Audit logging must never break the primary business operation.
  }
}
