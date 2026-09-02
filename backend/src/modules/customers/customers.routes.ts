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

async function generateCustomerCode(): Promise<string> {
  const last = await prisma.customer.findFirst({ orderBy: { id: 'desc' } });
  const next = (last?.id ?? 0) + 1;
  return `CUST-${String(next).padStart(5, '0')}`;
}

router.get(
  '/',
  requirePermission('customers', 'view'),
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
      prisma.customer.findMany({ where, orderBy: { name: 'asc' }, skip: params.skip, take: params.take }),
      prisma.customer.count({ where }),
    ]);
    ok(res, items, pageMeta(total, params));
  })
);

router.get(
  '/:id',
  requirePermission('customers', 'view'),
  asyncHandler(async (req, res) => {
    const customer = await prisma.customer.findUnique({ where: { id: Number(req.params.id) } });
    if (!customer) throw new ApiError(404, 'Customer not found');
    ok(res, customer);
  })
);

const customerValidators = [
  body('name').notEmpty().withMessage('Name is required'),
  body('email').optional({ values: 'falsy' }).isEmail().withMessage('Invalid email'),
  body('mobile').optional({ values: 'falsy' }).isString(),
  body('openingBalance').optional().isNumeric(),
  body('creditLimit').optional().isNumeric(),
];

router.post(
  '/',
  requirePermission('customers', 'create'),
  customerValidators,
  validate,
  asyncHandler(async (req, res) => {
    const code = req.body.code || (await generateCustomerCode());
    const customer = await prisma.customer.create({
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
        creditLimit: req.body.creditLimit ?? 0,
        paymentTerms: req.body.paymentTerms,
        notes: req.body.notes,
      },
    });
    await writeAudit(req, 'CREATE', 'customers', customer.id, undefined, customer);
    created(res, customer);
  })
);

router.put(
  '/:id',
  requirePermission('customers', 'edit'),
  customerValidators,
  validate,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await prisma.customer.findUnique({ where: { id } });
    if (!before) throw new ApiError(404, 'Customer not found');

    const customer = await prisma.customer.update({
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
        creditLimit: req.body.creditLimit,
        paymentTerms: req.body.paymentTerms,
        notes: req.body.notes,
      },
    });
    await writeAudit(req, 'UPDATE', 'customers', id, before, customer);
    ok(res, customer);
  })
);

router.patch(
  '/:id/toggle-active',
  requirePermission('customers', 'edit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.customer.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, 'Customer not found');
    const customer = await prisma.customer.update({ where: { id }, data: { active: !existing.active } });
    await writeAudit(req, 'UPDATE', 'customers.status', id, existing, customer);
    ok(res, customer);
  })
);

router.delete(
  '/:id',
  requirePermission('customers', 'delete'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const [saleCount, paymentCount] = await Promise.all([
      prisma.sale.count({ where: { customerId: id } }),
      prisma.payment.count({ where: { customerId: id } }),
    ]);
    if (saleCount > 0 || paymentCount > 0) {
      const existing = await prisma.customer.update({ where: { id }, data: { active: false } });
      await writeAudit(req, 'UPDATE', 'customers.status', id, undefined, existing);
      return ok(res, { deactivated: true, customer: existing, reason: 'Customer has financial history; deactivated instead of deleted.' });
    }
    await prisma.customer.delete({ where: { id } });
    await writeAudit(req, 'DELETE', 'customers', id);
    ok(res, { deleted: true });
  })
);

export default router;
