import { Router } from 'express';
import fs from 'fs';
import dayjs from 'dayjs';
import { prisma } from '../../config/prisma';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok, ApiError } from '../../utils/response';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { writeAudit } from '../../middleware/audit';
import { upload } from '../../middleware/upload';
import { parseExcelBuffer, buildExcelBuffer } from './excel.service';
import { D } from '../../utils/money';

const router = Router();
router.use(requireAuth);

interface RowError {
  row: number;
  message: string;
}

// ---------------------------------------------------------------------
// IMPORT: preview (validate only) then commit (save validated rows)
// ---------------------------------------------------------------------

router.post(
  '/import/:entity/preview',
  requirePermission('excel', 'create'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new ApiError(400, 'No file uploaded');
    const rows = await parseExcelBuffer(fs.readFileSync(req.file.path));
    const entity = req.params.entity;
    const errors: RowError[] = [];
    const valid: Record<string, any>[] = [];

    if (entity === 'customers' || entity === 'vendors') {
      rows.forEach((r, idx) => {
        const rowNum = idx + 2;
        const name = String(r.name ?? r.Name ?? '').trim();
        if (!name) return errors.push({ row: rowNum, message: 'Name is required' });
        const email = String(r.email ?? r.Email ?? '').trim();
        if (email && !/^\S+@\S+\.\S+$/.test(email)) return errors.push({ row: rowNum, message: `Invalid email: ${email}` });
        valid.push({
          name,
          companyName: r.companyName ?? r.company ?? undefined,
          mobile: r.mobile ? String(r.mobile) : undefined,
          email: email || undefined,
          address: r.address ?? undefined,
          city: r.city ?? undefined,
          state: r.state ?? undefined,
          gstin: r.gstin ?? undefined,
          openingBalance: Number(r.openingBalance ?? 0) || 0,
        });
      });
    } else if (entity === 'products') {
      const units = await prisma.unit.findMany();
      rows.forEach((r, idx) => {
        const rowNum = idx + 2;
        const name = String(r.name ?? r.Name ?? '').trim();
        if (!name) return errors.push({ row: rowNum, message: 'Name is required' });
        const unitName = String(r.unit ?? r.Unit ?? '').trim();
        const unit = units.find((u) => u.name.toLowerCase() === unitName.toLowerCase() || u.shortName.toLowerCase() === unitName.toLowerCase());
        if (!unit) return errors.push({ row: rowNum, message: `Unknown unit: ${unitName || '(blank)'}` });
        valid.push({
          name,
          sku: r.sku ?? undefined,
          unitId: unit.id,
          purchaseRate: Number(r.purchaseRate ?? 0) || 0,
          saleRate: Number(r.saleRate ?? 0) || 0,
          taxRate: Number(r.taxRate ?? 0) || 0,
          reorderLevel: Number(r.reorderLevel ?? 0) || 0,
          openingStock: Number(r.openingStock ?? 0) || 0,
        });
      });
    } else if (entity === 'opening-stock') {
      const products = await prisma.product.findMany();
      rows.forEach((r, idx) => {
        const rowNum = idx + 2;
        const sku = String(r.sku ?? r.SKU ?? '').trim();
        const product = products.find((p) => p.sku.toLowerCase() === sku.toLowerCase());
        if (!product) return errors.push({ row: rowNum, message: `Unknown product SKU: ${sku || '(blank)'}` });
        const qty = Number(r.qty ?? r.quantity ?? 0);
        if (!(qty > 0)) return errors.push({ row: rowNum, message: 'Quantity must be greater than zero' });
        valid.push({ productId: product.id, qty });
      });
    } else if (entity === 'opening-balances') {
      const [customers, vendors] = await Promise.all([prisma.customer.findMany(), prisma.vendor.findMany()]);
      rows.forEach((r, idx) => {
        const rowNum = idx + 2;
        const type = String(r.type ?? r.Type ?? '').trim().toLowerCase();
        const code = String(r.code ?? r.Code ?? '').trim();
        const amount = Number(r.amount ?? r.openingBalance ?? 0);
        if (!['customer', 'vendor'].includes(type)) return errors.push({ row: rowNum, message: `Type must be 'customer' or 'vendor'` });
        const match = type === 'customer' ? customers.find((c) => c.code === code) : vendors.find((v) => v.code === code);
        if (!match) return errors.push({ row: rowNum, message: `Unknown ${type} code: ${code}` });
        valid.push({ type, id: match.id, amount });
      });
    } else {
      throw new ApiError(400, `Unknown import entity: ${entity}`);
    }

    ok(res, { valid, errors, totalRows: rows.length });
  })
);

