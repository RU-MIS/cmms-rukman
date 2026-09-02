import { Router } from 'express';
import { body } from 'express-validator';
import { prisma } from '../../config/prisma';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok, created, ApiError } from '../../utils/response';
import { getPageParams, pageMeta } from '../../utils/pagination';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { writeAudit } from '../../middleware/audit';

const router = Router();
router.use(requireAuth);

async function generateVendorCode(): Promise<string> {
  const last = await prisma.vendor.findFirst({ orderBy: { id: 'desc' } });
  const next = (last?.id ?? 0) + 1;
  return `VEND-${String(next).padStart(5, '0')}`;
}

router.get(
  '/',
  requirePermission('vendors', 'view'),
  asyncHandler(async (req, res) => {
    const params = getPageParams(req);
    const search = String(req.query.search ?? '').trim();
    const activeOnly = req.query.active !== 'all';

    const where = {
      ...(activeOnly ? { active: true } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search } },
              { code: { contains: search } },
              { mobile: { contains: search } },
              { companyName: { contains: search } },
              { gstin: { contains: search } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.vendor.findMany({ where, orderBy: { name: 'asc' }, skip: params.skip, take: params.take }),
      prisma.vendor.count({ where }),
    ]);
    ok(res, items, pageMeta(total, params));
  })
);

router.get(
  '/:id',
  requirePermission('vendors', 'view'),
  asyncHandler(async (req, res) => {
    const vendor = await prisma.vendor.findUnique({ where: { id: Number(req.params.id) } });
    if (!vendor) throw new ApiError(404, 'Vendor not found');
    ok(res, vendor);
  })
);

const vendorValidators = [
  body('name').notEmpty().withMessage('Name is required'),
  body('email').optional({ values: 'falsy' }).isEmail().withMessage('Invalid email'),
  body('openingBalance').optional().isNumeric(),
];

router.post(
  '/',
  requirePermission('vendors', 'create'),
  vendorValidators,
  validate,
  asyncHandler(async (req, res) => {
    const code = req.body.code || (await generateVendorCode());
    const vendor = await prisma.vendor.create({
      data: {
        code,
        name: req.body.name,
        companyName: req.body.companyName,
        mobile: req.body.mobile,
        altMobile: req.body.altMobile,
        email: req.body.email || null,
        address: req.body.address,
        city: req.body.city,
        state: req.body.state,
        pincode: req.body.pincode,
        gstin: req.body.gstin,
        openingBalance: req.body.openingBalance ?? 0,
        paymentTerms: req.body.paymentTerms,
        notes: req.body.notes,
      },
    });
    await writeAudit(req, 'CREATE', 'vendors', vendor.id, undefined, vendor);
    created(res, vendor);
  })
);

router.put(
  '/:id',
  requirePermission('vendors', 'edit'),
  vendorValidators,
  validate,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await prisma.vendor.findUnique({ where: { id } });
    if (!before) throw new ApiError(404, 'Vendor not found');

    const vendor = await prisma.vendor.update({
      where: { id },
      data: {
        name: req.body.name,
        companyName: req.body.companyName,
        mobile: req.body.mobile,
        altMobile: req.body.altMobile,
        email: req.body.email || null,
        address: req.body.address,
        city: req.body.city,
        state: req.body.state,
        pincode: req.body.pincode,
        gstin: req.body.gstin,
        openingBalance: req.body.openingBalance,
        paymentTerms: req.body.paymentTerms,
        notes: req.body.notes,
      },
    });
    await writeAudit(req, 'UPDATE', 'vendors', id, before, vendor);
    ok(res, vendor);
  })
);

router.patch(
  '/:id/toggle-active',
  requirePermission('vendors', 'edit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.vendor.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, 'Vendor not found');
    const vendor = await prisma.vendor.update({ where: { id }, data: { active: !existing.active } });
    await writeAudit(req, 'UPDATE', 'vendors.status', id, existing, vendor);
    ok(res, vendor);
  })
);

router.delete(
  '/:id',
  requirePermission('vendors', 'delete'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const [purchaseCount, paymentCount] = await Promise.all([
      prisma.purchase.count({ where: { vendorId: id } }),
      prisma.payment.count({ where: { vendorId: id } }),
    ]);
    if (purchaseCount > 0 || paymentCount > 0) {
      const existing = await prisma.vendor.update({ where: { id }, data: { active: false } });
      await writeAudit(req, 'UPDATE', 'vendors.status', id, undefined, existing);
      return ok(res, { deactivated: true, vendor: existing, reason: 'Vendor has financial history; deactivated instead of deleted.' });
    }
    await prisma.vendor.delete({ where: { id } });
    await writeAudit(req, 'DELETE', 'vendors', id);
    ok(res, { deleted: true });
  })
);

export default router;
