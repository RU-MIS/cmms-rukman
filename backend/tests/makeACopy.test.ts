import request from 'supertest';
import { app, prisma, bootstrapCompany, loginAs, authHeader, uniqueSuffix } from './helpers';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Make a Copy', () => {
  it('clones settings and accounts from the source company but never customers or transactions', async () => {
    const suffix = uniqueSuffix();
    await bootstrapCompany({ companyName: `Source Co ${suffix}`, username: `src_${suffix}`, password: 'Correct#123' });
    const source = await loginAs(`src_${suffix}`, 'Correct#123');

    const settingsUpdate = await request(app)
      .put('/api/settings')
      .set(authHeader(source.token))
      .send({ invoicePrefix: 'SRCINV', termsConditions: 'Source terms and conditions' });
    expect(settingsUpdate.status).toBe(200);

    const customer = await request(app).post('/api/customers').set(authHeader(source.token)).send({ name: 'Source Customer' });
    expect(customer.status).toBe(201);

    const clone = await request(app)
      .post('/api/companies')
      .set(authHeader(source.token))
      .send({ name: `Cloned Co ${suffix}`, sourceCompanyId: source.activeCompany.id });
    expect(clone.status).toBe(201);
    const cloneToken = clone.body.data.token;

    const clonedSettings = await request(app).get('/api/settings').set(authHeader(cloneToken));
    expect(clonedSettings.body.data.invoicePrefix).toBe('SRCINV');
    expect(clonedSettings.body.data.termsConditions).toBe('Source terms and conditions');

    const clonedAccounts = await request(app).get('/api/accounts').set(authHeader(cloneToken));
    const cloneAccountNames = clonedAccounts.body.data.map((a: any) => a.name).sort();
    expect(cloneAccountNames).toEqual(['Bank', 'Cash']);

    const clonedCustomers = await request(app).get('/api/customers').set(authHeader(cloneToken));
    expect(clonedCustomers.body.data).toHaveLength(0);
  });

  it('refuses to clone from a company the caller does not belong to', async () => {
    const suffix = uniqueSuffix();
    const other = await bootstrapCompany({ companyName: `Other Co ${suffix}`, username: `other_${suffix}`, password: 'Correct#123' });
    await bootstrapCompany({ companyName: `Caller Co ${suffix}`, username: `caller_${suffix}`, password: 'Correct#123' });
    const caller = await loginAs(`caller_${suffix}`, 'Correct#123');

    const clone = await request(app)
      .post('/api/companies')
      .set(authHeader(caller.token))
      .send({ name: `Attempted Clone ${suffix}`, sourceCompanyId: other.company.id });
    expect(clone.status).toBe(201); // company creation itself always succeeds...

    const clonedSettings = await request(app).get('/api/settings').set(authHeader(clone.body.data.token));
    // ...but nothing was actually cloned from a company the caller doesn't own.
    expect(clonedSettings.body.data.invoicePrefix).toBe('INV');
  });
});
