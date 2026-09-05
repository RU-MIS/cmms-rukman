import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok, ApiError } from '../../utils/response';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { writeAudit } from '../../middleware/audit';
import { validate } from '../../middleware/validate';
import { body } from 'express-validator';
import { upload } from '../../middleware/upload';
import { prisma } from '../../config/prisma';
import { getSettings } from './settings.service';

const PDF_FONTS = ['Helvetica', 'Times-Roman', 'Courier'];

const router = Router();
router.use(requireAuth);

router.get(
  '/',
  requirePermission('settings', 'view'),
  asyncHandler(async (req, res) => {
    ok(res, await getSettings(req.user!.companyId));
  })
);

router.put(
  '/',
  requirePermission('settings', 'edit'),
  [body('pdfScale').optional({ values: 'null' }).isInt({ min: 50, max: 150 })],
  validate,
  asyncHandler(async (req, res) => {
    const before = await getSettings(req.user!.companyId);
    const settings = await prisma.settings.update({
      where: { companyId: req.user!.companyId },
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
        pdfFont: req.body.pdfFont && PDF_FONTS.includes(req.body.pdfFont) ? req.body.pdfFont : undefined,
        pdfScale: req.body.pdfScale,
        termsConditions: req.body.termsConditions,
      },
    });
    await writeAudit(req, 'UPDATE', 'settings', req.user!.companyId, before, settings);
    ok(res, settings);
  })
);

router.post(
  '/logo',
  requirePermission('settings', 'edit'),
  upload.single('logo'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new ApiError(400, 'No file uploaded');
    const before = await getSettings(req.user!.companyId);
    const logoUrl = `/uploads/${req.file.filename}`;
    const settings = await prisma.settings.update({ where: { companyId: req.user!.companyId }, data: { logoUrl } });
    await writeAudit(req, 'UPDATE', 'settings.logo', req.user!.companyId, { logoUrl: before.logoUrl }, { logoUrl });
    ok(res, settings);
  })
);

router.get(
  '/pdf-fonts',
  requirePermission('settings', 'view'),
  asyncHandler(async (_req, res) => {
    ok(res, PDF_FONTS);
  })
);

export default router;
