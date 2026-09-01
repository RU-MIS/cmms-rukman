import { Router } from 'express';
import { body } from 'express-validator';
import { prisma } from '../../config/prisma';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok } from '../../utils/response';
import { getPageParams, pageMeta } from '../../utils/pagination';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { writeAudit } from '../../middleware/audit';
import { generateDocument, DocumentType } from '../documents/documents.service';
import { sendEmailWithAttachment } from './email.service';

const router = Router();
router.use(requireAuth);

router.get(
  '/logs',
  requirePermission('email', 'view'),
  asyncHandler(async (req, res) => {
    const params = getPageParams(req);
    const [items, total] = await Promise.all([
      prisma.emailLog.findMany({ orderBy: { sentAt: 'desc' }, skip: params.skip, take: params.take }),
      prisma.emailLog.count(),
    ]);
    ok(res, items, pageMeta(total, params));
  })
);

router.post(
  '/send',
  requirePermission('email', 'create'),
  [body('recipient').isEmail(), body('documentType').notEmpty(), body('documentId').isInt()],
  validate,
  asyncHandler(async (req, res) => {
    const { recipient, documentType, documentId, subject, message } = req.body as {
      recipient: string;
      documentType: DocumentType;
      documentId: number;
      subject?: string;
      message?: string;
    };

    let status: 'SENT' | 'FAILED' = 'SENT';
    let error: string | undefined;
    let doc;
    try {
      doc = await generateDocument(documentType, documentId);
      await sendEmailWithAttachment({
        to: recipient,
        subject: subject || doc.filename.replace('.pdf', ''),
        text: message || 'Please find the attached document.',
        filename: doc.filename,
        content: doc.buffer,
      });
    } catch (err) {
      status = 'FAILED';
      error = err instanceof Error ? err.message : 'Unknown error';
    }

    const log = await prisma.emailLog.create({
      data: {
        recipient,
        subject: subject || doc?.filename || documentType,
        documentType,
        documentRef: String(documentId),
        status,
        error,
      },
    });

    await writeAudit(req, 'CREATE', 'email', log.id, undefined, log);
    if (status === 'FAILED') {
      return res.status(502).json({ success: false, message: `Email failed: ${error}`, data: log });
    }
    ok(res, log);
  })
);

export default router;
