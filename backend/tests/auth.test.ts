import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app, prisma, bootstrapCompany, loginAs, authHeader, uniqueSuffix } from './helpers';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Login and authentication', () => {
  it('rejects an unknown username', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'no-such-user', password: 'whatever' });
    expect(res.status).toBe(401);
  });

  it('rejects a wrong password for a real user', async () => {
    const suffix = uniqueSuffix();
    await bootstrapCompany({ companyName: `Auth Co ${suffix}`, username: `auth_${suffix}`, password: 'Correct#123' });
    const res = await request(app).post('/api/auth/login').send({ username: `auth_${suffix}`, password: 'Wrong#123' });
    expect(res.status).toBe(401);
  });

  it('logs in with correct credentials and returns a token, active company, and companies list', async () => {
    const suffix = uniqueSuffix();
    await bootstrapCompany({ companyName: `Auth Co ${suffix}`, username: `auth_${suffix}`, password: 'Correct#123' });
    const data = await loginAs(`auth_${suffix}`, 'Correct#123');
    expect(data.token).toBeTruthy();
    expect(data.activeCompany.name).toBe(`Auth Co ${suffix}`);
    expect(data.companies).toHaveLength(1);
  });

  it('rejects an unauthenticated request to a protected route', async () => {
    const res = await request(app).get('/api/customers');
    expect(res.status).toBe(401);
  });

  it('GET /auth/me returns the logged-in user', async () => {
    const suffix = uniqueSuffix();
    await bootstrapCompany({ companyName: `Auth Co ${suffix}`, username: `auth_${suffix}`, password: 'Correct#123' });
    const { token } = await loginAs(`auth_${suffix}`, 'Correct#123');
    const res = await request(app).get('/api/auth/me').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data.username).toBe(`auth_${suffix}`);
  });

  it('forces a password change for a user created with mustChangePassword, blocking other routes until changed', async () => {
    const suffix = uniqueSuffix();
    const { company, adminRole } = await bootstrapCompany({
      companyName: `Force Change Co ${suffix}`,
      username: `owner_${suffix}`,
      password: 'Correct#123',
    });
    // Simulate the same forced-change flag users.routes.ts sets for a
    // brand-new user created by an admin.
    const newUser = await prisma.user.create({
      data: { username: `newhire_${suffix}`, name: 'New Hire', passwordHash: await bcrypt.hash('Temp#123', 4), mustChangePassword: true },
    });
    await prisma.companyUser.create({ data: { companyId: company.id, userId: newUser.id, roleId: adminRole.id } });

    const data = await loginAs(`newhire_${suffix}`, 'Temp#123');
    expect(data.user.mustChangePassword).toBe(true);

    const blocked = await request(app).get('/api/customers').set(authHeader(data.token));
    expect(blocked.status).toBe(428);

    const changed = await request(app)
      .post('/api/auth/change-password')
      .set(authHeader(data.token))
      .send({ currentPassword: 'Temp#123', newPassword: 'NewReal#456' });
    expect(changed.status).toBe(200);

    const allowedNow = await request(app).get('/api/customers').set(authHeader(data.token));
    expect(allowedNow.status).toBe(200);
  });
});
