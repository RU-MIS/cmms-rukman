import { Router } from 'express';
import dayjs from 'dayjs';
import { prisma } from '../../config/prisma';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/response';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { getPdfBrand } from '../settings/settings.service';
import { buildDocumentPdf, buildTaxInvoicePdf } from './pdf.service';
import { D } from '../../utils/money';

const router = Router();
router.use(requireAuth);

function send(res: any, filename: string, buffer: Buffer) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.send(buffer);
}

function pct(part: unknown, whole: unknown): string {
  const w = Number(whole);
  if (!w) return '0.00';
  return ((Number(part) / w) * 100).toFixed(2);
}

router.get(
  '/invoice/:saleId',
  requirePermission('documents', 'view'),
  asyncHandler(async (req, res) => {
    const sale = await prisma.sale.findUnique({
      where: { id: Number(req.params.saleId) },
      include: { customer: true, items: { include: { product: { include: { unit: true } } } } },
    });
    if (!sale) throw new ApiError(404, 'Sale not found');
    const brand = await getPdfBrand();
    const address = [sale.customer.address, sale.customer.city, sale.customer.state, sale.customer.pincode].filter(Boolean).join(', ');
    const party = {
      name: sale.customer.name,
      address: address || undefined,
      gstin: sale.customer.gstin ?? undefined,
      phone: sale.customer.mobile ?? undefined,
      email: sale.customer.email ?? undefined,
    };

    const buffer = await buildTaxInvoicePdf({
      logoPath: brand.logoPath,
      fontFamily: brand.fontFamily,
      scale: brand.scale,
      businessName: brand.settings.businessName,
      businessAddress: brand.settings.address ?? undefined,
      businessPhone: brand.settings.phone ?? undefined,
      businessEmail: brand.settings.email ?? undefined,
      businessGstin: brand.settings.gstin ?? undefined,
      invoiceNo: sale.invoiceNo,
      date: dayjs(sale.date).format('DD-MMM-YYYY'),
      customerId: sale.customer.code,
      billTo: party,
      shipTo: party,
      items: sale.items.map((i) => ({
        name: `${i.product.name}`,
        qty: i.qty.toString(),
        unit: i.product.unit.shortName,
        rate: i.rate.toFixed(2),
        gstPercent: i.taxRate.toFixed(2),
        discountPercent: pct(i.discount, D(i.qty).mul(i.rate)),
        amount: i.total.toFixed(2),
      })),
      totalTaxableValue: sale.subtotal.toFixed(2),
      gstAmount: sale.taxAmount.toFixed(2),
      discount: sale.discount.toFixed(2),
      totalValue: sale.grandTotal.toFixed(2),
      termsConditions: brand.settings.termsConditions ?? undefined,
    });
    send(res, `${sale.invoiceNo}.pdf`, buffer);
  })
);

router.get(
  '/purchase/:purchaseId',
  requirePermission('documents', 'view'),
  asyncHandler(async (req, res) => {
    const purchase = await prisma.purchase.findUnique({
      where: { id: Number(req.params.purchaseId) },
      include: { vendor: true, items: { include: { product: { include: { unit: true } } } } },
    });
    if (!purchase) throw new ApiError(404, 'Purchase not found');
    const brand = await getPdfBrand();

    const buffer = await buildDocumentPdf({
      ...brand,
      title: 'PURCHASE BILL',
      businessName: brand.settings.businessName,
      businessAddress: brand.settings.address ?? undefined,
      businessPhone: brand.settings.phone ?? undefined,
      businessGstin: brand.settings.gstin ?? undefined,
      docMeta: [
        { label: 'Bill No', value: purchase.billNo },
        { label: 'Date', value: dayjs(purchase.date).format('DD MMM YYYY') },
        { label: 'Vendor', value: purchase.vendor.name },
        { label: 'GSTIN', value: purchase.vendor.gstin || '-' },
      ],
      columns: [
        { header: 'Product', width: 195 },
        { header: 'Qty', width: 55, align: 'right' },
        { header: 'Rate', width: 75, align: 'right' },
        { header: 'Disc', width: 60, align: 'right' },
        { header: 'Tax', width: 60, align: 'right' },
        { header: 'Total', width: 70, align: 'right' },
      ],
      rows: purchase.items.map((i) => [
        `${i.product.name} (${i.product.unit.shortName})`,
        i.qty.toString(),
        i.rate.toFixed(2),
        i.discount.toFixed(2),
        i.taxAmount.toFixed(2),
        i.total.toFixed(2),
      ]),
      totals: [
        { label: 'Subtotal', value: purchase.subtotal.toFixed(2) },
        { label: 'Discount', value: purchase.discount.toFixed(2) },
        { label: 'Tax', value: purchase.taxAmount.toFixed(2) },
        { label: 'Grand Total', value: purchase.grandTotal.toFixed(2) },
        { label: 'Paid', value: purchase.paidAmount.toFixed(2) },
        { label: 'Balance', value: D(purchase.grandTotal).minus(purchase.paidAmount).toFixed(2) },
      ],
      footer: brand.settings.pdfFooter ?? undefined,
    });
    send(res, `${purchase.billNo}.pdf`, buffer);
  })
);

