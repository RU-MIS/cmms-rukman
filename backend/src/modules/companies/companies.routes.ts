import { Router } from 'express';
import { body } from 'express-validator';
import { prisma } from '../../config/prisma';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok, created, ApiError } from '../../utils/response';
import { requireAuth, signToken } from '../../middleware/auth';
import { requireSuperAdmin, requirePermission } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { writeAudit } from '../../middleware/audit';
import { runWithCompany } from '../../lib/tenantContext';
import { ensurePermissionCatalog, createDefaultRoles } from './companyDefaults';
import { gstinValidator } from '../../utils/gstin';

const router = Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const memberships = await prisma.companyUser.findMany({
      where: { userId: req.user!.id },
      include: { company: true, role: true },
      orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
    });
    ok(
      res,
      memberships
        .filter((m) => m.company.active)
        .map((m) => ({ id: m.companyId, name: m.company.name, gstin: m.company.gstin, role: m.role.name, isDefault: m.isDefault }))
    );
  })
);

router.post(
  '/',
  [body('name').notEmpty(), gstinValidator],
  validate,
  asyncHandler(async (req, res) => {
    const company = await prisma.company.create({
      data: {
        name: req.body.name,
        legalName: req.body.legalName || undefined,
        tradeName: req.body.tradeName || undefined,
        gstin: req.body.gstin || undefined,
        pan: req.body.pan || undefined,
        businessType: req.body.businessType || undefined,
        address: req.body.address || undefined,
        state: req.body.state || undefined,
        district: req.body.district || undefined,
        pincode: req.body.pincode || undefined,
        financialYearStart: req.body.financialYearStart ? Number(req.body.financialYearStart) : undefined,
        currency: req.body.currency || undefined,
      },
    });

    // Optional "make a copy" — clone another company's master config (never
    // its transactions) if the caller owns that source company.
    let sourceSettings: Awaited<ReturnType<typeof prisma.settings.findUnique>> | null = null;
    let sourceAccounts: Awaited<ReturnType<typeof prisma.account.findMany>> = [];
    if (req.body.sourceCompanyId) {
      const sourceMembership = await prisma.companyUser.findUnique({
        where: { companyId_userId: { companyId: Number(req.body.sourceCompanyId), userId: req.user!.id } },
      });
      if (sourceMembership) {
        sourceSettings = await prisma.settings.findUnique({ where: { companyId: Number(req.body.sourceCompanyId) } });
        sourceAccounts = await prisma.account.findMany({ where: { companyId: Number(req.body.sourceCompanyId) } });
      }
    }

    await runWithCompany(company.id, async () => {
      const permissions = await ensurePermissionCatalog();
      const adminRole = await createDefaultRoles(company.id, permissions);
      await prisma.companyUser.create({ data: { companyId: company.id, userId: req.user!.id, roleId: adminRole.id, isDefault: false } });

      await prisma.settings.create({
        data: {
          companyId: company.id,
          businessName: req.body.name,
          address: sourceSettings?.address ?? req.body.address ?? undefined,
          phone: sourceSettings?.phone ?? undefined,
          invoicePrefix: sourceSettings?.invoicePrefix ?? undefined,
          poPrefix: sourceSettings?.poPrefix ?? undefined,
          soPrefix: sourceSettings?.soPrefix ?? undefined,
          paymentPrefix: sourceSettings?.paymentPrefix ?? undefined,
          currency: sourceSettings?.currency ?? req.body.currency ?? undefined,
          defaultTaxRate: sourceSettings?.defaultTaxRate ?? undefined,
          pdfFont: sourceSettings?.pdfFont ?? undefined,
          pdfScale: sourceSettings?.pdfScale ?? undefined,
          termsConditions: sourceSettings?.termsConditions ?? undefined,
        },
      });

      if (sourceAccounts.length > 0) {
        await prisma.account.createMany({
          data: sourceAccounts.map((a) => ({ companyId: company.id, name: a.name, type: a.type, bankName: a.bankName ?? undefined })),
        });
      } else {
        await prisma.account.create({ data: { companyId: company.id, name: 'Cash', type: 'CASH' } });
        await prisma.account.create({ data: { companyId: company.id, name: 'Bank', type: 'BANK' } });
      }
      // NOTE: copying master data such as products/customers/vendors/opening
      // balances is not implemented in this pass — only a blank company with
      // sensible defaults, or a master-config-only copy from a source company.
    });

    await writeAudit(req, 'CREATE', 'companies', company.id, undefined, company);
    const token = signToken(req.user!.id, company.id);
    created(res, { company, token });
  })
);

/** Platform-wide company listing for the Super Admin capability. */
router.get(
  '/all',
  requireSuperAdmin,
  asyncHandler(async (_req, res) => {
    const companies = await prisma.company.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { memberships: true } } },
    });
    ok(res, companies);
  })
);

router.patch(
  '/:id/active',
  requireSuperAdmin,
  [body('active').isBoolean()],
  validate,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await prisma.company.findUnique({ where: { id } });
    if (!before) throw new ApiError(404, 'Company not found');
    const company = await prisma.company.update({ where: { id }, data: { active: req.body.active } });
    await writeAudit(req, 'UPDATE', 'companies.active', id, { active: before.active }, { active: company.active });
    ok(res, company);
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const membership = await prisma.companyUser.findUnique({
      where: { companyId_userId: { companyId: id, userId: req.user!.id } },
    });
    if (!membership) throw new ApiError(404, 'Company not found');
    const company = await prisma.company.findUnique({ where: { id } });
    if (!company) throw new ApiError(404, 'Company not found');
    ok(res, company);
  })
);

router.put(
  '/:id',
  requirePermission('settings', 'edit'),
  [body('name').optional().notEmpty(), gstinValidator, body('registrationDate').optional({ values: 'falsy' }).isISO8601()],
  validate,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (id !== req.user!.companyId) throw new ApiError(403, 'You can only edit the company you are currently working in.');
    const before = await prisma.company.findUnique({ where: { id } });
    if (!before) throw new ApiError(404, 'Company not found');

    const company = await prisma.company.update({
      where: { id },
      data: {
        name: req.body.name,
        legalName: req.body.legalName || null,
        tradeName: req.body.tradeName || null,
        gstin: req.body.gstin || null,
        pan: req.body.pan || null,
        businessType: req.body.businessType || null,
        address: req.body.address || null,
        state: req.body.state || null,
        district: req.body.district || null,
        pincode: req.body.pincode || null,
        registrationStatus: req.body.registrationStatus || null,
        registrationDate: req.body.registrationDate ? new Date(req.body.registrationDate) : null,
        principalPlaceOfBusiness: req.body.principalPlaceOfBusiness || null,
        natureOfBusiness: req.body.natureOfBusiness || null,
      },
    });
    await writeAudit(req, 'UPDATE', 'companies', id, before, company);
    ok(res, company);
  })
);

export default router;
