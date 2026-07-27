/**
 * master.seed.ts
 * ──────────────
 * Seeds all master data into the database.
 * Safe to run multiple times — uses INSERT IGNORE.
 *
 * Inserts:
 * 1. Settings (app config + ID counters)
 * 2. Roles (Admin, Supervisor, Technician, Viewer)
 * 3. Departments (7 Rukman Udyog departments)
 * 4. Shifts (Day + Night)
 * 5. Default Admin user (password must be changed on first login)
 */

import { db } from '../../src/config/database';
import { hashPassword } from '../../src/utils/helpers';
import { logger } from '../../src/utils/logger';
import {
  TABLE, ID_PREFIX, ROLES, DEPARTMENTS, SHIFTS, PERMISSIONS, FREQUENCY, PHOTO_REQUIRED_FREQUENCIES
} from '../../src/config/constants';

// ── 1. Settings ──────────────────────────────────────────────────
async function seedSettings(): Promise<void> {
  const settings = [
    { key: 'APP_NAME',           value: 'CMMS Pro',          description: 'Application name' },
    { key: 'COMPANY_NAME',       value: 'Rukman Udyog',      description: 'Company name' },
    { key: 'APP_VERSION',        value: '1.0.0',             description: 'Current app version' },
    { key: 'TIMEZONE',           value: 'Asia/Kolkata',      description: 'App timezone' },
    // ID counters — start at 0, first ID will be 1
    { key: 'COUNTER_USR',        value: '0',                 description: 'User ID counter' },
    { key: 'COUNTER_MAC',        value: '0',                 description: 'Machine ID counter' },
    { key: 'COUNTER_DEP',        value: '0',                 description: 'Department ID counter' },
    { key: 'COUNTER_SHF',        value: '0',                 description: 'Shift ID counter' },
    { key: 'COUNTER_ROL',        value: '0',                 description: 'Role ID counter' },
    { key: 'COUNTER_TMP',        value: '0',                 description: 'Template ID counter' },
    { key: 'COUNTER_ITM',        value: '0',                 description: 'Item ID counter' },
    { key: 'COUNTER_TSK',        value: '0',                 description: 'Task ID counter' },
    { key: 'COUNTER_RSP',        value: '0',                 description: 'Response ID counter' },
    { key: 'COUNTER_VRF',        value: '0',                 description: 'Verification ID counter' },
    { key: 'COUNTER_ASN',        value: '0',                 description: 'Assignment ID counter' },
    { key: 'COUNTER_MAP',        value: '0',                 description: 'Map ID counter' },
    { key: 'COUNTER_NTF',        value: '0',                 description: 'Notification ID counter' },
    { key: 'COUNTER_LOG',        value: '0',                 description: 'Log ID counter' },
  ];

  for (const s of settings) {
    await db.query(
      `INSERT IGNORE INTO ${TABLE.SETTINGS} (\`key\`, \`value\`, description) VALUES (?, ?, ?)`,
      [s.key, s.value, s.description]
    );
  }
  logger.info('✅ Settings seeded');
}

// ── 2. Roles ─────────────────────────────────────────────────────
async function seedRoles(): Promise<void> {
  const roles = [
    { id: 'ROL001', name: ROLES.ADMIN,      permissions: PERMISSIONS.Admin },
    { id: 'ROL002', name: ROLES.SUPERVISOR, permissions: PERMISSIONS.Supervisor },
    { id: 'ROL003', name: ROLES.TECHNICIAN, permissions: PERMISSIONS.Technician },
    { id: 'ROL004', name: ROLES.VIEWER,     permissions: PERMISSIONS.Viewer },
  ];

  for (const r of roles) {
    await db.query(
      `INSERT IGNORE INTO ${TABLE.ROLES} (role_id, role_name, permissions) VALUES (?, ?, ?)`,
      [r.id, r.name, JSON.stringify(r.permissions)]
    );
  }

  // Update counters to match seeded data
  await db.query(`UPDATE ${TABLE.SETTINGS} SET \`value\` = '4' WHERE \`key\` = 'COUNTER_ROL'`);
  logger.info('✅ Roles seeded (Admin, Supervisor, Technician, Viewer)');
}