router.get(
  '/sales-order/:id',
  requirePermission('documents', 'view'),
  asyncHandler(async (req, res) => {
    const order = await prisma.salesOrder.findUnique({
      where: { id: Number(req.params.id) },
      include: { customer: true, items: { include: { product: { include: { unit: true } } } } },
    });
    if (!order) throw new ApiError(404, 'Sales order not found');
    const brand = await getPdfBrand();
    const buffer = await buildDocumentPdf({
      ...brand,
      title: 'SALES ORDER',
      businessName: brand.settings.businessName,
      businessAddress: brand.settings.address ?? undefined,
      docMeta: [
        { label: 'Order No', value: order.orderNo },
        { label: 'Date', value: dayjs(order.date).format('DD MMM YYYY') },
        { label: 'Customer', value: order.customer.name },
        { label: 'Status', value: order.status },
      ],
      columns: [
        { header: 'Product', width: 235 },
        { header: 'Ordered', width: 90, align: 'right' },
        { header: 'Delivered', width: 90, align: 'right' },
        { header: 'Rate', width: 100, align: 'right' },
      ],
      rows: order.items.map((i) => [`${i.product.name} (${i.product.unit.shortName})`, i.orderedQty.toString(), i.deliveredQty.toString(), i.rate.toFixed(2)]),
      footer: brand.settings.pdfFooter ?? undefined,
    });
    send(res, `${order.orderNo}.pdf`, buffer);
  })
);

router.get(
  '/purchase-order/:id',
  requirePermission('documents', 'view'),
  asyncHandler(async (req, res) => {
    const order = await prisma.purchaseOrder.findUnique({
      where: { id: Number(req.params.id) },
      include: { vendor: true, items: { include: { product: { include: { unit: true } } } } },
    });
    if (!order) throw new ApiError(404, 'Purchase order not found');
    const brand = await getPdfBrand();
    const buffer = await buildDocumentPdf({
      ...brand,
      title: 'PURCHASE ORDER',
      businessName: brand.settings.businessName,
      businessAddress: brand.settings.address ?? undefined,
      docMeta: [
        { label: 'Order No', value: order.orderNo },
        { label: 'Date', value: dayjs(order.date).format('DD MMM YYYY') },
        { label: 'Vendor', value: order.vendor.name },
        { label: 'Status', value: order.status },
      ],
      columns: [
        { header: 'Product', width: 235 },
        { header: 'Ordered', width: 90, align: 'right' },
        { header: 'Received', width: 90, align: 'right' },
        { header: 'Rate', width: 100, align: 'right' },
      ],
      rows: order.items.map((i) => [`${i.product.name} (${i.product.unit.shortName})`, i.orderedQty.toString(), i.receivedQty.toString(), i.rate.toFixed(2)]),
      footer: brand.settings.pdfFooter ?? undefined,
    });
    send(res, `${order.orderNo}.pdf`, buffer);
  })
);

