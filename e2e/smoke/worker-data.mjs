// Prepares data for the worker container smoke test: email automation ON,
// a vendor PO (VENDOR_PO email) and a customer invoice due soon (reminder).
import { company, ok, party, service, unitId, runId } from '../lib.mjs';

const { companyId, owner } = await company('SMOKE');
const db = owner.client;
ok(await service.from('company_settings').update({ email_automation: true, customer_reminder_enabled: true,
  customer_reminder_start_days: 15, vendor_reminder_enabled: true, vendor_reminder_start_days: 30 }).eq('company_id', companyId));
const vendor = await party(db, companyId, 'VEND', 'SUPPLIER', `vendor-${runId}@smoke.test`);
const customer = await party(db, companyId, 'CUST', 'CUSTOMER', `customer-${runId}@smoke.test`);
const mtr = await unitId('MTR');
const item = ok(await db.from('items').insert({ company_id: companyId, code: 'RM', name: 'Tape', item_kind: 'RAW_MATERIAL', base_unit_id: mtr })
  .select('id').single()).id;
const po = ok(await db.rpc('doc_save', { p_doc_type: 'PURCHASE_ORDER', p_payload: { company_id: companyId, doc_date: new Date().toISOString().slice(0, 10),
  party_id: vendor, lines: [{ item_id: item, qty: 10, unit_id: mtr, rate: 5 }] } }));
ok(await db.rpc('doc_submit', { p_doc_type: 'PURCHASE_ORDER', p_id: po }));
const due = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
const bill = ok(await db.rpc('doc_save', { p_doc_type: 'CUSTOMER_BILL', p_payload: { company_id: companyId,
  doc_date: new Date().toISOString().slice(0, 10), bill_no: `S/${runId}`, party_id: customer, amount: 5000, due_date: due } }));
ok(await db.rpc('doc_submit', { p_doc_type: 'CUSTOMER_BILL', p_id: bill }));
console.log(JSON.stringify({ companyId, vendorEmail: `vendor-${runId}@smoke.test`, customerEmail: `customer-${runId}@smoke.test`, ownerEmail: owner.email }));
