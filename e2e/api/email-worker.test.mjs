// Email worker end-to-end: real local Supabase (DB + Storage) + a local SMTP
// capture server. Covers vendor PO email with PO PDF, vendor document email
// (PO PDF + uploaded file), Tally invoice email, payment reminder, SMTP
// failure → retry, and that the ERP transaction never depends on email.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SMTPServer } from 'smtp-server';
import nodemailer from 'nodemailer';
import { company, ok, party, service, unitId } from '../lib.mjs';
import { runOnce } from '../../worker/src/worker.ts';

const quiet = { info() {}, error() {} };

function startSmtp() {
  const messages = [];
  const server = new SMTPServer({
    authOptional: true, disabledCommands: ['STARTTLS'], logger: false,
    onData(stream, session, cb) {
      let raw = '';
      stream.on('data', (c) => { raw += c.toString(); });
      stream.on('end', () => { messages.push({ to: session.envelope.rcptTo.map((r) => r.address), raw }); cb(); });
    },
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, messages, port: server.server.address().port })));
}

const transportTo = (port) => nodemailer.createTransport({ host: '127.0.0.1', port, secure: false, ignoreTLS: true });

async function outbox(companyId) {
  return ok(await service.from('email_outbox').select('*').eq('company_id', companyId).order('created_at'));
}

test('worker sends queued ERP emails with attachments and retries failures', async () => {
  const smtp = await startSmtp();
  try {
    const { companyId, owner } = await company('MAIL');
    const db = owner.client;
    ok(await service.from('company_settings').update({ email_automation: true, customer_reminder_enabled: true,
      customer_reminder_start_days: 15 }).eq('company_id', companyId));
    const vendor = await party(db, companyId, 'VEND', 'SUPPLIER', 'vendor@e2e.test');
    const customer = await party(db, companyId, 'CUST', 'CUSTOMER', 'customer@e2e.test');
    const mtr = await unitId('MTR');
    const item = ok(await db.from('items').insert({ company_id: companyId, code: 'RM-1', name: 'Cotton tape', item_kind: 'RAW_MATERIAL',
      base_unit_id: mtr }).select('id').single()).id;

    // vendor PO → VENDOR_PO email (queued only)
    const po = ok(await db.rpc('doc_save', { p_doc_type: 'PURCHASE_ORDER', p_payload: { company_id: companyId, doc_date: '2026-09-01',
      party_id: vendor, expected_date: '2026-09-15', lines: [{ item_id: item, qty: 100, unit_id: mtr, rate: 200 }] } }));
    const posted = ok(await db.rpc('doc_submit', { p_doc_type: 'PURCHASE_ORDER', p_id: po }));
    assert.equal(posted.status, 'OPEN');
    assert.ok(posted.email_id, 'PO confirmation queued an email');

    // vendor document → PO PDF + uploaded file
    const path = `${companyId}/purchase_order/${crypto.randomUUID()}-drawing.pdf`;
    ok(await db.storage.from('documents').upload(path, new Blob(['%PDF-1.4 drawing'], { type: 'application/pdf' })));
    ok(await db.rpc('document_register', { p_payload: { company_id: companyId, entity_type: 'purchase_order', entity_id: po,
      category: 'PURCHASE_DOCUMENT', storage_path: path, file_name: 'drawing.pdf', mime_type: 'application/pdf' } }));

    // Tally invoice → CUSTOMER_INVOICE
    const bill = ok(await db.rpc('doc_save', { p_doc_type: 'CUSTOMER_BILL', p_payload: { company_id: companyId, doc_date: '2026-09-10',
      bill_no: `T/${Date.now()}`, party_id: customer, amount: 100000, due_date: '2026-10-30' } }));
    ok(await db.rpc('doc_submit', { p_doc_type: 'CUSTOMER_BILL', p_id: bill }));
    const invPath = `${companyId}/customer_bill/${crypto.randomUUID()}-invoice.pdf`;
    ok(await db.storage.from('documents').upload(invPath, new Blob(['%PDF-1.4 tally invoice'], { type: 'application/pdf' })));
    ok(await db.rpc('document_register', { p_payload: { company_id: companyId, entity_type: 'customer_bill', entity_id: bill,
      category: 'INVOICE', storage_path: invPath, file_name: 'invoice.pdf', mime_type: 'application/pdf' } }));

    // 1st run: SMTP is DOWN → nothing sent, emails re-queued with the error, ERP data intact
    const down = await runOnce({ db: service, transport: transportTo(1), mailFrom: 'erp@e2e.test', log: quiet });
    assert.ok(down.failed >= 3);
    let rows = await outbox(companyId);
    assert.equal(rows.length, 3);
    for (const r of rows) {
      assert.equal(r.status, 'QUEUED');
      assert.equal(r.attempts, 1);
      assert.ok(r.last_error, 'error recorded');
    }
    const poRow = ok(await db.from('purchase_orders').select('status').eq('id', po).single());
    assert.equal(poRow.status, 'OPEN', 'PO stays confirmed although SMTP failed');

    // retry now (instead of waiting for the back-off) and send to the working SMTP
    ok(await service.from('email_outbox').update({ next_attempt_at: new Date().toISOString() }).eq('company_id', companyId));
    const up = await runOnce({ db: service, transport: transportTo(smtp.port), mailFrom: 'erp@e2e.test', log: quiet });
    assert.ok(up.sent >= 3);
    rows = await outbox(companyId);
    assert.deepEqual(rows.map((r) => r.status), ['SENT', 'SENT', 'SENT']);

    const mine = smtp.messages.filter((m) => m.raw.includes(companyId) || rows.some((r) => m.raw.includes(r.id)));
    const byKind = (k) => mine.find((m) => new RegExp(`^X-ERP-Email-Kind: ${k}\\s*$`, 'im').test(m.raw));
    const poMail = byKind('VENDOR_PO');
    assert.deepEqual(poMail.to, ['vendor@e2e.test']);
    assert.match(poMail.raw, /filename=.?PO-PO-/, 'PO PDF attached');
    assert.match(poMail.raw, /application\/pdf/);
    const docMail = byKind('VENDOR_DOCUMENT');
    assert.match(docMail.raw, /PO-PO-/, 'PO PDF attached to the document email');
    assert.match(docMail.raw, /drawing\.pdf/, 'uploaded document attached');
    const invMail = byKind('CUSTOMER_INVOICE');
    assert.deepEqual(invMail.to, ['customer@e2e.test']);
    assert.match(invMail.raw, /invoice\.pdf/);

    const events = ok(await service.from('email_events').select('status').in('outbox_id', rows.map((r) => r.id)));
    assert.ok(events.some((e) => e.status === 'SENDING') && events.some((e) => e.status === 'SENT'), 'history kept');

    // payment reminder generated + sent by the worker (15 days before 30 Oct)
    const rem = await runOnce({ db: service, transport: transportTo(smtp.port), mailFrom: 'erp@e2e.test', reminders: true,
      asOf: '2026-10-15', log: quiet });
    assert.ok(rem.reminders.customer_reminders >= 1);
    const remRow = (await outbox(companyId)).find((r) => r.kind === 'CUSTOMER_PAYMENT_REMINDER');
    assert.equal(remRow.status, 'SENT');
    assert.ok(smtp.messages.some((m) => m.raw.includes(remRow.id)), 'reminder delivered');
  } finally {
    await new Promise((r) => smtp.server.close(r));
  }
});