router.get(
  '/payment-receipt/:id',
  requirePermission('documents', 'view'),
  asyncHandler(async (req, res) => {
    const payment = await prisma.payment.findUnique({
      where: { id: Number(req.params.id) },
      include: { customer: true, vendor: true, allocations: { include: { sale: true, purchase: true } } },
    });
    if (!payment) throw new ApiError(404, 'Payment not found');
    const brand = await getPdfBrand();
    const party = payment.customer?.name || payment.vendor?.name || '-';
    const buffer = await buildDocumentPdf({
      ...brand,
      title: 'PAYMENT RECEIPT',
      businessName: brand.settings.businessName,
      businessAddress: brand.settings.address ?? undefined,
      docMeta: [
        { label: 'Receipt No', value: payment.paymentNo },
        { label: 'Date', value: dayjs(payment.date).format('DD MMM YYYY') },
        { label: 'Party', value: party },
        { label: 'Mode', value: payment.mode },
      ],
      columns: [
        { header: 'Applied To', width: 300, align: 'left' },
        { header: 'Amount', width: 215, align: 'right' },
      ],
      rows: payment.allocations.map((a) => [a.sale?.invoiceNo || a.purchase?.billNo || 'Unallocated', a.amount.toFixed(2)]),
      totals: [{ label: 'Total Received/Paid', value: payment.amount.toFixed(2) }],
      footer: brand.settings.pdfFooter ?? undefined,
    });
    send(res, `${payment.paymentNo}.pdf`, buffer);
  })
);

router.get(
  '/customer-ledger/:customerId',
  requirePermission('documents', 'view'),
  asyncHandler(async (req, res) => {
    const customer = await prisma.customer.findUnique({ where: { id: Number(req.params.customerId) } });
    if (!customer) throw new ApiError(404, 'Customer not found');
    const [sales, payments, returns] = await Promise.all([
      prisma.sale.findMany({ where: { customerId: customer.id, status: 'CONFIRMED' } }),
      prisma.payment.findMany({ where: { customerId: customer.id } }),
      prisma.saleReturn.findMany({ where: { customerId: customer.id } }),
    ]);
    const entries = [
      ...sales.map((s) => ({ date: s.date, type: 'Sale', ref: s.invoiceNo, debit: D(s.grandTotal), credit: D(0) })),
      ...payments.map((p) => ({ date: p.date, type: 'Payment', ref: p.paymentNo, debit: D(0), credit: D(p.amount) })),
      ...returns.map((r) => ({ date: r.date, type: 'Return', ref: r.returnNo, debit: D(0), credit: D(r.totalAmount) })),
    ].sort((a, b) => a.date.getTime() - b.date.getTime());

    let balance = D(customer.openingBalance);
    const rows = [['Opening Balance', '-', '-', '-', '-', balance.toFixed(2)]];
    for (const e of entries) {
      balance = balance.plus(e.debit).minus(e.credit);
      rows.push([dayjs(e.date).format('DD-MMM-YY'), e.type, e.ref, e.debit.toFixed(2), e.credit.toFixed(2), balance.toFixed(2)]);
    }

    const brand = await getPdfBrand();
    const buffer = await buildDocumentPdf({
      ...brand,
      title: 'CUSTOMER LEDGER',
      businessName: brand.settings.businessName,
      docMeta: [{ label: 'Customer', value: customer.name }, { label: 'Code', value: customer.code }],
      columns: [
        { header: 'Date', width: 80 },
        { header: 'Type', width: 90 },
        { header: 'Reference', width: 115 },
        { header: 'Debit', width: 75, align: 'right' },
        { header: 'Credit', width: 75, align: 'right' },
        { header: 'Balance', width: 80, align: 'right' },
      ],
      rows,
      totals: [{ label: 'Closing Balance', value: balance.toFixed(2) }],
      footer: brand.settings.pdfFooter ?? undefined,
    });
    send(res, `Ledger-${customer.code}.pdf`, buffer);
  })
);

