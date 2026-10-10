import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { buildPoPdf, money, pdfText } from '../src/po-pdf.ts';

const data = {
  company: { name: 'Rukman Udyog', address: 'Delhi', gstin: '07AAAAA0000A1Z5', phone: null, email: 'office@example.test' },
  vendor: { name: 'ABC Supplier', address: 'Noida', gstin: null, email: 'abc@example.test' },
  po: { doc_no: 'PO-2026-27/0001', doc_date: '2026-09-01', expected_date: '2026-09-15', remarks: 'Rate ₹200 – urgent', deliver_to: 'Raw material' },
  lines: Array.from({ length: 70 }, (_, i) => ({ line_no: i + 1, item_code: `RM-${i}`, item_name: `Material ${i}`, qty: 10, unit: 'MTR', rate: 200, amount: 2000 })),
  total: 140000,
};

test('PO PDF is a valid multi-page PDF', async () => {
  const bytes = await buildPoPdf(data);
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), '%PDF-');
  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() >= 2, '70 lines need more than one page');
  assert.equal(doc.getTitle(), 'Purchase Order PO-2026-27/0001');
});

test('PO PDF without rates (vendor rate hidden) still builds', async () => {
  const bytes = await buildPoPdf({ ...data, lines: data.lines.slice(0, 2).map((l) => ({ line_no: l.line_no, item_code: l.item_code, item_name: l.item_name, qty: l.qty, unit: l.unit })), total: null });
  assert.ok(bytes.length > 500);
});

test('text helpers', () => {
  assert.equal(pdfText('₹100 – ok'), 'Rs. 100 - ok');
  assert.equal(money(140000), '1,40,000.00');
});

test('web copy of the PO PDF generator is identical', async () => {
  const { readFile } = await import('node:fs/promises');
  const strip = (s: string) => s.split('\n').slice(1).join('\n');
  const a = await readFile(new URL('../src/po-pdf.ts', import.meta.url), 'utf8');
  const b = await readFile(new URL('../../web/src/lib/po-pdf.ts', import.meta.url), 'utf8');
  assert.equal(strip(a), strip(b));
});

test('PO PDF carries the company logo, purchase terms and document footer', async () => {
  // 1×1 PNG
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const plain = await buildPoPdf({ ...data, lines: data.lines.slice(0, 3) });
  const branded = await buildPoPdf({ ...data, lines: data.lines.slice(0, 3), purchase_terms: 'Delivery within 7 days.\nPayment 30 days.',
    branding: { document_footer: 'Thank you for your business' } }, png);
  assert.ok(branded.length > plain.length, 'logo, terms and footer add content');
  const doc = await PDFDocument.load(branded);
  assert.equal(doc.getPageCount(), 1);
  // an unsupported logo format never breaks the PDF
  assert.ok((await buildPoPdf(data, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).length > 500);
});
