import bcrypt from 'bcryptjs';
import request from 'supertest';
import app from '../src/server';
import { prisma } from '../src/config/prisma';
import { runWithCompany } from '../src/lib/tenantContext';
import { ensurePermissionCatalog, createDefaultRoles } from '../src/modules/companies/companyDefaults';

let permissionCatalog: { id: number; module: string; action: string }[] | null = null;

let counter = 0;
/** A short, run-unique suffix — avoids collisions between test files sharing one database. */
export function uniqueSuffix(): string {
  counter += 1;
  return `${Date.now()}${counter}`;
}

/**
 * Creates one company with an Admin user, the same way `prisma/seed.ts`
 * does (reusing its exact helpers) — but with a caller-chosen name/username/
 * password and without any demo master data, so tests stay fast and
 * independent of the seed script's fixtures.
 */
export async function bootstrapCompany(opts: { companyName: string; username: string; password: string }) {
  if (!permissionCatalog) permissionCatalog = await ensurePermissionCatalog();

  const company = await prisma.company.create({ data: { name: opts.companyName } });
  return runWithCompany(company.id, async () => {
    const adminRole = await createDefaultRoles(company.id, permissionCatalog!);
    const passwordHash = await bcrypt.hash(opts.password, 4); // low cost factor — speed, not security, in tests
    const user = await prisma.user.create({
      data: { username: opts.username, name: 'Test Admin', passwordHash },
    });
    await prisma.companyUser.create({
      data: { companyId: company.id, userId: user.id, roleId: adminRole.id, isDefault: true },
    });
    await prisma.settings.create({ data: { companyId: company.id, businessName: opts.companyName } });
    return { company, user, adminRole };
  });
}

/** Logs in through the real HTTP endpoint, exercising the actual auth code path. */
export async function loginAs(username: string, password: string) {
  const res = await request(app).post('/api/auth/login').send({ username, password });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${username}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data as {
    token: string;
    user: { id: number; mustChangePassword: boolean };
    activeCompany: { id: number; name: string; role: string };
    companies: { id: number; name: string; role: string }[];
  };
}

export function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export { app, prisma };