router.get(
  '/vendor-ledger/:vendorId',
  requirePermission('documents', 'view'),
  asyncHandler(async (req, res) => {
    const vendor = await prisma.vendor.findUnique({ where: { id: Number(req.params.vendorId) } });
    if (!vendor) throw new ApiError(404, 'Vendor not found');
    const [purchases, payments, returns] = await Promise.all([
      prisma.purchase.findMany({ where: { vendorId: vendor.id, status: 'CONFIRMED' } }),
      prisma.payment.findMany({ where: { vendorId: vendor.id } }),
      prisma.purchaseReturn.findMany({ where: { vendorId: vendor.id } }),
    ]);
    const entries = [
      ...purchases.map((p) => ({ date: p.date, type: 'Purchase', ref: p.billNo, debit: D(0), credit: D(p.grandTotal) })),
      ...payments.map((p) => ({ date: p.date, type: 'Payment', ref: p.paymentNo, debit: D(p.amount), credit: D(0) })),
      ...returns.map((r) => ({ date: r.date, type: 'Return', ref: r.returnNo, debit: D(r.totalAmount), credit: D(0) })),
    ].sort((a, b) => a.date.getTime() - b.date.getTime());

    let balance = D(vendor.openingBalance);
    const rows = [['Opening Balance', '-', '-', '-', '-', balance.toFixed(2)]];
    for (const e of entries) {
      balance = balance.plus(e.credit).minus(e.debit);
      rows.push([dayjs(e.date).format('DD-MMM-YY'), e.type, e.ref, e.debit.toFixed(2), e.credit.toFixed(2), balance.toFixed(2)]);
    }

    const brand = await getPdfBrand();
    const buffer = await buildDocumentPdf({
      ...brand,
      title: 'VENDOR LEDGER',
      businessName: brand.settings.businessName,
      docMeta: [{ label: 'Vendor', value: vendor.name }, { label: 'Code', value: vendor.code }],
      columns: [
        { header: 'Date', width: 80 },
        { header: 'Type', width: 90 },
        { header: 'Reference', width: 115 },
        { header: 'Debit', width: 75, align: 'right' },
        { header: 'Credit', width: 75, align: 'right' },
        { header: 'Balance', width: 80, align: 'right' },
      ],
      rows,
      totals: [{ label: 'Closing Balance', value: balance.toFixed(2) }],
      footer: brand.settings.pdfFooter ?? undefined,
    });
    send(res, `Ledger-${vendor.code}.pdf`, buffer);
  })
);

router.get(
  '/stock-ledger',
  requirePermission('documents', 'view'),
  asyncHandler(async (req, res) => {
    const productId = req.query.productId ? Number(req.query.productId) : undefined;
    if (!productId) throw new ApiError(400, 'productId is required');
    const product = await prisma.product.findUnique({ where: { id: productId }, include: { unit: true } });
    if (!product) throw new ApiError(404, 'Product not found');
    const txns = await prisma.stockTransaction.findMany({ where: { productId }, orderBy: { date: 'asc' } });

    const brand = await getPdfBrand();
    const buffer = await buildDocumentPdf({
      ...brand,
      title: 'STOCK LEDGER',
      businessName: brand.settings.businessName,
      docMeta: [{ label: 'Product', value: product.name }, { label: 'SKU', value: product.sku }],
      columns: [
        { header: 'Date', width: 80 },
        { header: 'Type', width: 130 },
        { header: 'Ref', width: 105 },
        { header: 'In', width: 65, align: 'right' },
        { header: 'Out', width: 65, align: 'right' },
        { header: 'Balance', width: 70, align: 'right' },
      ],
      rows: txns.map((t) => [
        dayjs(t.date).format('DD-MMM-YY'),
        t.type,
        t.reference || '-',
        t.qtyIn.toString(),
        t.qtyOut.toString(),
        t.balanceAfter.toString(),
      ]),
      footer: brand.settings.pdfFooter ?? undefined,
    });
    send(res, `StockLedger-${product.sku}.pdf`, buffer);
  })
);

