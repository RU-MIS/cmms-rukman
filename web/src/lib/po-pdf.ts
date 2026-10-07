// KEEP IN SYNC with worker/src/po-pdf.ts (checked by worker/test/po-pdf.test.ts).
// Purchase Order PDF (§25) from app.purchase_order_print_data().
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

export interface PoPrintData {
  company: { name: string; legal_name?: string; address?: string; gstin?: string | null; phone?: string | null; email?: string | null };
  vendor: { name: string; address?: string; gstin?: string | null; email?: string | null; mobile?: string | null };
  po: { doc_no: string; doc_date: string; expected_date?: string | null; status?: string; remarks?: string | null; deliver_to?: string | null };
  lines: Array<{ line_no: number; item_code: string; item_name: string; description?: string | null; qty: number; unit: string;
                 rate?: number | null; amount?: number | null }>;
  total?: number | null;
}

// Standard PDF fonts only cover WinAnsi: replace anything else (₹ etc.).
export function pdfText(s: unknown): string {
  return String(s ?? '')
    .replace(/₹/g, 'Rs. ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
}

export function money(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}-${m}-${y}`;
}

export async function buildPoPdf(data: PoPrintData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Purchase Order ${pdfText(data.po.doc_no)}`);
  doc.setProducer('Rukman Dataflow Management System');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const showRates = data.lines.some((l) => l.rate !== undefined);

  let page = doc.addPage([595.28, 841.89]); // A4
  const margin = 40;
  let y = 800;
  const text = (p: PDFPage, s: string, x: number, yy: number, size = 10, f: PDFFont = font) =>
    p.drawText(pdfText(s), { x, y: yy, size, font: f, color: rgb(0.1, 0.1, 0.1) });

  text(page, data.company.name, margin, y, 16, bold); y -= 16;
  if (data.company.address) { text(page, data.company.address, margin, y, 9); y -= 12; }
  const contact = [data.company.gstin && `GSTIN ${data.company.gstin}`, data.company.phone, data.company.email].filter(Boolean).join('  |  ');
  if (contact) { text(page, contact, margin, y, 9); y -= 12; }
  y -= 10;
  text(page, 'PURCHASE ORDER', margin, y, 14, bold);
  text(page, `PO No: ${data.po.doc_no}`, 380, y, 10, bold); y -= 14;
  text(page, `Date: ${fmtDate(data.po.doc_date)}`, 380, y); y -= 14;
  if (data.po.expected_date) { text(page, `Expected delivery: ${fmtDate(data.po.expected_date)}`, 380, y); y -= 14; }
  if (data.po.deliver_to) { text(page, `Deliver to: ${data.po.deliver_to}`, 380, y); y -= 14; }

  y -= 6;
  text(page, 'Vendor', margin, y, 10, bold); y -= 13;
  text(page, data.vendor.name, margin, y); y -= 12;
  if (data.vendor.address) { text(page, data.vendor.address, margin, y, 9); y -= 12; }
  if (data.vendor.gstin) { text(page, `GSTIN ${data.vendor.gstin}`, margin, y, 9); y -= 12; }
  y -= 12;

  const cols = showRates
    ? [{ h: '#', x: margin }, { h: 'Item', x: margin + 22 }, { h: 'Qty', x: 330 }, { h: 'Unit', x: 385 }, { h: 'Rate', x: 430 }, { h: 'Amount', x: 495 }]
    : [{ h: '#', x: margin }, { h: 'Item', x: margin + 22 }, { h: 'Qty', x: 420 }, { h: 'Unit', x: 480 }];
  const header = () => {
    page.drawRectangle({ x: margin - 4, y: y - 4, width: 595.28 - 2 * margin + 8, height: 18, color: rgb(0.92, 0.94, 0.97) });
    cols.forEach((c) => text(page, c.h, c.x, y, 9, bold));
    y -= 20;
  };
  header();
  for (const l of data.lines) {
    if (y < 80) { page = doc.addPage([595.28, 841.89]); y = 800; header(); }
    const name = `${l.item_code} - ${l.item_name}`.slice(0, showRates ? 52 : 70);
    text(page, String(l.line_no), cols[0].x, y, 9);
    text(page, name, cols[1].x, y, 9);
    text(page, String(Number(l.qty)), cols[2].x, y, 9);
    text(page, l.unit, cols[3].x, y, 9);
    if (showRates) {
      text(page, l.rate === null || l.rate === undefined ? '-' : money(l.rate), cols[4].x, y, 9);
      text(page, money(l.amount), cols[5].x, y, 9);
    }
    y -= 15;
  }
  if (showRates && data.total !== undefined && data.total !== null) {
    y -= 4;
    page.drawLine({ start: { x: 380, y: y + 10 }, end: { x: 555, y: y + 10 }, thickness: 0.5 });
    text(page, 'Total', 430, y, 10, bold);
    text(page, money(data.total), 495, y, 10, bold);
    y -= 20;
  }
  if (data.po.remarks) { y -= 6; text(page, `Remarks: ${data.po.remarks}`, margin, y, 9); y -= 14; }
  text(page, 'This is a computer generated purchase order.', margin, 50, 8);
  return doc.save();
}