router.post(
  '/import/:entity/commit',
  requirePermission('excel', 'create'),
  asyncHandler(async (req, res) => {
    const entity = req.params.entity;
    const rows: Record<string, any>[] = req.body.rows ?? [];
    if (rows.length === 0) throw new ApiError(400, 'No validated rows supplied');

    let count = 0;
    if (entity === 'customers') {
      for (const r of rows) {
        const last = await prisma.customer.findFirst({ orderBy: { id: 'desc' } });
        await prisma.customer.create({ data: { ...r, code: `CUST-${String((last?.id ?? 0) + 1).padStart(5, '0')}` } as any });
        count++;
      }
    } else if (entity === 'vendors') {
      for (const r of rows) {
        const last = await prisma.vendor.findFirst({ orderBy: { id: 'desc' } });
        await prisma.vendor.create({ data: { ...r, code: `VEND-${String((last?.id ?? 0) + 1).padStart(5, '0')}` } as any });
        count++;
      }
    } else if (entity === 'products') {
      for (const r of rows) {
        const last = await prisma.product.findFirst({ orderBy: { id: 'desc' } });
        const sku = r.sku || `PRD-${String((last?.id ?? 0) + 1).padStart(5, '0')}`;
        await prisma.product.create({ data: { ...r, sku, currentStock: r.openingStock } as any });
        count++;
      }
    } else if (entity === 'opening-stock') {
      for (const r of rows) {
        await prisma.$transaction(async (tx) => {
          const product = await tx.product.findUniqueOrThrow({ where: { id: r.productId } });
          const newStock = D(product.currentStock).plus(r.qty);
          await tx.product.update({ where: { id: r.productId }, data: { currentStock: newStock } });
          await tx.stockTransaction.create({
            data: { companyId: req.user!.companyId, productId: r.productId, type: 'OPENING', qtyIn: r.qty, balanceAfter: newStock, reference: 'Excel Import', createdById: req.user!.id },
          });
        });
        count++;
      }
    } else if (entity === 'opening-balances') {
      for (const r of rows) {
        if (r.type === 'customer') await prisma.customer.update({ where: { id: r.id }, data: { openingBalance: r.amount } });
        else await prisma.vendor.update({ where: { id: r.id }, data: { openingBalance: r.amount } });
        count++;
      }
    } else {
      throw new ApiError(400, `Unknown import entity: ${entity}`);
    }

    await writeAudit(req, 'CREATE', `excel.import.${entity}`, undefined, undefined, { count });
    ok(res, { imported: count });
  })
);

// ---------------------------------------------------------------------
// EXPORT
// ---------------------------------------------------------------------

