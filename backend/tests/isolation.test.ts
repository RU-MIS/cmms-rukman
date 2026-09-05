import request from 'supertest';
import { app, prisma, bootstrapCompany, loginAs, authHeader, uniqueSuffix } from './helpers';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Company isolation', () => {
  it('never returns another company\'s customers from a list endpoint', async () => {
    const suffix = uniqueSuffix();
    await bootstrapCompany({ companyName: `Iso A ${suffix}`, username: `isoA_${suffix}`, password: 'Correct#123' });
    await bootstrapCompany({ companyName: `Iso B ${suffix}`, username: `isoB_${suffix}`, password: 'Correct#123' });
    const a = await loginAs(`isoA_${suffix}`, 'Correct#123');
    const b = await loginAs(`isoB_${suffix}`, 'Correct#123');

    const createdInA = await request(app).post('/api/customers').set(authHeader(a.token)).send({ name: 'A Customer' });
    expect(createdInA.status).toBe(201);

    const listInB = await request(app).get('/api/customers').set(authHeader(b.token));
    expect(listInB.status).toBe(200);
    expect(listInB.body.data.find((c: any) => c.id === createdInA.body.data.id)).toBeUndefined();
  });

  it('returns 404, not the record, when fetching another company\'s customer by id', async () => {
    const suffix = uniqueSuffix();
    await bootstrapCompany({ companyName: `Iso A ${suffix}`, username: `isoA_${suffix}`, password: 'Correct#123' });
    await bootstrapCompany({ companyName: `Iso B ${suffix}`, username: `isoB_${suffix}`, password: 'Correct#123' });
    const a = await loginAs(`isoA_${suffix}`, 'Correct#123');
    const b = await loginAs(`isoB_${suffix}`, 'Correct#123');

    const createdInA = await request(app).post('/api/customers').set(authHeader(a.token)).send({ name: 'A Customer' });
    const fetchFromB = await request(app).get(`/api/customers/${createdInA.body.data.id}`).set(authHeader(b.token));
    expect(fetchFromB.status).toBe(404);
  });

  it('rejects creating a product with another company\'s unit id (cross-tenant FK injection)', async () => {
    const suffix = uniqueSuffix();
    await bootstrapCompany({ companyName: `Iso A ${suffix}`, username: `isoA_${suffix}`, password: 'Correct#123' });
    await bootstrapCompany({ companyName: `Iso B ${suffix}`, username: `isoB_${suffix}`, password: 'Correct#123' });
    const a = await loginAs(`isoA_${suffix}`, 'Correct#123');
    const b = await loginAs(`isoB_${suffix}`, 'Correct#123');

    const unitInA = await request(app).post('/api/units').set(authHeader(a.token)).send({ name: 'Pieces', shortName: 'Pcs' });
    expect(unitInA.status).toBe(201);

    const productInB = await request(app)
      .post('/api/products')
      .set(authHeader(b.token))
      .send({ name: 'Cross-tenant product', unitId: unitInA.body.data.id, saleRate: 10, purchaseRate: 5 });
    expect(productInB.status).toBe(400);
  });

  it('rejects unauthorized access to a company the user is not a member of', async () => {
    const suffix = uniqueSuffix();
    await bootstrapCompany({ companyName: `Iso A ${suffix}`, username: `isoA_${suffix}`, password: 'Correct#123' });
    const other = await bootstrapCompany({ companyName: `Iso Other ${suffix}`, username: `isoOther_${suffix}`, password: 'Correct#123' });
    const a = await loginAs(`isoA_${suffix}`, 'Correct#123');

    const res = await request(app)
      .post('/api/auth/switch-company')
      .set(authHeader(a.token))
      .send({ companyId: other.company.id });
    expect(res.status).toBe(403);
  });

  it('switches company successfully for an actual member and issues a token scoped to it', async () => {
    const suffix = uniqueSuffix();
    const primary = await bootstrapCompany({ companyName: `Switch Primary ${suffix}`, username: `switch_${suffix}`, password: 'Correct#123' });
    const secondary = await bootstrapCompany({ companyName: `Switch Secondary ${suffix}`, username: `switch2_${suffix}`, password: 'Correct#123' });
    // Make the same user a member of both companies.
    await prisma.companyUser.create({
      data: { companyId: secondary.company.id, userId: primary.user.id, roleId: secondary.adminRole.id },
    });

    const loggedIn = await loginAs(`switch_${suffix}`, 'Correct#123');
    const switched = await request(app)
      .post('/api/auth/switch-company')
      .set(authHeader(loggedIn.token))
      .send({ companyId: secondary.company.id });
    expect(switched.status).toBe(200);
    expect(switched.body.data.activeCompany.id).toBe(secondary.company.id);

    const me = await request(app).get('/api/auth/me').set(authHeader(switched.body.data.token));
    expect(me.body.data.activeCompany.id).toBe(secondary.company.id);
  });
});