router.get(
  '/production-plan/:id',
  requirePermission('documents', 'view'),
  asyncHandler(async (req, res) => {
    const plan = await prisma.productionPlan.findUnique({ where: { id: Number(req.params.id) }, include: { product: { include: { unit: true } } } });
    if (!plan) throw new ApiError(404, 'Production plan not found');
    const bom = await prisma.bomItem.findMany({ where: { finishedProductId: plan.productId }, include: { component: { include: { unit: true } } } });
    const brand = await getPdfBrand();
    const buffer = await buildDocumentPdf({
      ...brand,
      title: 'PRODUCTION PLAN',
      businessName: brand.settings.businessName,
      docMeta: [
        { label: 'Plan No', value: plan.planNo },
        { label: 'Product', value: plan.product.name },
        { label: 'Planned Qty', value: plan.plannedQty.toString() },
        { label: 'Status', value: plan.status },
      ],
      columns: [
        { header: 'Raw Material', width: 235 },
        { header: 'Qty / Unit', width: 90, align: 'right' },
        { header: 'Required (Total)', width: 190, align: 'right' },
      ],
      rows: bom.map((b) => [b.component.name, `${b.qtyPerUnit} ${b.component.unit.shortName}`, `${D(b.qtyPerUnit).mul(plan.plannedQty)} ${b.component.unit.shortName}`]),
      footer: brand.settings.pdfFooter ?? undefined,
    });
    send(res, `${plan.planNo}.pdf`, buffer);
  })
);

const LIST_ENTITIES: Record<string, { title: string; columns: { header: string; width: number; align?: 'left' | 'right' | 'center' }[]; fetch: () => Promise<(string | number)[][]> }> = {
  customers: {
    title: 'CUSTOMERS',
    columns: [
      { header: 'Code', width: 70 },
      { header: 'Name', width: 150 },
      { header: 'Mobile', width: 90 },
      { header: 'City', width: 90 },
      { header: 'GSTIN', width: 115 },
    ],
    fetch: async () => {
      const rows = await prisma.customer.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
      return rows.map((r) => [r.code, r.name, r.mobile || '-', r.city || '-', r.gstin || '-']);
    },
  },
  vendors: {
    title: 'VENDORS',
    columns: [
      { header: 'Code', width: 70 },
      { header: 'Name', width: 150 },
      { header: 'Mobile', width: 90 },
      { header: 'City', width: 90 },
      { header: 'GSTIN', width: 115 },
    ],
    fetch: async () => {
      const rows = await prisma.vendor.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
      return rows.map((r) => [r.code, r.name, r.mobile || '-', r.city || '-', r.gstin || '-']);
    },
  },
  products: {
    title: 'PRODUCTS',
    columns: [
      { header: 'SKU', width: 70 },
      { header: 'Name', width: 180 },
      { header: 'Sale Rate', width: 85, align: 'right' },
      { header: 'Stock', width: 85, align: 'right' },
      { header: 'Unit', width: 95 },
    ],
    fetch: async () => {
      const rows = await prisma.product.findMany({ where: { active: true }, include: { unit: true }, orderBy: { name: 'asc' } });
      return rows.map((r) => [r.sku, r.name, r.saleRate.toFixed(2), r.currentStock.toString(), r.unit.shortName]);
    },
  },
};

router.get(
  '/list/:entity',
  requirePermission('documents', 'view'),
  asyncHandler(async (req, res) => {
    const entity = LIST_ENTITIES[req.params.entity];
    if (!entity) throw new ApiError(400, `Unknown list document: ${req.params.entity}`);
    const brand = await getPdfBrand();
    const rows = await entity.fetch();
    const buffer = await buildDocumentPdf({
      ...brand,
      title: entity.title,
      businessName: brand.settings.businessName,
      businessAddress: brand.settings.address ?? undefined,
      docMeta: [{ label: 'Generated', value: dayjs().format('DD MMM YYYY') }, { label: 'Total Records', value: String(rows.length) }],
      columns: entity.columns,
      rows,
      footer: brand.settings.pdfFooter ?? undefined,
    });
    send(res, `${req.params.entity}.pdf`, buffer);
  })
);

export default router;
