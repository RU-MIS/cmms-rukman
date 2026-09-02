import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const MODULES = [
  'customers', 'vendors', 'products', 'sales', 'purchases', 'orders',
  'payments', 'accounts', 'inventory', 'production', 'reports', 'documents', 'email',
  'excel', 'users', 'roles', 'audit', 'settings', 'backup',
];
const ACTIONS = ['view', 'create', 'edit', 'delete', 'export', 'print'];

const ROLE_GRANTS: Record<string, { modules: string[]; actions: string[] }[]> = {
  Manager: [{ modules: MODULES, actions: ['view', 'create', 'edit', 'export', 'print'] }],
  Sales: [
    { modules: ['customers', 'sales', 'orders', 'reports', 'documents', 'email'], actions: ['view', 'create', 'edit', 'export', 'print'] },
    { modules: ['products', 'inventory', 'payments'], actions: ['view'] },
  ],
  Purchase: [
    { modules: ['vendors', 'purchases', 'orders', 'reports', 'documents', 'email'], actions: ['view', 'create', 'edit', 'export', 'print'] },
    { modules: ['products', 'inventory', 'payments'], actions: ['view'] },
  ],
  Accounts: [
    { modules: ['payments', 'accounts', 'reports', 'documents', 'email', 'excel'], actions: ['view', 'create', 'edit', 'export', 'print'] },
    { modules: ['customers', 'vendors', 'sales', 'purchases'], actions: ['view'] },
  ],
  Production: [
    { modules: ['production'], actions: ['view', 'create', 'edit', 'export', 'print'] },
    { modules: ['products', 'inventory', 'reports'], actions: ['view'] },
  ],
  Viewer: [{ modules: MODULES, actions: ['view'] }],
};

