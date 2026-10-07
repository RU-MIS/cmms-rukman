// Creates the e2e fixture through the real APIs: a company with an owner, a
// customer and a vendor with portal logins (passwords; OTP needs a mailbox).
import { writeFile } from 'node:fs/promises';
import { company, ok, party, service, runId } from '../lib.mjs';

async function portalLogin(ownerClient, partyId, kind, label) {
  const email = `${label}-${runId}@e2e.test`;
  const password = `Pw-${runId}-${label}!`;
  ok(await ownerClient.rpc('portal_invite', { p_party_id: partyId, p_kind: kind, p_email: email }));
  ok(await service.auth.admin.createUser({ email, password, email_confirm: true }));
  return { email, password };
}

export default async function globalSetup() {
  const { companyId, owner } = await company('UI');
  // the owner signs in through the UI with a password
  const ownerPassword = `Pw-${runId}-owner!`;
  ok(await service.auth.admin.updateUserById(owner.id, { password: ownerPassword }));
  const customerId = await party(owner.client, companyId, 'CUST', 'CUSTOMER', `buyer-${runId}@e2e.test`);
  const vendorId = await party(owner.client, companyId, 'VEND', 'SUPPLIER', `sales-${runId}@e2e.test`);
  // an operator (data entry) for permission checks
  const opEmail = `operator-${runId}@e2e.test`;
  const opPassword = `Pw-${runId}-operator!`;
  const op = ok(await service.auth.admin.createUser({ email: opEmail, password: opPassword, email_confirm: true }));
  ok(await owner.client.rpc('user_invite', { p_company_id: companyId, p_email: opEmail, p_role_code: 'OPERATOR' }));
  void op;
  // a customer contact invited to the portal who signs in with an email code (OTP)
  const otpEmail = `otp-${runId}@e2e.test`;
  ok(await owner.client.rpc('portal_invite', { p_party_id: customerId, p_kind: 'CUSTOMER', p_email: otpEmail }));
  const fixture = {
    operator: { email: opEmail, password: opPassword }, otpEmail,
    runId, companyId, customerId, vendorId,
    customerName: `CUST ${runId}`, vendorName: `VEND ${runId}`,
    owner: { email: owner.email, password: ownerPassword },
    customer: await portalLogin(owner.client, customerId, 'CUSTOMER', 'cust-portal'),
    vendor: await portalLogin(owner.client, vendorId, 'VENDOR', 'vend-portal'),
  };
  await writeFile(new URL('./.fixture.json', import.meta.url), JSON.stringify(fixture, null, 2));
}
