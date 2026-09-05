import { prisma } from '../../config/prisma';

export const MODULES = [
  'customers', 'vendors', 'products', 'sales', 'purchases', 'orders',
  'payments', 'accounts', 'inventory', 'production', 'reports', 'documents', 'email',
  'excel', 'users', 'roles', 'audit', 'settings', 'backup',
];
export const ACTIONS = ['view', 'create', 'edit', 'delete', 'export', 'print'];

export const ROLE_GRANTS: Record<string, { modules: string[]; actions: string[] }[]> = {
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

/** Ensures the global (cross-company) permission catalog exists. Idempotent. */
export async function ensurePermissionCatalog() {
  return Promise.all(
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
}

/**
 * Creates the standard Admin + functional roles for the *current* company
 * (must be called from inside `runWithCompany`), granting each its
 * permissions from the catalog. Returns the created Admin role.
 */
export async function createDefaultRoles(companyId: number, permissions: { id: number; module: string; action: string }[]) {
  const adminRole = await prisma.role.create({ data: { companyId, name: 'Admin', description: 'Full system access', isSystem: true } });
  await prisma.rolePermission.createMany({
    data: permissions.map((p) => ({ roleId: adminRole.id, permissionId: p.id })),
    skipDuplicates: true,
  });

  for (const [roleName, grants] of Object.entries(ROLE_GRANTS)) {
    const role = await prisma.role.create({ data: { companyId, name: roleName, description: `${roleName} role`, isSystem: true } });
    const grantPermissionIds = new Set<number>();
    for (const grant of grants) {
      for (const p of permissions) {
        if (grant.modules.includes(p.module) && grant.actions.includes(p.action)) grantPermissionIds.add(p.id);
      }
    }
    await prisma.rolePermission.createMany({
      data: [...grantPermissionIds].map((permissionId) => ({ roleId: role.id, permissionId })),
      skipDuplicates: true,
    });
  }

  return adminRole;
}
