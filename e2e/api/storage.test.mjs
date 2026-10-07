// Gap 7 (docs/INVENTORY_REQUIREMENTS_CHECKLIST.md): document storage security on
// REAL Supabase Storage — files are private, company users need documents.view,
// portal users only get files of their own party that are marked visible.
import test from 'node:test';
import assert from 'node:assert/strict';
import { anon, company, ok, party, portalUser, service, user } from '../lib.mjs';

const pdf = (text) => new Blob([`%PDF-1.4\n% ${text}\n`], { type: 'application/pdf' });

test('document storage is isolated per company, party and visibility', async () => {
  const { companyId, owner } = await company('STO');
  const other = await company('STO2');
  ok(await service.from('company_settings').update({ customer_portal_enabled: true }).eq('company_id', companyId));
  const custA = await party(owner.client, companyId, 'CUST-A', 'CUSTOMER');
  const custB = await party(owner.client, companyId, 'CUST-B', 'CUSTOMER');
  const portalA = await portalUser(owner.client, custA, 'CUSTOMER', 'portal-a');
  const portalB = await portalUser(owner.client, custB, 'CUSTOMER', 'portal-b');
  assert.equal(portalA.boot.portals[0].party_id, custA, 'invite linked to customer A on first login');

  const bucket = (c) => c.storage.from('documents');

  // internal upload into the company folder + register (visible to customer A)
  const sharedPath = `${companyId}/party/${crypto.randomUUID()}-statement.pdf`;
  ok(await bucket(owner.client).upload(sharedPath, pdf('shared')));
  ok(await owner.client.rpc('document_register', { p_payload: {
    company_id: companyId, entity_type: 'party', entity_id: custA, category: 'OTHER',
    storage_path: sharedPath, file_name: 'statement.pdf', visible_to_party: true, send_email: false } }));
  const hiddenPath = `${companyId}/party/${crypto.randomUUID()}-internal.pdf`;
  ok(await bucket(owner.client).upload(hiddenPath, pdf('internal')));
  ok(await owner.client.rpc('document_register', { p_payload: {
    company_id: companyId, entity_type: 'party', entity_id: custA, category: 'OTHER',
    storage_path: hiddenPath, file_name: 'internal.pdf', visible_to_party: false, send_email: false } }));

  // owner can read both
  assert.ok((await bucket(owner.client).download(sharedPath)).data, 'owner reads shared file');
  assert.ok((await bucket(owner.client).download(hiddenPath)).data, 'owner reads internal file');

  // customer A: shared yes, internal no
  const a1 = await bucket(portalA.client).download(sharedPath);
  assert.equal(a1.error, null, 'customer A downloads his shared document');
  assert.match(await a1.data.text(), /shared/);
  assert.ok((await bucket(portalA.client).download(hiddenPath)).error, 'customer A cannot read an internal document');

  // customer B: nothing of customer A
  assert.ok((await bucket(portalB.client).download(sharedPath)).error, 'customer B cannot read customer A file');

  // owner of another company: nothing
  assert.ok((await bucket(other.owner.client).download(sharedPath)).error, 'other company cannot read the file');
  assert.ok((await bucket(other.owner.client).upload(`${companyId}/party/x.pdf`, pdf('x'))).error,
    'other company cannot upload into this company folder');

  // anonymous: nothing
  assert.ok((await bucket(anon()).download(sharedPath)).error, 'anonymous cannot read');

  // signed-in stranger (no company, no portal)
  const stranger = await user('stranger');
  assert.ok((await bucket(stranger.client).download(sharedPath)).error, 'stranger cannot read');
  assert.ok((await bucket(stranger.client).upload(`${companyId}/party/y.pdf`, pdf('y'))).error, 'stranger cannot upload');

  // customer uploads only into his own portal folder
  const own = `${companyId}/portal/${custA}/${crypto.randomUUID()}-po.pdf`;
  assert.equal((await bucket(portalA.client).upload(own, pdf('po'))).error, null, 'customer A uploads into his portal folder');
  assert.ok((await bucket(portalA.client).upload(`${companyId}/portal/${custB}/z.pdf`, pdf('z'))).error,
    'customer A cannot upload into customer B folder');
  assert.ok((await bucket(portalA.client).upload(`${companyId}/party/z.pdf`, pdf('z'))).error,
    'customer A cannot upload into internal folders');

  // documents table itself is not readable by the portal user
  const docs = ok(await portalA.client.from('documents').select('id'));
  assert.equal(docs.length, 0, 'portal user cannot list the documents table');
  const list = ok(await portalA.client.rpc('portal_documents', { p_company_id: companyId, p_kind: 'CUSTOMER' }));
  assert.deepEqual(list.map((d) => d.file_name), ['statement.pdf'], 'portal document list = only shared file');

  // portal switched off → file access closed
  ok(await service.from('company_settings').update({ customer_portal_enabled: false }).eq('company_id', companyId));
  assert.ok((await bucket(portalA.client).download(sharedPath)).error, 'portal OFF → customer cannot download');
});