// ── 3. Departments ───────────────────────────────────────────────
async function seedDepartments(): Promise<void> {
  const departments = [
    { id: 'DEP001', name: DEPARTMENTS.BLOW_MOULDING,      code: 'BLW' },
    { id: 'DEP002', name: DEPARTMENTS.INJECTION_MOULDING, code: 'INJ' },
    { id: 'DEP003', name: DEPARTMENTS.PAINT_SHOP,         code: 'PNT' },
    { id: 'DEP004', name: DEPARTMENTS.ASSEMBLY,           code: 'ASM' },
    { id: 'DEP005', name: DEPARTMENTS.QUALITY_CONTROL,    code: 'QC'  },
    { id: 'DEP006', name: DEPARTMENTS.MAINTENANCE,        code: 'MNT' },
    { id: 'DEP007', name: DEPARTMENTS.HR_ADMIN,           code: 'HRA' },
  ];

  for (const d of departments) {
    await db.query(
      `INSERT IGNORE INTO ${TABLE.DEPARTMENTS} (dept_id, dept_name, dept_code) VALUES (?, ?, ?)`,
      [d.id, d.name, d.code]
    );
  }

  await db.query(`UPDATE ${TABLE.SETTINGS} SET \`value\` = '7' WHERE \`key\` = 'COUNTER_DEP'`);
  logger.info('✅ Departments seeded (7 departments)');
}

// ── 4. Shifts ────────────────────────────────────────────────────
async function seedShifts(): Promise<void> {
  const shifts = [
    { id: 'SHF001', name: SHIFTS.DAY,   start: '08:00:00', end: '20:00:00' },
    { id: 'SHF002', name: SHIFTS.NIGHT, start: '20:00:00', end: '08:00:00' },
  ];

  for (const s of shifts) {
    await db.query(
      `INSERT IGNORE INTO ${TABLE.SHIFTS} (shift_id, shift_name, start_time, end_time) VALUES (?, ?, ?, ?)`,
      [s.id, s.name, s.start, s.end]
    );
  }

  await db.query(`UPDATE ${TABLE.SETTINGS} SET \`value\` = '2' WHERE \`key\` = 'COUNTER_SHF'`);
  logger.info('✅ Shifts seeded (Day Shift 08:00-20:00, Night Shift 20:00-08:00)');
}

// ── 5. Default Admin User ────────────────────────────────────────
async function seedDefaultAdmin(): Promise<void> {
  // Check if admin already exists
  const [existing] = await db.execute<any[]>(
    `SELECT user_id FROM ${TABLE.USERS} WHERE username = ?`,
    ['admin']
  );

  if (existing.length > 0) {
    logger.info('ℹ️  Default admin already exists — skipping');
    return;
  }

  const passwordHash = await hashPassword('Admin@1234');

  await db.query(
    `INSERT INTO ${TABLE.USERS}
      (user_id, employee_code, full_name, username, password_hash, role_id, dept_id, shift_id, email)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'USR000001',
      'EMP-ADM-001',
      'System Administrator',
      'admin',
      passwordHash,
      'ROL001',  // Admin role
      'DEP007',  // HR/Admin dept
      'SHF001',  // Day shift
      'admin@rukman.com',
    ]
  );

  await db.query(`UPDATE ${TABLE.SETTINGS} SET \`value\` = '1' WHERE \`key\` = 'COUNTER_USR'`);
  logger.info('✅ Default admin user created');
  logger.warn('⚠️  DEFAULT ADMIN CREDENTIALS — CHANGE ON FIRST LOGIN:');
  logger.warn('   Username: admin');
  logger.warn('   Password: Admin@1234');
}

// ── Main seed runner ─────────────────────────────────────────────
export async function runSeeds(): Promise<void> {
  logger.info('🌱 Starting database seeding...');
  try {
    await seedSettings();
    await seedRoles();
    await seedDepartments();
    await seedShifts();
    await seedDefaultAdmin();
    logger.info('🎉 All seeds completed successfully!');
  } catch (error) {
    logger.error('❌ Seeding failed', { error });
    throw error;
  }
}
