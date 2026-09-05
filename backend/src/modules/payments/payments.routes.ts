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
import { nextDocNumber } from '../../utils/docNumber';
import { D } from '../../utils/money';
import { getSettings } from '../settings/settings.service';
import { assertOwned } from '../../utils/ownership';

const router = Router();
router.use(requireAuth);

router.get(
  '/',
  requirePermission('payments', 'view'),
  asyncHandler(async (req, res) => {
    const params = getPageParams(req);
    const partyType = req.query.partyType ? String(req.query.partyType) : undefined;
    const customerId = req.query.customerId ? Number(req.query.customerId) : undefined;
    const vendorId = req.query.vendorId ? Number(req.query.vendorId) : undefined;
    const where: any = {
      ...(partyType ? { partyType } : {}),
      ...(customerId ? { customerId } : {}),
      ...(vendorId ? { vendorId } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        include: { customer: { select: { name: true } }, vendor: { select: { name: true } }, account: { select: { name: true, type: true } } },
        orderBy: { date: 'desc' },
        skip: params.skip,
        take: params.take,
      }),
      prisma.payment.count({ where }),
    ]);
    ok(res, items, pageMeta(total, params));
  })
);

router.get(
  '/:id',
  requirePermission('payments', 'view'),
  asyncHandler(async (req, res) => {
    const payment = await prisma.payment.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        customer: true,
        vendor: true,
        account: true,
        allocations: { include: { sale: { select: { invoiceNo: true, grandTotal: true } }, purchase: { select: { billNo: true, grandTotal: true } } } },
      },
    });
    if (!payment) throw new ApiError(404, 'Payment not found');
    ok(res, payment);
  })
);

router.post(
  '/',
  requirePermission('payments', 'create'),
  [
    body('partyType').isIn(['CUSTOMER', 'VENDOR']),
    body('amount').isFloat({ gt: 0 }),
    body('mode').isIn(['CASH', 'BANK', 'UPI', 'CHEQUE', 'OTHER']),
    body('accountId').optional({ values: 'null' }).isInt(),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const amount = D(req.body.amount);
    const settings = await getSettings(req.user!.companyId);
    const isCustomer = req.body.partyType === 'CUSTOMER';

    if (isCustomer && !req.body.customerId) throw new ApiError(400, 'customerId is required for a customer payment');
    if (!isCustomer && !req.body.vendorId) throw new ApiError(400, 'vendorId is required for a vendor payment');
    if (isCustomer) {
      assertOwned(await prisma.customer.findUnique({ where: { id: Number(req.body.customerId) } }), 'customer');
    } else {
      assertOwned(await prisma.vendor.findUnique({ where: { id: Number(req.body.vendorId) } }), 'vendor');
    }
    if (req.body.accountId) {
      assertOwned(await prisma.account.findUnique({ where: { id: Number(req.body.accountId) } }), 'account');
    }

    const payment = await prisma.$transaction(async (tx) => {
      const paymentNo = await nextDocNumber(tx, req.user!.companyId, settings.paymentPrefix);

      const created = await tx.payment.create({
        data: {
          companyId: req.user!.companyId,
          paymentNo,
          date: req.body.date ? new Date(req.body.date) : new Date(),
          partyType: req.body.partyType,
          customerId: isCustomer ? req.body.customerId : null,
          vendorId: isCustomer ? null : req.body.vendorId,
          direction: isCustomer ? 'RECEIVED' : 'PAID',
          amount,
          mode: req.body.mode,
          accountId: req.body.accountId ? Number(req.body.accountId) : null,
          refNo: req.body.refNo,
          remarks: req.body.remarks,
          createdById: req.user!.id,
        },
      });

      let remaining = amount;
      const manualAllocations: { saleId?: number; purchaseId?: number; amount: number }[] = req.body.allocations ?? [];

      if (manualAllocations.length > 0) {
        for (const alloc of manualAllocations) {
          if (remaining.lte(0)) break;
          const allocAmount = D(alloc.amount).gt(remaining) ? remaining : D(alloc.amount);
          if (isCustomer && alloc.saleId) {
            await tx.sale.update({ where: { id: alloc.saleId }, data: { paidAmount: { increment: allocAmount.toNumber() } } });
            await tx.paymentAllocation.create({ data: { paymentId: created.id, saleId: alloc.saleId, amount: allocAmount } });
          } else if (!isCustomer && alloc.purchaseId) {
            await tx.purchase.update({ where: { id: alloc.purchaseId }, data: { paidAmount: { increment: allocAmount.toNumber() } } });
            await tx.paymentAllocation.create({ data: { paymentId: created.id, purchaseId: alloc.purchaseId, amount: allocAmount } });
          }
          remaining = remaining.minus(allocAmount);
        }
      } else {
        // Auto-allocate FIFO against the oldest unpaid invoices.
        if (isCustomer) {
          const openSales = await tx.sale.findMany({
            where: { customerId: req.body.customerId, status: 'CONFIRMED' },
            orderBy: { date: 'asc' },
          });
          for (const sale of openSales) {
            if (remaining.lte(0)) break;
            const due = D(sale.grandTotal).minus(sale.paidAmount);
            if (due.lte(0)) continue;
            const allocAmount = due.gt(remaining) ? remaining : due;
            await tx.sale.update({ where: { id: sale.id }, data: { paidAmount: { increment: allocAmount.toNumber() } } });
            await tx.paymentAllocation.create({ data: { paymentId: created.id, saleId: sale.id, amount: allocAmount } });
            remaining = remaining.minus(allocAmount);
          }
        } else {
          const openPurchases = await tx.purchase.findMany({
            where: { vendorId: req.body.vendorId, status: 'CONFIRMED' },
            orderBy: { date: 'asc' },
          });
          for (const purchase of openPurchases) {
            if (remaining.lte(0)) break;
            const due = D(purchase.grandTotal).minus(purchase.paidAmount);
            if (due.lte(0)) continue;
            const allocAmount = due.gt(remaining) ? remaining : due;
            await tx.purchase.update({ where: { id: purchase.id }, data: { paidAmount: { increment: allocAmount.toNumber() } } });
            await tx.paymentAllocation.create({ data: { paymentId: created.id, purchaseId: purchase.id, amount: allocAmount } });
            remaining = remaining.minus(allocAmount);
          }
        }
      }

      return created;
    });

    await writeAudit(req, 'CREATE', 'payments', payment.id, undefined, payment);
    created(res, payment);
  })
);

export default router;