async function main() {
  console.log('Seeding permission catalog...');
  const permissions = await Promise.all(
    MODULES.flatMap((module) =>
      ACTIONS.map((action) =>
        prisma.permission.upsert({
          where: { module_action: { module, action } },
          update: {},
          create: { module, action },
        })
      )
    )
  );

  console.log('Seeding roles...');
  const adminRole = await prisma.role.upsert({
    where: { name: 'Admin' },
    update: {},
    create: { name: 'Admin', description: 'Full system access', isSystem: true },
  });
  await prisma.rolePermission.createMany({
    data: permissions.map((p) => ({ roleId: adminRole.id, permissionId: p.id })),
    skipDuplicates: true,
  });

  for (const [roleName, grants] of Object.entries(ROLE_GRANTS)) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName, description: `${roleName} role`, isSystem: true },
    });
    const grantPermissionIds = new Set<number>();
    for (const grant of grants) {
      for (const p of permissions) {
        if (grant.modules.includes(p.module) && grant.actions.includes(p.action)) grantPermissionIds.add(p.id);
      }
    }
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: [...grantPermissionIds].map((permissionId) => ({ roleId: role.id, permissionId })),
      skipDuplicates: true,
    });
  }

  console.log('Seeding default admin user...');
  const passwordHash = await bcrypt.hash('Admin@1234', 10);
  await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: { username: 'admin', name: 'Administrator', email: 'admin@example.com', passwordHash, roleId: adminRole.id },
  });

  console.log('Seeding business settings...');
  await prisma.settings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      businessName: 'BusinessFlow ERP Demo Co.',
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
    unitDefs.map((u) => prisma.unit.upsert({ where: { name: u.name }, update: {}, create: u }))
  );

  const categoryDefs = ['Raw Material', 'Finished Goods', 'Trading Goods', 'Packaging'];
  const categories = await Promise.all(
    categoryDefs.map((name) => prisma.productCategory.upsert({ where: { name }, update: {}, create: { name } }))
  );

  await Promise.all([
    prisma.warehouse.upsert({ where: { name: 'Main Warehouse' }, update: {}, create: { name: 'Main Warehouse', address: 'Factory Gate, Pune' } }),
    prisma.warehouse.upsert({ where: { name: 'Production Floor' }, update: {}, create: { name: 'Production Floor', address: 'Shop Floor 1' } }),
  ]);

  const findUnit = (short: string) => units.find((u) => u.shortName === short)!;
  const findCategory = (name: string) => categories.find((c) => c.name === name)!;

  const customerCount = await prisma.customer.count();
  if (customerCount === 0) {
    const customerDefs = [
      { code: 'CUST-00001', name: 'Demo — Sharma Traders', companyName: 'Sharma Traders', mobile: '9876500001', city: 'Pune', state: 'Maharashtra', gstin: '27AASFS1234F1Z1', openingBalance: 15000, creditLimit: 100000 },
      { code: 'CUST-00002', name: 'Demo — Patel Hardware', companyName: 'Patel Hardware Store', mobile: '9876500002', city: 'Mumbai', state: 'Maharashtra', gstin: '27AASFS5678F1Z2', openingBalance: 0, creditLimit: 50000 },
      { code: 'CUST-00003', name: 'Demo — Gupta Enterprises', companyName: 'Gupta Enterprises', mobile: '9876500003', city: 'Nagpur', state: 'Maharashtra', openingBalance: 5000, creditLimit: 75000 },
      { code: 'CUST-00004', name: 'Demo — Reddy Distributors', companyName: 'Reddy Distributors', mobile: '9876500004', city: 'Hyderabad', state: 'Telangana', openingBalance: 0, creditLimit: 60000 },
    ];
    for (const c of customerDefs) await prisma.customer.create({ data: c });
  }

  const vendorCount = await prisma.vendor.count();
  if (vendorCount === 0) {
    const vendorDefs = [
      { code: 'VEND-00001', name: 'Demo — Bharat Steel Suppliers', companyName: 'Bharat Steel Suppliers', mobile: '9876600001', city: 'Pune', gstin: '27AAVFS1111F1Z1', openingBalance: 8000 },
      { code: 'VEND-00002', name: 'Demo — National Packaging Co.', companyName: 'National Packaging Co.', mobile: '9876600002', city: 'Pune', openingBalance: 0 },
      { code: 'VEND-00003', name: 'Demo — Kumar Raw Materials', companyName: 'Kumar Raw Materials', mobile: '9876600003', city: 'Nashik', openingBalance: 3200 },
    ];
    for (const v of vendorDefs) await prisma.vendor.create({ data: v });
  }

  const productCount = await prisma.product.count();
  if (productCount === 0) {
    const rawSteel = await prisma.product.create({
      data: { sku: 'PRD-00001', name: 'Demo — Steel Sheet 2mm', categoryId: findCategory('Raw Material').id, unitId: findUnit('Kg').id, purchaseRate: 65, saleRate: 0, taxRate: 18, openingStock: 500, currentStock: 500, reorderLevel: 100, isRawMaterial: true },
    });
    const rawBolt = await prisma.product.create({
      data: { sku: 'PRD-00002', name: 'Demo — Steel Bolt M8', categoryId: findCategory('Raw Material').id, unitId: findUnit('Pcs').id, purchaseRate: 2, saleRate: 0, taxRate: 18, openingStock: 2000, currentStock: 2000, reorderLevel: 500, isRawMaterial: true },
    });
    const packaging = await prisma.product.create({
      data: { sku: 'PRD-00003', name: 'Demo — Corrugated Box (L)', categoryId: findCategory('Packaging').id, unitId: findUnit('Pcs').id, purchaseRate: 15, saleRate: 0, taxRate: 12, openingStock: 300, currentStock: 300, reorderLevel: 50, isRawMaterial: true },
    });
    const finishedBracket = await prisma.product.create({
      data: { sku: 'PRD-00004', name: 'Demo — Steel Mounting Bracket', categoryId: findCategory('Finished Goods').id, unitId: findUnit('Pcs').id, purchaseRate: 0, saleRate: 180, taxRate: 18, openingStock: 40, currentStock: 40, reorderLevel: 20 },
    });
    await prisma.product.create({
      data: { sku: 'PRD-00005', name: 'Demo — Trading Item: Cable Ties (100pk)', categoryId: findCategory('Trading Goods').id, unitId: findUnit('Box').id, purchaseRate: 45, saleRate: 75, taxRate: 12, openingStock: 60, currentStock: 60, reorderLevel: 15 },
    });

    await prisma.bomItem.createMany({
      data: [
        { finishedProductId: finishedBracket.id, componentId: rawSteel.id, qtyPerUnit: 0.8 },
        { finishedProductId: finishedBracket.id, componentId: rawBolt.id, qtyPerUnit: 4 },
        { finishedProductId: finishedBracket.id, componentId: packaging.id, qtyPerUnit: 0.25 },
      ],
    });

    for (const p of [rawSteel, rawBolt, packaging, finishedBracket]) {
      await prisma.stockTransaction.create({
        data: { productId: p.id, type: 'OPENING', qtyIn: p.openingStock, balanceAfter: p.openingStock, reference: 'Opening Stock (demo)' },
      });
    }
  }

  console.log('Seeding default cash & bank accounts...');
  await prisma.account.upsert({
    where: { name: 'Cash' },
    update: {},
    create: { name: 'Cash', type: 'CASH', openingBalance: 10000 },
  });
  await prisma.account.upsert({
    where: { name: 'Bank' },
    update: {},
    create: { name: 'Bank', type: 'BANK', bankName: 'Primary Bank', openingBalance: 50000 },
  });

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
