import request from 'supertest';
import { app, prisma, bootstrapCompany, loginAs, authHeader, uniqueSuffix } from './helpers';

afterAll(async () => {
  await prisma.$disconnect();
});

async function setUpProductAndParties(token: string) {
  const unit = await request(app).post('/api/units').set(authHeader(token)).send({ name: 'Pieces', shortName: 'Pcs' });
  const product = await request(app)
    .post('/api/products')
    .set(authHeader(token))
    .send({ name: 'Widget', unitId: unit.body.data.id, saleRate: 100, purchaseRate: 50, taxRate: 18, openingStock: 100 });
  const customer = await request(app).post('/api/customers').set(authHeader(token)).send({ name: 'Widget Buyer' });
  const vendor = await request(app).post('/api/vendors').set(authHeader(token)).send({ name: 'Widget Supplier' });
  return { productId: product.body.data.id, customerId: customer.body.data.id, vendorId: vendor.body.data.id };
}

describe('Independent document numbering', () => {
  it('starts a brand-new company\'s invoice numbering at INV-000001 regardless of other companies\' activity', async () => {
    const suffix = uniqueSuffix();
    await bootstrapCompany({ companyName: `Num Busy Co ${suffix}`, username: `numbusy_${suffix}`, password: 'Correct#123' });
    const busy = await loginAs(`numbusy_${suffix}`, 'Correct#123');
    const busyParties = await setUpProductAndParties(busy.token);
    // Rack up several invoices in the first company so its counter is well past 1.
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post('/api/sales')
        .set(authHeader(busy.token))
        .send({ customerId: busyParties.customerId, items: [{ productId: busyParties.productId, qty: 1, rate: 100, taxRate: 18 }] });
    }

    await bootstrapCompany({ companyName: `Num Fresh Co ${suffix}`, username: `numfresh_${suffix}`, password: 'Correct#123' });
    const fresh = await loginAs(`numfresh_${suffix}`, 'Correct#123');
    const freshParties = await setUpProductAndParties(fresh.token);
    const sale = await request(app)
      .post('/api/sales')
      .set(authHeader(fresh.token))
      .send({ customerId: freshParties.customerId, items: [{ productId: freshParties.productId, qty: 1, rate: 100, taxRate: 18 }] });

    expect(sale.status).toBe(201);
    expect(sale.body.data.invoiceNo).toBe('INV-000001');
  });

  it('keeps purchase bill numbers and payment numbers independent per company too', async () => {
    const suffix = uniqueSuffix();
    await bootstrapCompany({ companyName: `Num Co ${suffix}`, username: `num_${suffix}`, password: 'Correct#123' });
    const co = await loginAs(`num_${suffix}`, 'Correct#123');
    const parties = await setUpProductAndParties(co.token);

    const purchase = await request(app)
      .post('/api/purchases')
      .set(authHeader(co.token))
      .send({ vendorId: parties.vendorId, items: [{ productId: parties.productId, qty: 5, rate: 50, taxRate: 18 }] });
    expect(purchase.body.data.billNo).toBe('PB-000001');

    const payment = await request(app)
      .post('/api/payments')
      .set(authHeader(co.token))
      .send({ partyType: 'CUSTOMER', customerId: parties.customerId, amount: 50, mode: 'CASH' });
    expect(payment.body.data.paymentNo).toBe('PAY-000001');
  });
});
