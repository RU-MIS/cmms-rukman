import dayjs from 'dayjs';
import { prisma } from '../../config/prisma';
import { ApiError } from '../../utils/response';
import { getSettings } from '../settings/settings.service';
import { buildDocumentPdf } from './pdf.service';
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

export async function generateDocument(type: DocumentType, id: number): Promise<GeneratedDocument> {
  const settings = await getSettings();

  switch (type) {
    case 'invoice': {
      const sale = await prisma.sale.findUnique({ where: { id }, include: { customer: true, items: { include: { product: { include: { unit: true } } } } } });
      if (!sale) throw new ApiError(404, 'Sale not found');
      const buffer = await buildDocumentPdf({
        title: 'TAX INVOICE',
        businessName: settings.businessName,
        businessAddress: settings.address ?? undefined,
        businessPhone: settings.phone ?? undefined,
        businessGstin: settings.gstin ?? undefined,
        docMeta: [
          { label: 'Invoice No', value: sale.invoiceNo },
          { label: 'Date', value: dayjs(sale.date).format('DD MMM YYYY') },
          { label: 'Customer', value: sale.customer.name },
          { label: 'GSTIN', value: sale.customer.gstin || '-' },
        ],
        columns: [
          { header: 'Product', width: 195 },
          { header: 'Qty', width: 55, align: 'right' },
          { header: 'Rate', width: 75, align: 'right' },
          { header: 'Disc', width: 60, align: 'right' },
          { header: 'Tax', width: 60, align: 'right' },
          { header: 'Total', width: 70, align: 'right' },
        ],
        rows: sale.items.map((i) => [`${i.product.name} (${i.product.unit.shortName})`, i.qty.toString(), i.rate.toFixed(2), i.discount.toFixed(2), i.taxAmount.toFixed(2), i.total.toFixed(2)]),
        totals: [
          { label: 'Subtotal', value: sale.subtotal.toFixed(2) },
          { label: 'Discount', value: sale.discount.toFixed(2) },
          { label: 'Tax', value: sale.taxAmount.toFixed(2) },
          { label: 'Grand Total', value: sale.grandTotal.toFixed(2) },
          { label: 'Paid', value: sale.paidAmount.toFixed(2) },
          { label: 'Balance', value: D(sale.grandTotal).minus(sale.paidAmount).toFixed(2) },
        ],
        footer: settings.pdfFooter ?? undefined,
      });
      return { filename: `${sale.invoiceNo}.pdf`, buffer };
    }
    case 'purchase': {
      const purchase = await prisma.purchase.findUnique({ where: { id }, include: { vendor: true, items: { include: { product: { include: { unit: true } } } } } });
      if (!purchase) throw new ApiError(404, 'Purchase not found');
      const buffer = await buildDocumentPdf({
        title: 'PURCHASE BILL',
        businessName: settings.businessName,
        businessAddress: settings.address ?? undefined,
        docMeta: [
          { label: 'Bill No', value: purchase.billNo },
          { label: 'Date', value: dayjs(purchase.date).format('DD MMM YYYY') },
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
      });
      return { filename: `${purchase.billNo}.pdf`, buffer };
    }
    case 'payment-receipt': {
      const payment = await prisma.payment.findUnique({ where: { id }, include: { customer: true, vendor: true, allocations: { include: { sale: true, purchase: true } } } });
      if (!payment) throw new ApiError(404, 'Payment not found');
      const buffer = await buildDocumentPdf({
        title: 'PAYMENT RECEIPT',
        businessName: settings.businessName,
        docMeta: [
          { label: 'Receipt No', value: payment.paymentNo },
          { label: 'Date', value: dayjs(payment.date).format('DD MMM YYYY') },
          { label: 'Party', value: payment.customer?.name || payment.vendor?.name || '-' },
          { label: 'Mode', value: payment.mode },
        ],
        columns: [
          { header: 'Applied To', width: 300 },
          { header: 'Amount', width: 215, align: 'right' },
        ],
        rows: payment.allocations.map((a) => [a.sale?.invoiceNo || a.purchase?.billNo || 'Unallocated', a.amount.toFixed(2)]),
        totals: [{ label: 'Total', value: payment.amount.toFixed(2) }],
      });
      return { filename: `${payment.paymentNo}.pdf`, buffer };
    }
    default:
      throw new ApiError(400, `Emailing document type '${type}' is not supported yet`);
  }
}
