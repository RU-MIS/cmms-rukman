import dayjs from 'dayjs';
import { prisma } from '../../config/prisma';
import { ApiError } from '../../utils/response';
import { getPdfBrand } from '../settings/settings.service';
import { buildDocumentPdf, buildTaxInvoicePdf } from './pdf.service';
import { D } from '../../utils/money';

export type DocumentType =
  | 'invoice'
  | 'purchase'
  | 'sales-order'
  | 'purchase-order'
  | 'payment-receipt'
  | 'customer-ledger'
  | 'vendor-ledger'
  | 'stock-ledger'
  | 'production-plan';

export interface GeneratedDocument {
  filename: string;
  buffer: Buffer;
}

function pct(part: unknown, whole: unknown): string {
  const w = Number(whole);
  if (!w) return '0.00';
  return ((Number(part) / w) * 100).toFixed(2);
}

export async function generateDocument(type: DocumentType, id: number): Promise<GeneratedDocument> {
  const brand = await getPdfBrand();
  const settings = brand.settings;

  switch (type) {
    case 'invoice': {
      const sale = await prisma.sale.findUnique({ where: { id }, include: { customer: true, items: { include: { product: { include: { unit: true } } } } } });
      if (!sale) throw new ApiError(404, 'Sale not found');
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
        businessName: settings.businessName,
        businessAddress: settings.address ?? undefined,
        businessPhone: settings.phone ?? undefined,
        businessEmail: settings.email ?? undefined,
        businessGstin: settings.gstin ?? undefined,
        invoiceNo: sale.invoiceNo,
        date: dayjs(sale.date).format('DD-MMM-YYYY'),
        customerId: sale.customer.code,
        billTo: party,
        shipTo: party,
        items: sale.items.map((i) => ({
          name: i.product.name,
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
        termsConditions: settings.termsConditions ?? undefined,
      });
      return { filename: `${sale.invoiceNo}.pdf`, buffer };
    }
    case 'purchase': {
      const purchase = await prisma.purchase.findUnique({ where: { id }, include: { vendor: true, items: { include: { product: { include: { unit: true } } } } } });
      if (!purchase) throw new ApiError(404, 'Purchase not found');
      const buffer = await buildDocumentPdf({
        ...brand,
        title: 'PURCHASE BILL',
        businessName: settings.businessName,
        businessAddress: settings.address ?? undefined,
        docMeta: [
          { label: 'Bill No', value: purchase.billNo },
          { label: 'Date', value: dayjs(purchase.date).format('DD-MMM-YYYY') },
          { label: 'Vendor', value: purchase.vendor.name },
        ],
        columns: [
          { header: 'Product', width: 195 },
          { header: 'Qty', width: 55, align: 'right' },
          { header: 'Rate', width: 75, align: 'right' },
          { header: 'Disc', width: 60, align: 'right' },
          { header: 'Tax', width: 60, align: 'right' },
          { header: 'Total', width: 70, align: 'right' },
        ],
        rows: purchase.items.map((i) => [`${i.product.name} (${i.product.unit.shortName})`, i.qty.toString(), i.rate.toFixed(2), i.discount.toFixed(2), i.taxAmount.toFixed(2), i.total.toFixed(2)]),
        totals: [
          { label: 'Grand Total', value: purchase.grandTotal.toFixed(2) },
          { label: 'Paid', value: purchase.paidAmount.toFixed(2) },
          { label: 'Balance', value: D(purchase.grandTotal).minus(purchase.paidAmount).toFixed(2) },
        ],
        footer: settings.pdfFooter ?? undefined,
      });
      return { filename: `${purchase.billNo}.pdf`, buffer };
    }
    case 'payment-receipt': {
      const payment = await prisma.payment.findUnique({ where: { id }, include: { customer: true, vendor: true, allocations: { include: { sale: true, purchase: true } } } });
      if (!payment) throw new ApiError(404, 'Payment not found');
      const buffer = await buildDocumentPdf({
        ...brand,
        title: 'PAYMENT RECEIPT',
        businessName: settings.businessName,
        docMeta: [
          { label: 'Receipt No', value: payment.paymentNo },
          { label: 'Date', value: dayjs(payment.date).format('DD-MMM-YYYY') },
          { label: 'Party', value: payment.customer?.name || payment.vendor?.name || '-' },
          { label: 'Mode', value: payment.mode },
        ],
        columns: [
          { header: 'Applied To', width: 300 },
          { header: 'Amount', width: 215, align: 'right' },
        ],
        rows: payment.allocations.map((a) => [a.sale?.invoiceNo || a.purchase?.billNo || 'Unallocated', a.amount.toFixed(2)]),
        totals: [{ label: 'Total', value: payment.amount.toFixed(2) }],
        footer: settings.pdfFooter ?? undefined,
      });
      return { filename: `${payment.paymentNo}.pdf`, buffer };
    }
    default:
      throw new ApiError(400, `Emailing document type '${type}' is not supported yet`);
  }
}
