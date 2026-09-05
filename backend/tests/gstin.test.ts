import request from 'supertest';
import { app, prisma, bootstrapCompany, loginAs, authHeader, uniqueSuffix } from './helpers';
import { isValidGstin } from '../src/utils/gstin';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('GSTIN validation and normalization', () => {
  it('accepts a well-formed GSTIN', () => {
    expect(isValidGstin('27ABCDE1234F1Z5')).toBe(true);
  });

  it('rejects a malformed GSTIN', () => {
    expect(isValidGstin('not-a-gstin')).toBe(false);
    expect(isValidGstin('27ABCDE1234F1Z')).toBe(false); // too short
  });

  it('rejects a customer create with an invalid GSTIN', async () => {
    const suffix = uniqueSuffix();
    await bootstrapCompany({ companyName: `Gstin Co ${suffix}`, username: `gstin_${suffix}`, password: 'Correct#123' });
    const co = await loginAs(`gstin_${suffix}`, 'Correct#123');
    const res = await request(app)
      .post('/api/customers')
      .set(authHeader(co.token))
      .send({ name: 'Bad GSTIN Customer', gstin: 'invalid-gstin' });
    expect(res.status).toBe(400);
  });

  it('normalizes a lowercase/whitespace-padded GSTIN to uppercase and trimmed on create', async () => {
    const suffix = uniqueSuffix();
    await bootstrapCompany({ companyName: `Gstin Co ${suffix}`, username: `gstin2_${suffix}`, password: 'Correct#123' });
    const co = await loginAs(`gstin2_${suffix}`, 'Correct#123');
    const res = await request(app)
      .post('/api/customers')
      .set(authHeader(co.token))
      .send({ name: 'Lowercase GSTIN Customer', gstin: '  27abcde1234f1z5  ' });
    expect(res.status).toBe(201);
    expect(res.body.data.gstin).toBe('27ABCDE1234F1Z5');
  });

  it('allows an empty/absent GSTIN — it is optional', async () => {
    const suffix = uniqueSuffix();
    await bootstrapCompany({ companyName: `Gstin Co ${suffix}`, username: `gstin3_${suffix}`, password: 'Correct#123' });
    const co = await loginAs(`gstin3_${suffix}`, 'Correct#123');
    const res = await request(app).post('/api/customers').set(authHeader(co.token)).send({ name: 'No GSTIN Customer' });
    expect(res.status).toBe(201);
  });
});

describe('GST API not-configured response', () => {
  it('reports configured: false and a clear 503 on lookup when no GST provider is set up', async () => {
    const suffix = uniqueSuffix();
    await bootstrapCompany({ companyName: `Gst Api Co ${suffix}`, username: `gstapi_${suffix}`, password: 'Correct#123' });
    const co = await loginAs(`gstapi_${suffix}`, 'Correct#123');

    const status = await request(app).get('/api/gst/status').set(authHeader(co.token));
    expect(status.status).toBe(200);
    expect(status.body.data.configured).toBe(false);

    const lookup = await request(app)
      .post('/api/gst/lookup')
      .set(authHeader(co.token))
      .send({ gstin: '27ABCDE1234F1Z5' });
    expect(lookup.status).toBe(503);
    expect(lookup.body.message).toMatch(/not configured/i);
  });
});
