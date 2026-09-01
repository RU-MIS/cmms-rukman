import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok } from '../../utils/response';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { writeAudit } from '../../middleware/audit';
import { prisma } from '../../config/prisma';
import { getSettings } from './settings.service';

const router = Router();
router.use(requireAuth);

router.get(
  '/',
  requirePermission('settings', 'view'),
  asyncHandler(async (_req, res) => {
    ok(res, await getSettings());
  })
);

router.put(
  '/',
  requirePermission('settings', 'edit'),
  asyncHandler(async (req, res) => {
    const before = await getSettings();
    const settings = await prisma.settings.update({
      where: { id: 1 },
      data: {
        businessName: req.body.businessName,
        logoUrl: req.body.logoUrl,
        address: req.body.address,
        phone: req.body.phone,
        email: req.body.email,
        gstin: req.body.gstin,
        invoicePrefix: req.body.invoicePrefix,
        poPrefix: req.body.poPrefix,
        soPrefix: req.body.soPrefix,
        paymentPrefix: req.body.paymentPrefix,
        currency: req.body.currency,
        defaultTaxRate: req.body.defaultTaxRate,
        pdfFooter: req.body.pdfFooter,
      },
    });
    await writeAudit(req, 'UPDATE', 'settings', 1, before, settings);
    ok(res, settings);
  })
);

export default router;