router.get(
  '/export/:entity',
  requirePermission('excel', 'export'),
  asyncHandler(async (req, res) => {
    const entity = req.params.entity;
    let buffer: Buffer;
    let filename: string;

    if (entity === 'customers') {
      const rows = await prisma.customer.findMany({ orderBy: { name: 'asc' } });
      buffer = await buildExcelBuffer('Customers', [
        { header: 'Code', key: 'code' }, { header: 'Name', key: 'name' }, { header: 'Company', key: 'companyName' },
        { header: 'Mobile', key: 'mobile' }, { header: 'Email', key: 'email' }, { header: 'City', key: 'city' },
        { header: 'GSTIN', key: 'gstin' }, { header: 'Opening Balance', key: 'openingBalance' }, { header: 'Active', key: 'active' },
      ], rows.map((r) => ({ ...r, openingBalance: r.openingBalance.toString() })));
      filename = 'customers.xlsx';
    } else if (entity === 'vendors') {
      const rows = await prisma.vendor.findMany({ orderBy: { name: 'asc' } });
      buffer = await buildExcelBuffer('Vendors', [
        { header: 'Code', key: 'code' }, { header: 'Name', key: 'name' }, { header: 'Company', key: 'companyName' },
        { header: 'Mobile', key: 'mobile' }, { header: 'Email', key: 'email' }, { header: 'GSTIN', key: 'gstin' },
        { header: 'Opening Balance', key: 'openingBalance' }, { header: 'Active', key: 'active' },
      ], rows.map((r) => ({ ...r, openingBalance: r.openingBalance.toString() })));
      filename = 'vendors.xlsx';
    } else if (entity === 'products') {
      const rows = await prisma.product.findMany({ include: { unit: true, category: true }, orderBy: { name: 'asc' } });
      buffer = await buildExcelBuffer('Products', [
        { header: 'SKU', key: 'sku' }, { header: 'Name', key: 'name' }, { header: 'Category', key: 'category' },
        { header: 'Unit', key: 'unit' }, { header: 'Purchase Rate', key: 'purchaseRate' }, { header: 'Sale Rate', key: 'saleRate' },
        { header: 'Current Stock', key: 'currentStock' }, { header: 'Reorder Level', key: 'reorderLevel' },
      ], rows.map((r) => ({ ...r, category: r.category?.name ?? '', unit: r.unit.shortName, purchaseRate: r.purchaseRate.toString(), saleRate: r.saleRate.toString(), currentStock: r.currentStock.toString(), reorderLevel: r.reorderLevel.toString() })));
      filename = 'products.xlsx';
    } else if (entity === 'sales') {
      const rows = await prisma.sale.findMany({ include: { customer: true }, orderBy: { date: 'desc' } });
      buffer = await buildExcelBuffer('Sales', [
        { header: 'Invoice No', key: 'invoiceNo' }, { header: 'Date', key: 'date' }, { header: 'Customer', key: 'customer' },
        { header: 'Grand Total', key: 'grandTotal' }, { header: 'Paid', key: 'paidAmount' }, { header: 'Status', key: 'status' },
      ], rows.map((r) => ({ invoiceNo: r.invoiceNo, date: dayjs(r.date).format('DD-MMM-YYYY'), customer: r.customer.name, grandTotal: r.grandTotal.toString(), paidAmount: r.paidAmount.toString(), status: r.status })));
      filename = 'sales.xlsx';
    } else if (entity === 'purchases') {
      const rows = await prisma.purchase.findMany({ include: { vendor: true }, orderBy: { date: 'desc' } });
      buffer = await buildExcelBuffer('Purchases', [
        { header: 'Bill No', key: 'billNo' }, { header: 'Date', key: 'date' }, { header: 'Vendor', key: 'vendor' },
        { header: 'Grand Total', key: 'grandTotal' }, { header: 'Paid', key: 'paidAmount' }, { header: 'Status', key: 'status' },
      ], rows.map((r) => ({ billNo: r.billNo, date: dayjs(r.date).format('DD-MMM-YYYY'), vendor: r.vendor.name, grandTotal: r.grandTotal.toString(), paidAmount: r.paidAmount.toString(), status: r.status })));
      filename = 'purchases.xlsx';
    } else if (entity === 'payments') {
      const rows = await prisma.payment.findMany({ include: { customer: true, vendor: true }, orderBy: { date: 'desc' } });
      buffer = await buildExcelBuffer('Payments', [
        { header: 'Payment No', key: 'paymentNo' }, { header: 'Date', key: 'date' }, { header: 'Party', key: 'party' },
        { header: 'Direction', key: 'direction' }, { header: 'Amount', key: 'amount' }, { header: 'Mode', key: 'mode' },
      ], rows.map((r) => ({ paymentNo: r.paymentNo, date: dayjs(r.date).format('DD-MMM-YYYY'), party: r.customer?.name || r.vendor?.name || '', direction: r.direction, amount: r.amount.toString(), mode: r.mode })));
      filename = 'payments.xlsx';
    } else if (entity === 'stock-ledger') {
      const rows = await prisma.stockTransaction.findMany({ include: { product: true }, orderBy: { date: 'desc' }, take: 5000 });
      buffer = await buildExcelBuffer('Stock Ledger', [
        { header: 'Date', key: 'date' }, { header: 'Product', key: 'product' }, { header: 'Type', key: 'type' },
        { header: 'Qty In', key: 'qtyIn' }, { header: 'Qty Out', key: 'qtyOut' }, { header: 'Balance', key: 'balanceAfter' }, { header: 'Reference', key: 'reference' },
      ], rows.map((r) => ({ date: dayjs(r.date).format('DD-MMM-YYYY'), product: r.product.name, type: r.type, qtyIn: r.qtyIn.toString(), qtyOut: r.qtyOut.toString(), balanceAfter: r.balanceAfter.toString(), reference: r.reference || '' })));
      filename = 'stock-ledger.xlsx';
    } else if (entity === 'production') {
      const rows = await prisma.productionPlan.findMany({ include: { product: true }, orderBy: { date: 'desc' } });
      buffer = await buildExcelBuffer('Production', [
        { header: 'Plan No', key: 'planNo' }, { header: 'Date', key: 'date' }, { header: 'Product', key: 'product' },
        { header: 'Planned Qty', key: 'plannedQty' }, { header: 'Completed Qty', key: 'completedQty' }, { header: 'Status', key: 'status' },
      ], rows.map((r) => ({ planNo: r.planNo, date: dayjs(r.date).format('DD-MMM-YYYY'), product: r.product.name, plannedQty: r.plannedQty.toString(), completedQty: r.completedQty.toString(), status: r.status })));
      filename = 'production.xlsx';
    } else {
      throw new ApiError(400, `Unknown export entity: ${entity}`);
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  })
);

export default router;
