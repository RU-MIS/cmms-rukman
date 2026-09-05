import { Router } from 'express';
import { body } from 'express-validator';
import { prisma } from '../../config/prisma';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok, created, ApiError } from '../../utils/response';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { writeAudit } from '../../middleware/audit';
import { nextDocNumber } from '../../utils/docNumber';
import { D } from '../../utils/money';

const router = Router();
router.use(requireAuth);

async function computeBalance(accountId: number, openingBalance: unknown) {
  const [receivedIn, paidOut, transfersIn, transfersOut] = await Promise.all([
    prisma.payment.aggregate({ _sum: { amount: true }, where: { accountId, direction: 'RECEIVED' } }),
    prisma.payment.aggregate({ _sum: { amount: true }, where: { accountId, direction: 'PAID' } }),
    prisma.fundTransfer.aggregate({ _sum: { amount: true }, where: { toAccountId: accountId } }),
    prisma.fundTransfer.aggregate({ _sum: { amount: true }, where: { fromAccountId: accountId } }),
  ]);
  return D(openingBalance)
    .plus(receivedIn._sum.amount ?? 0)
    .minus(paidOut._sum.amount ?? 0)
    .plus(transfersIn._sum.amount ?? 0)
    .minus(transfersOut._sum.amount ?? 0);
}

router.get(
  '/',
  requirePermission('accounts', 'view'),
  asyncHandler(async (_req, res) => {
    const accounts = await prisma.account.findMany({ orderBy: { name: 'asc' } });
    const withBalance = await Promise.all(
      accounts.map(async (a) => ({ ...a, balance: await computeBalance(a.id, a.openingBalance) }))
    );
    ok(res, withBalance);
  })
);

router.post(
  '/',
  requirePermission('accounts', 'create'),
  [body('name').notEmpty(), body('type').isIn(['CASH', 'BANK'])],
  validate,
  asyncHandler(async (req, res) => {
    const account = await prisma.account.create({
      data: {
        companyId: req.user!.companyId,
        name: req.body.name,
        type: req.body.type,
        bankName: req.body.bankName,
        accountNumber: req.body.accountNumber,
        openingBalance: req.body.openingBalance ?? 0,
      },
    });
    await writeAudit(req, 'CREATE', 'accounts', account.id, undefined, account);
    created(res, account);
  })
);

router.put(
  '/:id',
  requirePermission('accounts', 'edit'),
  [body('name').notEmpty()],
  validate,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await prisma.account.findUnique({ where: { id } });
    if (!before) throw new ApiError(404, 'Account not found');
    const account = await prisma.account.update({
      where: { id },
      data: { name: req.body.name, bankName: req.body.bankName, accountNumber: req.body.accountNumber, active: req.body.active },
    });
    await writeAudit(req, 'UPDATE', 'accounts', id, before, account);
    ok(res, account);
  })
);

router.get(
  '/:id/ledger',
  requirePermission('accounts', 'view'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const account = await prisma.account.findUnique({ where: { id } });
    if (!account) throw new ApiError(404, 'Account not found');

    const [payments, transfersIn, transfersOut] = await Promise.all([
      prisma.payment.findMany({ where: { accountId: id }, include: { customer: true, vendor: true } }),
      prisma.fundTransfer.findMany({ where: { toAccountId: id }, include: { fromAccount: true } }),
      prisma.fundTransfer.findMany({ where: { fromAccountId: id }, include: { toAccount: true } }),
    ]);

    const entries = [
      ...payments.map((p) => ({
        date: p.date,
        type: p.direction === 'RECEIVED' ? 'Payment Received' : 'Payment Paid',
        reference: p.paymentNo,
        party: p.customer?.name ?? p.vendor?.name ?? '-',
        debit: p.direction === 'RECEIVED' ? D(p.amount) : D(0),
        credit: p.direction === 'PAID' ? D(p.amount) : D(0),
      })),
      ...transfersIn.map((t) => ({
        date: t.date,
        type: 'Transfer In',
        reference: t.transferNo,
        party: `From ${t.fromAccount.name}`,
        debit: D(t.amount),
        credit: D(0),
      })),
      ...transfersOut.map((t) => ({
        date: t.date,
        type: 'Transfer Out',
        reference: t.transferNo,
        party: `To ${t.toAccount.name}`,
        debit: D(0),
        credit: D(t.amount),
      })),
    ].sort((a, b) => a.date.getTime() - b.date.getTime());

    let balance = D(account.openingBalance);
    const ledger = [
      { date: account.createdAt, type: 'Opening Balance', reference: '-', party: '-', debit: D(account.openingBalance), credit: D(0), balance },
      ...entries.map((e) => {
        balance = balance.plus(e.debit).minus(e.credit);
        return { ...e, balance };
      }),
    ];
    ok(res, { account, ledger, closingBalance: balance });
  })
);

router.get(
  '/transfers',
  requirePermission('accounts', 'view'),
  asyncHandler(async (_req, res) => {
    const transfers = await prisma.fundTransfer.findMany({
      include: { fromAccount: true, toAccount: true },
      orderBy: { date: 'desc' },
      take: 50,
    });
    ok(res, transfers);
  })
);

router.post(
  '/transfer',
  requirePermission('accounts', 'create'),
  [body('fromAccountId').isInt(), body('toAccountId').isInt(), body('amount').isFloat({ gt: 0 })],
  validate,
  asyncHandler(async (req, res) => {
    const fromAccountId = Number(req.body.fromAccountId);
    const toAccountId = Number(req.body.toAccountId);
    if (fromAccountId === toAccountId) throw new ApiError(400, 'Source and destination account must differ');

    const [fromAccount, toAccount] = await Promise.all([
      prisma.account.findUnique({ where: { id: fromAccountId } }),
      prisma.account.findUnique({ where: { id: toAccountId } }),
    ]);
    if (!fromAccount || !toAccount) throw new ApiError(404, 'Account not found');

    const fromBalance = await computeBalance(fromAccountId, fromAccount.openingBalance);
    if (fromBalance.lt(req.body.amount)) {
      throw new ApiError(400, `Insufficient balance in ${fromAccount.name} (available: ${fromBalance.toFixed(2)})`);
    }

    const transfer = await prisma.$transaction(async (tx) => {
      const transferNo = await nextDocNumber(tx, req.user!.companyId, 'TRF');
      return tx.fundTransfer.create({
        data: {
          companyId: req.user!.companyId,
          transferNo,
          date: req.body.date ? new Date(req.body.date) : new Date(),
          fromAccountId,
          toAccountId,
          amount: req.body.amount,
          remarks: req.body.remarks,
          createdById: req.user!.id,
        },
        include: { fromAccount: true, toAccount: true },
      });
    });

    await writeAudit(req, 'CREATE', 'accounts.transfer', transfer.id, undefined, transfer);
    created(res, transfer);
  })
);

export default router;
