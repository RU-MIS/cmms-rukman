import bcrypt from 'bcryptjs';
import { prisma } from '../src/config/prisma';
import { runWithCompany } from '../src/lib/tenantContext';
import { ensurePermissionCatalog, createDefaultRoles } from '../src/modules/companies/companyDefaults';

/** Seeds one independent company workspace: roles, an admin user/membership, default settings and demo master data. */
async function seedCompany(name: string, permissions: { id: number; module: string; action: string }[]) {
  const company = await prisma.company.create({
    data: {
      name,
      gstin: '27ABCDE1234F1Z5',
      address: '123 Industrial Area, Pune, Maharashtra',
      state: 'Maharashtra',
    },
  });

  return runWithCompany(company.id, async () => {
    console.log(`Seeding roles for ${name}...`);
    const adminRole = await createDefaultRoles(company.id, permissions);

    console.log('Seeding default admin user...');
    const passwordHash = await bcrypt.hash('Admin@1234', 10);
    const adminUser = await prisma.user.upsert({
      where: { username: 'admin' },
      update: {},
      create: { username: 'admin', name: 'Administrator', email: 'admin@example.com', passwordHash, mustChangePassword: true },
    });
    await prisma.companyUser.upsert({
      where: { companyId_userId: { companyId: company.id, userId: adminUser.id } },
      update: {},
      create: { companyId: company.id, userId: adminUser.id, roleId: adminRole.id, isDefault: true },
    });

    console.log('Seeding business settings...');
    await prisma.settings.create({
      data: {
        companyId: company.id,
        businessName: name,
        address: '123 Industrial Area, Pune, Maharashtra',
        phone: '+91 98765 43210',
        email: 'accounts@example.com',
        gstin: '27ABCDE1234F1Z5',
        pdfFooter: 'This is a computer-generated document. — BusinessFlow ERP (demo data)',
      },
    });

    console.log('Seeding demo master data...');
    const unitDefs = [
      { name: 'Pieces', shortName: 'Pcs' },
      { name: 'Kilogram', shortName: 'Kg' },
      { name: 'Box', shortName: 'Box' },
      { name: 'Litre', shortName: 'Ltr' },
      { name: 'Meter', shortName: 'Mtr' },
    ];
    const units = await Promise.all(
      unitDefs.map((u) =>
        prisma.unit.upsert({
          where: { companyId_name: { companyId: company.id, name: u.name } },
          update: {},
          create: { ...u, companyId: company.id },
        })
      )
    );

    const categoryDefs = ['Raw Material', 'Finished Goods', 'Trading Goods', 'Packaging'];
    const categories = await Promise.all(
      categoryDefs.map((name2) =>
        prisma.productCategory.upsert({
          where: { companyId_name: { companyId: company.id, name: name2 } },
          update: {},
          create: { name: name2, companyId: company.id },
        })
      )
    );

    await Promise.all([
      prisma.warehouse.upsert({
        where: { companyId_name: { companyId: company.id, name: 'Main Warehouse' } },
        update: {},
        create: { name: 'Main Warehouse', address: 'Factory Gate, Pune', companyId: company.id },
      }),
      prisma.warehouse.upsert({
        where: { companyId_name: { companyId: company.id, name: 'Production Floor' } },
        update: {},
        create: { name: 'Production Floor', address: 'Shop Floor 1', companyId: company.id },
      }),
    ]);

    const findUnit = (short: string) => units.find((u) => u.shortName === short)!;
    const findCategory = (catName: string) => categories.find((c) => c.name === catName)!;

    const customerCount = await prisma.customer.count();
    if (customerCount === 0) {
      const customerDefs = [
        { code: 'CUST-00001', name: 'Demo — Sharma Traders', companyName: 'Sharma Traders', mobile: '9876500001', city: 'Pune', state: 'Maharashtra', gstin: '27AASFS1234F1Z1', openingBalance: 15000, creditLimit: 100000 },
        { code: 'CUST-00002', name: 'Demo — Patel Hardware', companyName: 'Patel Hardware Store', mobile: '9876500002', city: 'Mumbai', state: 'Maharashtra', gstin: '27AASFS5678F1Z2', openingBalance: 0, creditLimit: 50000 },
        { code: 'CUST-00003', name: 'Demo — Gupta Enterprises', companyName: 'Gupta Enterprises', mobile: '9876500003', city: 'Nagpur', state: 'Maharashtra', openingBalance: 5000, creditLimit: 75000 },
        { code: 'CUST-00004', name: 'Demo — Reddy Distributors', companyName: 'Reddy Distributors', mobile: '9876500004', city: 'Hyderabad', state: 'Telangana', openingBalance: 0, creditLimit: 60000 },
      ];
      for (const c of customerDefs) await prisma.customer.create({ data: { ...c, companyId: company.id } });
    }

    const vendorCount = await prisma.vendor.count();
    if (vendorCount === 0) {
      const vendorDefs = [
        { code: 'VEND-00001', name: 'Demo — Bharat Steel Suppliers', companyName: 'Bharat Steel Suppliers', mobile: '9876600001', city: 'Pune', gstin: '27AAVFS1111F1Z1', openingBalance: 8000 },
        { code: 'VEND-00002', name: 'Demo — National Packaging Co.', companyName: 'National Packaging Co.', mobile: '9876600002', city: 'Pune', openingBalance: 0 },
        { code: 'VEND-00003', name: 'Demo — Kumar Raw Materials', companyName: 'Kumar Raw Materials', mobile: '9876600003', city: 'Nashik', openingBalance: 3200 },
      ];
      for (const v of vendorDefs) await prisma.vendor.create({ data: { ...v, companyId: company.id } });
    }

    const productCount = await prisma.product.count();
    if (productCount === 0) {
      const rawSteel = await prisma.product.create({
        data: { companyId: company.id, sku: 'PRD-00001', name: 'Demo — Steel Sheet 2mm', categoryId: findCategory('Raw Material').id, unitId: findUnit('Kg').id, purchaseRate: 65, saleRate: 0, taxRate: 18, openingStock: 500, currentStock: 500, reorderLevel: 100, isRawMaterial: true },
      });
      const rawBolt = await prisma.product.create({
        data: { companyId: company.id, sku: 'PRD-00002', name: 'Demo — Steel Bolt M8', categoryId: findCategory('Raw Material').id, unitId: findUnit('Pcs').id, purchaseRate: 2, saleRate: 0, taxRate: 18, openingStock: 2000, currentStock: 2000, reorderLevel: 500, isRawMaterial: true },
      });
      const packaging = await prisma.product.create({
        data: { companyId: company.id, sku: 'PRD-00003', name: 'Demo — Corrugated Box (L)', categoryId: findCategory('Packaging').id, unitId: findUnit('Pcs').id, purchaseRate: 15, saleRate: 0, taxRate: 12, openingStock: 300, currentStock: 300, reorderLevel: 50, isRawMaterial: true },
      });
      const finishedBracket = await prisma.product.create({
        data: { companyId: company.id, sku: 'PRD-00004', name: 'Demo — Steel Mounting Bracket', categoryId: findCategory('Finished Goods').id, unitId: findUnit('Pcs').id, purchaseRate: 0, saleRate: 180, taxRate: 18, openingStock: 40, currentStock: 40, reorderLevel: 20 },
      });
      await prisma.product.create({
        data: { companyId: company.id, sku: 'PRD-00005', name: 'Demo — Trading Item: Cable Ties (100pk)', categoryId: findCategory('Trading Goods').id, unitId: findUnit('Box').id, purchaseRate: 45, saleRate: 75, taxRate: 12, openingStock: 60, currentStock: 60, reorderLevel: 15 },
      });

      await prisma.bomItem.createMany({
        data: [
          { companyId: company.id, finishedProductId: finishedBracket.id, componentId: rawSteel.id, qtyPerUnit: 0.8 },
          { companyId: company.id, finishedProductId: finishedBracket.id, componentId: rawBolt.id, qtyPerUnit: 4 },
          { companyId: company.id, finishedProductId: finishedBracket.id, componentId: packaging.id, qtyPerUnit: 0.25 },
        ],
      });

      for (const p of [rawSteel, rawBolt, packaging, finishedBracket]) {
        await prisma.stockTransaction.create({
          data: { companyId: company.id, productId: p.id, type: 'OPENING', qtyIn: p.openingStock, balanceAfter: p.openingStock, reference: 'Opening Stock (demo)' },
        });
      }
    }

    console.log('Seeding default cash & bank accounts...');
    await prisma.account.upsert({
      where: { companyId_name: { companyId: company.id, name: 'Cash' } },
      update: {},
      create: { companyId: company.id, name: 'Cash', type: 'CASH', openingBalance: 10000 },
    });
    await prisma.account.upsert({
      where: { companyId_name: { companyId: company.id, name: 'Bank' } },
      update: {},
      create: { companyId: company.id, name: 'Bank', type: 'BANK', bankName: 'Primary Bank', openingBalance: 50000 },
    });

    return company;
  });
}

async function main() {
  console.log('Seeding permission catalog...');
  const permissions = await ensurePermissionCatalog();

  await seedCompany('BusinessFlow ERP Demo Co.', permissions);

  console.log('Seed complete.');
  console.log('Default login → username: admin / password: Admin@1234 (change this immediately)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
